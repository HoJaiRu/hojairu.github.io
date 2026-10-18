"""cotizar.py - El robot de la cartera: trae el precio de cada valor que tienes.

Lo ejecuta GitHub Actions dentro del repositorio PRIVADO de datos (WEBS):
  1. Lee cartera/cartera.json (tus operaciones) para saber qué valores hay.
  2. Si escribiste el nombre ("Amazon") en vez del símbolo ("AMZN"), lo busca en Yahoo
     y elige el más probable (guardando otras opciones por si no acierta).
  3. Pide a Yahoo Finance el precio actual y los cierres diarios de cada uno
     (y el cambio de moneda, si alguno no está en euros).
  4. Escribe cartera/cotizaciones.json, que lee la web.

Solo usa la librería estándar de Python (no hay que instalar nada, así arranca en segundos).
A Yahoo solo se le pide el símbolo de cada valor: nunca las cantidades ni nada tuyo.

Uso:  python cotizar.py --datos cartera --salida cotizaciones.json
      python cotizar.py --prueba "AAPL,amazon=220,bitcoin=75000=cripto"   (solo prueba: muestra los precios)
"""

import argparse
import json
import math
import re
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

URL_YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={}&interval=1d&includePrePost=false"
URL_YAHOO_2 = "https://query2.finance.yahoo.com/v8/finance/chart/{}?range={}&interval=1d&includePrePost=false"
URL_BUSCAR = "https://query2.finance.yahoo.com/v1/finance/search?q={}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=true"
NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"


def pedir(url, intentos=3):
    """Descarga un JSON, con un par de reintentos si Yahoo va lento o limita."""
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": NAVEGADOR, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            ultimo = e
            if e.code == 404:
                break
            time.sleep(1.5 * (i + 1))
        except Exception as e:  # sin conexión, tiempo agotado...
            ultimo = e
            time.sleep(1.5 * (i + 1))
    raise ultimo


def rango_para(desde):
    """El periodo de cierres que hay que pedir para cubrir desde la primera compra."""
    dias = (date.today() - desde).days + 7
    for r, d in (("1mo", 30), ("3mo", 90), ("6mo", 180), ("1y", 365), ("2y", 730), ("5y", 1826), ("10y", 3652)):
        if dias <= d:
            return r
    return "max"


def cotizar(simbolo, desde):
    """Precio actual + cierres diarios de un valor en Yahoo Finance."""
    rango = rango_para(desde)
    quien = urllib.parse.quote(simbolo)
    try:
        datos = pedir(URL_YAHOO.format(quien, rango))
    except Exception:
        datos = pedir(URL_YAHOO_2.format(quien, rango))  # el otro servidor de Yahoo
    res = (datos.get("chart") or {}).get("result")
    if not res:
        err = (datos.get("chart") or {}).get("error") or {}
        raise ValueError(err.get("description") or "no encontrado")
    res = res[0]
    meta = res["meta"]
    precio = meta.get("regularMarketPrice")
    if precio is None:
        raise ValueError("sin precio")

    # Las acciones de Londres cotizan en peniques (GBp): se pasan a libras
    divisa = meta.get("currency") or "EUR"
    factor = 1.0
    if divisa in ("GBp", "GBX"):
        divisa, factor = "GBP", 0.01
    elif divisa == "ZAc":
        divisa, factor = "ZAR", 0.01

    # Cierres diarios, con la fecha del mercado (no la de UTC)
    desfase = meta.get("gmtoffset") or 0
    tiempos = res.get("timestamp") or []
    cierres = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    hist = {}
    for t, c in zip(tiempos, cierres):
        if c is not None:
            hist[datetime.fromtimestamp(t + desfase, timezone.utc).date().isoformat()] = round(c * factor, 6)

    hora = meta.get("regularMarketTime")
    dia_mercado = datetime.fromtimestamp((hora or time.time()) + desfase, timezone.utc).date().isoformat()
    hist[dia_mercado] = round(precio * factor, 6)  # el último día es el precio de ahora
    fechas = sorted(hist)
    # Cierre anterior = el último cierre de un día anterior al de hoy
    anteriores = [hist[d] for d in fechas if d < dia_mercado]
    cierre_anterior = anteriores[-1] if anteriores else meta.get("chartPreviousClose")

    return {
        "_simbolo": simbolo,
        "precio": round(precio * factor, 6),
        "cierreAnterior": round(cierre_anterior * (factor if not anteriores else 1), 6) if cierre_anterior else None,
        "divisa": divisa,
        "nombre": meta.get("longName") or meta.get("shortName") or simbolo,
        "tipo": (meta.get("instrumentType") or "").lower(),
        "bolsa": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "hora": datetime.fromtimestamp(hora, timezone.utc).isoformat() if hora else None,
        "historico": {"d": fechas, "c": [hist[d] for d in fechas]},
    }


# ---------- Buscar el símbolo a partir del nombre ----------
TIPOS = {"EQUITY": "accion", "ETF": "etf", "MUTUALFUND": "fondo", "CRYPTOCURRENCY": "cripto"}
TIPO_DE_YAHOO = {"equity": "accion", "etf": "etf", "mutualfund": "fondo", "cryptocurrency": "cripto"}
# Bolsas en euros, de más a menos preferida: Xetra (la de más volumen para empresas de fuera)
# y las bolsas "de casa" de las empresas europeas; Frankfurt y las pequeñas, al final (datos más pobres)
BOLSAS_EUR = ["GER", "AMS", "PAR", "MIL", "MCE", "BRU", "LIS", "HEL", "IOB", "VIE", "FRA", "STU", "MUN", "BER", "DUS", "HAM", "HAN"]
# Bolsas "grandes": se prueban antes que las exóticas (Colombia, Brasil...), que a veces tienen copias raras
BOLSAS_GRANDES = set(BOLSAS_EUR) | {"NMS", "NYQ", "NGM", "NCM", "PCX", "ASE", "BTS", "LSE", "EBS", "TOR", "HKG", "CCC"}
# Gestoras de ETF: los brókers a veces quitan su nombre ("Core S&P 500 USD (Acc)" es de iShares)
GESTORAS = ["iShares", "Vanguard", "Xtrackers", "Amundi", "SPDR", "Invesco"]
PARECE_SIMBOLO = re.compile(r"^[A-Z0-9^][A-Z0-9.\-=^]{0,14}$")
PARECE_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
# Palabras que no ayudan a reconocer un valor
VACIAS = {"usd", "eur", "acc", "dist", "inc", "the", "class", "ord", "shares", "ucits", "etf", "corp", "ltd", "sa", "nv", "plc", "ag", "se"}
SUFIJOS = re.compile(r"\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|n\.?v|s\.?a|ag|se|holdings?|group)\b\.?")


def normalizar(t):
    """Minúsculas y solo letras y números ("S&P 500" -> "sp 500")."""
    return re.sub(r"[^a-z0-9 ]+", " ", (t or "").lower().replace("&", "")).strip()


def empresa(nombre):
    """Las dos primeras palabras del nombre, sin "Inc.", "Ltd"...: para saber si dos listados son la misma empresa."""
    return " ".join(SUFIJOS.sub(" ", normalizar(nombre)).split()[:2])


def palabras_clave(texto):
    """Las palabras que de verdad identifican el valor ("Core S&P 500 USD (Acc)" -> core, sp, 500)."""
    return [w for w in normalizar(re.sub(r"\(.*?\)", " ", texto or "")).split() if len(w) >= 2 and w not in VACIAS]


def sin_vacias(texto):
    """El texto sin "USD", "Acc", "(Dist)"...: "Core S&P 500 USD (Acc)" -> "Core S&P 500"."""
    t = re.sub(r"\(.*?\)", " ", texto)
    return " ".join(w for w in t.split() if normalizar(w) not in VACIAS)


def buscar(texto, original=None):
    """Lista de valores que encajan con un texto (nombre, símbolo o ISIN) según Yahoo, quitando los que
    no tienen nada que ver: tienen que salir todas las palabras de lo que escribiste (Yahoo a veces devuelve cualquier cosa)."""
    datos = pedir(URL_BUSCAR.format(urllib.parse.quote(texto)))
    base = original or texto
    claves = [] if PARECE_ISIN.match(base.upper().strip()) else palabras_clave(base)
    res = []
    for q in datos.get("quotes") or []:
        tipo = TIPOS.get(q.get("quoteType"))
        nombre = q.get("longname") or q.get("shortname") or q.get("symbol") or ""
        if not tipo or not q.get("symbol") or "derivatives" in nombre.lower():
            continue
        hay = normalizar(nombre + " " + q["symbol"]).replace(" ", "")
        if any(w not in hay for w in claves):
            continue
        res.append({
            "simbolo": q["symbol"],
            "nombre": nombre,
            "bolsa": q.get("exchDisp") or q.get("exchange") or "",
            "codigoBolsa": q.get("exchange") or "",
            "tipo": tipo,
        })
    return res


def textos_de_busqueda(clave, nombre, tipo=None):
    """Qué buscar: el nombre que escribiste y la clave, sin paréntesis primero y juntando palabras ("Space X" -> "SpaceX").
    Si parece un ETF sin gestora ("Core S&P 500 USD (Acc)"), se prueba también con las gestoras más comunes."""
    vistos, salida = set(), []
    def poner(v):
        v = re.sub(r"\s+", " ", v).strip()
        if v and v.lower() not in vistos:
            vistos.add(v.lower())
            salida.append(v)
    for t in (nombre, clave):
        if t:
            for v in (re.sub(r"[()]", " ", t), re.sub(r"\(.*?\)", " ", t), sin_vacias(t), t, t.replace(" ", "")):
                poner(v)
    base = nombre or clave
    if base and (tipo == "etf" or re.search(r"\b(acc|dist|ucits)\b", base, re.I)) \
            and not any(g.lower() in base.lower() for g in GESTORAS):
        for g in GESTORAS:
            poner(f"{g} {sin_vacias(base)}")
    return salida


def ordenar(candidatos, tipo_deseado, en_euros):
    """Orden en que se prueban: primero el tipo que dijiste; por empresa, en el orden de Yahoo;
    y dentro de cada empresa, su listado en euros si pagaste en euros."""
    if tipo_deseado in TIPOS.values():
        candidatos = sorted(candidatos, key=lambda c: c["tipo"] != tipo_deseado)
    orden_empresa = {}
    for c in candidatos:
        orden_empresa.setdefault(empresa(c["nombre"]), len(orden_empresa))
    def peso(i_c):
        i, c = i_c
        bolsa = BOLSAS_EUR.index(c["codigoBolsa"]) if en_euros and c["codigoBolsa"] in BOLSAS_EUR else 99
        return (orden_empresa[empresa(c["nombre"])], bolsa, i)
    res = [c for _, c in sorted(enumerate(candidatos), key=peso)]
    # Criptos: BTC-USD -> probar antes BTC-EUR si pagaste en euros
    salida = []
    for c in res:
        if c["tipo"] == "cripto" and en_euros and c["simbolo"].endswith("-USD"):
            salida.append({**c, "simbolo": c["simbolo"][:-4] + "-EUR"})
        salida.append(c)
    return salida


_cambios = {"EUR": 1.0}
def a_euros(divisa):
    """Cuántos euros vale 1 unidad de una moneda (se pide una vez por moneda)."""
    if divisa not in _cambios:
        try:
            _cambios[divisa] = cotizar(f"{divisa}EUR=X", date.today())["precio"]
        except Exception:
            _cambios[divisa] = None
    return _cambios[divisa]


def distancia(cot, info):
    """¿Este valor puede ser el tuyo? Devuelve lo lejos que está su precio del que pagaste
    (0 = igual) o None si no puede ser: si se aleja más de la mitad o el doble,
    o si dijiste que es cripto y no lo es."""
    if info.get("tipo") == "cripto" and TIPO_DE_YAHOO.get(cot["tipo"]) != "cripto":
        return None
    pagado = info.get("precioCompra")
    fx_cot, fx_pago = a_euros(cot["divisa"]), a_euros(info.get("divisa", "EUR"))
    if not pagado or not fx_cot or not fx_pago:
        return 0.0   # sin precio con el que comparar: vale el primero que salga
    r = (cot["precio"] * fx_cot) / (pagado * fx_pago)
    if not 0.5 <= r <= 2.0:
        return None
    # Un poco de ventaja para el que cotiza en la moneda en que pagaste (en euros: Xetra antes que Nasdaq)
    return abs(math.log(r)) + (0 if cot["divisa"] == info.get("divisa", "EUR") else 0.05)


def resolver(clave, info):
    """Encuentra el símbolo de un valor y trae su precio. Devuelve (cotización, candidatos)."""
    if info.get("simbolo"):   # ya elegido (por la web o por el robot otra vez)
        return cotizar(info["simbolo"], info["desde"]), None

    # ¿Lo escribiste como símbolo (AMZN, SAN.MC, BTC)? Se prueba directamente
    escrito = (info.get("nombre") or clave).strip()
    directos = []
    if info.get("tipo") == "cripto" and "-" not in escrito:
        directos.append(f"{escrito.upper()}-{'EUR' if info.get('divisa', 'EUR') == 'EUR' else 'USD'}")
    if escrito == escrito.upper() and PARECE_SIMBOLO.match(escrito):
        directos.append(escrito)
    for s in directos:
        try:
            cot = cotizar(s, info["desde"])
            if distancia(cot, info) is not None:
                return cot, None
        except Exception:
            pass

    # Si no, se busca por el nombre de varias formas. De cada búsqueda se queda el primer candidato que encaja
    # y, al final, el que tenga el precio más parecido al que pagaste.
    # Primera vuelta: solo bolsas grandes; segunda (si no hubo suerte): cualquiera.
    en_euros = info.get("divisa", "EUR") == "EUR"
    textos = textos_de_busqueda(clave, info.get("nombre"), info.get("tipo"))
    resultados = {}
    candidatos, probados, mejores = [], set(), []
    for vuelta in ("grandes", "todas"):
        if mejores:
            break
        for texto in textos:
            if texto not in resultados:
                try:
                    resultados[texto] = buscar(texto, info.get("nombre") or clave)
                except Exception:
                    resultados[texto] = []
                for c in resultados[texto]:
                    if all(c["simbolo"] != x["simbolo"] for x in candidatos):
                        candidatos.append(c)
            for c in ordenar(resultados[texto], info.get("tipo"), en_euros)[:8]:
                if c["simbolo"] in probados or (vuelta == "grandes" and c["codigoBolsa"] not in BOLSAS_GRANDES):
                    continue
                probados.add(c["simbolo"])
                try:
                    cot = cotizar(c["simbolo"], info["desde"])
                except Exception:
                    continue
                d = distancia(cot, info)
                if d is not None:
                    mejores.append((d, len(mejores), cot))
                    break
            if mejores and min(mejores)[0] < 0.03:   # casi el mismo precio que pagaste: no hace falta seguir
                break
    if mejores:
        return min(mejores)[2], candidatos[:8]
    if candidatos:
        raise NoEncaja(candidatos[:8])
    raise ValueError("no encuentro ningún valor con ese nombre")


class NoEncaja(ValueError):
    """Hay valores parecidos, pero ninguno con un precio como el que pagaste: se guardan para elegir a mano."""
    def __init__(self, candidatos):
        super().__init__("encuentro valores parecidos, pero ninguno con un precio como el que pagaste")
        self.candidatos = candidatos


def valores_de(cartera, anterior):
    """Qué valores hay en la cartera, desde qué fecha hacen falta sus cierres y lo que se sabe de cada uno."""
    activos = cartera.get("activos") or {}
    previos = anterior.get("activos") or {}
    valores = {}
    for op in (cartera.get("operaciones") or {}).values():
        if op.get("borrado") or not op.get("ticker") or not op.get("fecha"):
            continue
        clave, f = op["ticker"], date.fromisoformat(op["fecha"])
        if clave not in valores:
            a = activos.get(clave) or {}
            valores[clave] = {
                "desde": f,
                "nombre": a.get("nombre"),
                "tipo": a.get("tipo"),
                # el símbolo que eligió la web, o el que encontró el robot la vez anterior con ese mismo nombre
                "simbolo": a.get("simbolo") or ((previos.get(clave) or {}).get("simbolo")
                                                if (previos.get(clave) or {}).get("buscado") == a.get("nombre") else None),
                "divisa": op.get("divisa") or "EUR",
                "candidatos": (previos.get(clave) or {}).get("candidatos")
                              if (previos.get(clave) or {}).get("buscado") == a.get("nombre") else None,
            }
        valores[clave]["desde"] = min(f, valores[clave]["desde"])
        if op.get("tipo") == "compra" and op.get("precio"):   # para comprobar que el valor encontrado es el bueno
            valores[clave]["precioCompra"] = op["precio"]
            valores[clave]["divisa"] = op.get("divisa") or "EUR"
    return valores


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--datos", default="cartera", help="carpeta con cartera.json")
    p.add_argument("--salida", default="cotizaciones.json")
    p.add_argument("--anterior", default="", help="cotizaciones.json de la vez anterior (por si Yahoo falla)")
    p.add_argument("--prueba", default="", help="símbolos separados por comas (no guarda nada)")
    a = p.parse_args()

    anterior = {}
    if a.anterior and Path(a.anterior).exists():
        try:
            anterior = json.loads(Path(a.anterior).read_text(encoding="utf-8"))
        except ValueError:
            pass

    if a.prueba:
        hace_un_mes = date.today() - timedelta(days=30)
        # Formato: "nombre" o "nombre=precio pagado en euros" o "nombre=precio=tipo" (para probar la comprobación de precio)
        valores = {}
        for t in a.prueba.split(","):
            nombre, *resto = [x.strip() for x in t.split("=")]
            if nombre:
                valores[nombre] = {"desde": hace_un_mes, "nombre": nombre, "divisa": "EUR",
                                   "precioCompra": float(resto[0]) if resto else None, "tipo": resto[1] if len(resto) > 1 else None}
    else:
        archivo = Path(a.datos) / "cartera.json"
        if not archivo.exists():
            print("Aún no hay cartera.json: nada que hacer.")
            return
        valores = valores_de(json.loads(archivo.read_text(encoding="utf-8")), anterior)
    desde = {clave: info["desde"] for clave, info in valores.items()}

    salida = {"actualizado": None, "activos": {}, "divisas": {}, "errores": {}, "opciones": {}}
    for clave, info in sorted(valores.items()):
        try:
            cot, candidatos = resolver(clave, info)
            cot["simbolo"] = cot.pop("_simbolo")
            candidatos = candidatos or info.get("candidatos")   # las opciones de la búsqueda se conservan
            if candidatos:
                cot["candidatos"] = [{k: c[k] for k in ("simbolo", "nombre", "bolsa", "tipo")} for c in candidatos]
            cot["buscado"] = info.get("nombre")
            salida["activos"][clave] = cot
        except Exception as e:
            salida["errores"][clave] = str(e)[:120]
            if isinstance(e, NoEncaja):   # para que puedas elegir tú cuál es
                salida["opciones"][clave] = [{k: c[k] for k in ("simbolo", "nombre", "bolsa", "tipo")} for c in e.candidatos]
            # Si falla, se mantiene el último precio conocido (la web avisa del error)
            if clave in (anterior.get("activos") or {}):
                salida["activos"][clave] = anterior["activos"][clave]

    # Cambio de moneda a euros (desde la fecha más antigua que lo necesite)
    monedas = {}
    for simbolo, c in salida["activos"].items():
        if c["divisa"] != "EUR":
            monedas[c["divisa"]] = min(desde[simbolo], monedas.get(c["divisa"], desde[simbolo]))
    for moneda, inicio in monedas.items():
        try:
            fx = cotizar(f"{moneda}EUR=X", inicio)
            salida["divisas"][moneda] = {"precio": fx["precio"], "historico": fx["historico"]}
        except Exception as e:
            salida["errores"][f"{moneda}EUR"] = str(e)[:120]
            if moneda in (anterior.get("divisas") or {}):
                salida["divisas"][moneda] = anterior["divisas"][moneda]

    salida["actualizado"] = datetime.now(timezone.utc).isoformat(timespec="seconds")

    if a.prueba:
        for s, c in salida["activos"].items():
            print(f"{s[:22]:22} -> {c['simbolo']:10} {c['precio']:>12} {c['divisa']}  ayer {c['cierreAnterior']}  {c['nombre']} [{c.get('bolsa')}]")
            for o in c.get("candidatos", [])[:5]:
                print(f"{'':26}· {o['simbolo']:10} {o['tipo']:6} {o['bolsa']:12} {o['nombre']}")
        for m, fx in salida["divisas"].items():
            print(f"{m}->EUR      {fx['precio']}")
        for s, e in salida["errores"].items():
            print(f"ERROR {s}: {e}")
            for o in salida["opciones"].get(s, [])[:5]:
                print(f"{'':26}· {o['simbolo']:10} {o['tipo']:6} {o['bolsa']:12} {o['nombre']}")
        return

    Path(a.salida).write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Sin nombres de valores en el registro, por si acaso: solo cuántos
    print(f"Precios de {len(salida['activos'])} valores, {len(salida['divisas'])} monedas, {len(salida['errores'])} errores.")


if __name__ == "__main__":
    main()
