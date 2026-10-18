"""cotizar.py - El robot de la cartera: trae el precio de cada valor que tienes.

Lo ejecuta GitHub Actions dentro del repositorio PRIVADO de datos (WEBS):
  1. Lee cartera/cartera.json (tus operaciones) para saber qué valores hay.
  2. Pide a Yahoo Finance el precio actual y los cierres diarios de cada uno
     (y el cambio de moneda, si alguno no está en euros).
  3. Escribe cartera/cotizaciones.json, que lee la web.

Solo usa la librería estándar de Python (no hay que instalar nada, así arranca en segundos).
A Yahoo solo se le pide el símbolo de cada valor: nunca las cantidades ni nada tuyo.

Uso:  python cotizar.py --datos cartera --salida cotizaciones.json
      python cotizar.py --prueba "AAPL,SAN.MC,BTC-EUR"     (solo prueba: muestra los precios)
"""

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

URL_YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={}&interval=1d&includePrePost=false"
URL_YAHOO_2 = "https://query2.finance.yahoo.com/v8/finance/chart/{}?range={}&interval=1d&includePrePost=false"
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
        "precio": round(precio * factor, 6),
        "cierreAnterior": round(cierre_anterior * (factor if not anteriores else 1), 6) if cierre_anterior else None,
        "divisa": divisa,
        "nombre": meta.get("longName") or meta.get("shortName") or simbolo,
        "tipo": (meta.get("instrumentType") or "").lower(),
        "bolsa": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "hora": datetime.fromtimestamp(hora, timezone.utc).isoformat() if hora else None,
        "historico": {"d": fechas, "c": [hist[d] for d in fechas]},
    }


def valores_de(cartera):
    """Qué símbolos hay en la cartera y desde qué fecha hacen falta sus cierres."""
    desde = {}
    for op in (cartera.get("operaciones") or {}).values():
        if op.get("borrado") or not op.get("ticker") or not op.get("fecha"):
            continue
        f = date.fromisoformat(op["fecha"])
        desde[op["ticker"]] = min(f, desde.get(op["ticker"], f))
    return desde


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--datos", default="cartera", help="carpeta con cartera.json")
    p.add_argument("--salida", default="cotizaciones.json")
    p.add_argument("--anterior", default="", help="cotizaciones.json de la vez anterior (por si Yahoo falla)")
    p.add_argument("--prueba", default="", help="símbolos separados por comas (no guarda nada)")
    a = p.parse_args()

    if a.prueba:
        desde = {s.strip().upper(): date.today() - timedelta(days=30) for s in a.prueba.split(",") if s.strip()}
    else:
        archivo = Path(a.datos) / "cartera.json"
        if not archivo.exists():
            print("Aún no hay cartera.json: nada que hacer.")
            return
        desde = valores_de(json.loads(archivo.read_text(encoding="utf-8")))

    anterior = {}
    if a.anterior and Path(a.anterior).exists():
        try:
            anterior = json.loads(Path(a.anterior).read_text(encoding="utf-8"))
        except ValueError:
            pass

    salida = {"actualizado": None, "activos": {}, "divisas": {}, "errores": {}}
    for simbolo, inicio in sorted(desde.items()):
        try:
            salida["activos"][simbolo] = cotizar(simbolo, inicio)
        except Exception as e:
            salida["errores"][simbolo] = str(e)[:120]
            # Si falla, se mantiene el último precio conocido (la web avisa del error)
            if simbolo in (anterior.get("activos") or {}):
                salida["activos"][simbolo] = anterior["activos"][simbolo]

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
            print(f"{s:12} {c['precio']:>12} {c['divisa']}  ayer {c['cierreAnterior']}  {c['nombre']}  ({len(c['historico']['d'])} días)")
        for m, fx in salida["divisas"].items():
            print(f"{m}->EUR      {fx['precio']}")
        for s, e in salida["errores"].items():
            print(f"ERROR {s}: {e}")
        return

    Path(a.salida).write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # Sin nombres de valores en el registro, por si acaso: solo cuántos
    print(f"Precios de {len(salida['activos'])} valores, {len(salida['divisas'])} monedas, {len(salida['errores'])} errores.")
    if salida["errores"] and not salida["activos"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
