"""
vigilante.py - Comprueba los precios. Lo ejecuta GitHub Actions cada 3 h
y cuando pulsas "Comprobar" en la web, una vez por cada persona (repositorio privado).

Uso:     python vigilante.py --datos <carpeta de datos> [--producto ID] [--accion comprobar|buscar]

Lee:     productos.json         (tus productos y enlaces; lo edita la web)
Escribe: datos/estado.json      (último precio, envío, stock y error de cada enlace)
         datos/historial.json   (evolución de precios en euros, para gráficas)
         datos/busquedas/<producto>.json  (tiendas que ha encontrado la IA para ese producto)
Avisa:   notificación al móvil con ntfy si un producto llega a tu precio

Con el secreto GEMINI_API_KEY, además usa la IA (ver ia.py) SOLO para:
  - buscar tiendas a partir del nombre del producto (--accion buscar)
  - clasificar cada enlace (¿es el mismo producto?) y averiguar los gastos de envío
Los precios los lee siempre el lector (scraper.py); la IA nunca lee ni corrige precios.
"""
import argparse
import json
import os
import random
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import ia
import scraper

# Carpeta de datos (la del repositorio privado de cada persona). Se fija en main().
PRODUCTOS = ESTADO = HISTORIAL = BUSQUEDAS = None

PAUSA_ENTRE_ENLACES = (2, 5)   # segundos, para no saturar a las tiendas
DIAS_HISTORIAL = 365           # se borra lo más antiguo
NUEVO_PUNTO_CADA_HORAS = 20    # aunque el precio no cambie, guarda un punto al día
DIAS_ENVIO_IA = 7              # cada cuánto se vuelven a consultar los gastos de envío
MAX_CANDIDATOS = 10            # tiendas que se comprueban en cada búsqueda


def ahora():
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def de_iso(texto):
    return datetime.fromisoformat(texto.replace("Z", "+00:00"))


def leer(ruta, defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return defecto


def guardar(ruta, datos):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def euros(n):
    return format(n, ",.2f").replace(",", "X").replace(".", ",").replace("X", ".") + " €"


# ---------- Monedas (tipos de cambio diarios del Banco Central Europeo) ----------
TASAS = {"EUR": 1.0}


def cargar_tasas(estado):
    """Descarga los tipos de cambio del día. Si falla, usa los últimos guardados."""
    guardadas = estado.get("cambio", {})
    try:
        with urllib.request.urlopen("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml",
                                    timeout=15) as r:
            raiz = ET.fromstring(r.read())
        tasas = {c.get("currency"): float(c.get("rate"))
                 for c in raiz.iter() if c.get("currency") and c.get("rate")}
        if tasas:
            estado["cambio"] = {"fecha": iso(ahora()), "tasas": tasas}
    except Exception as e:
        print(f"  Sin tipos de cambio nuevos ({e}); uso los guardados")
    TASAS.update(estado.get("cambio", guardadas).get("tasas", {}))


def a_euros(importe, moneda):
    if importe is None:
        return None
    tasa = TASAS.get((moneda or "EUR").upper())
    return round(importe / tasa, 2) if tasa else None


def envio_en_euros(envio, precio_eur):
    """Aplica la regla de envío (coste fijo o gratis a partir de X) al precio actual."""
    if not envio:
        return None
    moneda = envio.get("moneda") or "EUR"
    gratis = a_euros(envio.get("gratis_desde"), moneda)
    if gratis is not None and precio_eur is not None and precio_eur >= gratis:
        return 0.0
    return a_euros(envio.get("coste"), moneda)


def calcular_totales(e, enlace):
    """Añade precio, envío y total en euros. Un envío escrito a mano en la web manda."""
    e["precio_eur"] = a_euros(e.get("precio"), e.get("moneda"))
    if enlace.get("envio") is not None:
        e["envio_eur"] = float(enlace["envio"])
        e["envio_fuente"] = "manual"
    else:
        e["envio_eur"] = envio_en_euros(e.get("envio"), e["precio_eur"])
        e["envio_fuente"] = (e.get("envio") or {}).get("fuente")
    e["total_eur"] = (round(e["precio_eur"] + (e["envio_eur"] or 0), 2)
                      if e["precio_eur"] is not None else None)


# ---------- Comprobar ----------
def comprobar_enlace(url, anterior):
    """Devuelve el nuevo estado del enlace (conserva el último precio si falla)."""
    nuevo = dict(anterior)
    nuevo["tienda"] = scraper.nombre_tienda(url)
    nuevo["ultima_lectura"] = iso(ahora())
    try:
        d = scraper.comprobar(url)
    except scraper.ErrorLectura as e:
        nuevo["error"] = str(e)
    except Exception as e:  # fallo imprevisto: también a la zona de errores
        nuevo["error"] = f"Error inesperado: {type(e).__name__}: {e}"[:300]
    else:
        nuevo.update(precio=d["precio"], moneda=d["moneda"], stock=d["stock"], error=None,
                     ultimo_ok=nuevo["ultima_lectura"])
        nuevo.pop("fuente", None)
        if d.get("imagen"):
            nuevo["imagen"] = d["imagen"]
        if d.get("titulo"):
            nuevo["titulo"] = d["titulo"]
        # El envío que publica la propia tienda manda sobre el que averiguó la IA
        if d.get("envio") and (d["envio"]["fuente"] == "tienda" or not nuevo.get("envio")):
            nuevo["envio"] = {**d["envio"], "actualizado": nuevo["ultima_lectura"]}
    return nuevo


def anotar_historial(historial, enlace_id, e):
    if e.get("error"):
        return
    puntos = historial.setdefault(enlace_id, [])
    precio = e.get("precio_eur") if e.get("precio_eur") is not None else e.get("precio")
    punto = [e["ultima_lectura"], precio, e.get("stock")]
    if puntos:
        ultimo = puntos[-1]
        igual = ultimo[1] == punto[1] and ultimo[2] == punto[2]
        reciente = de_iso(punto[0]) - de_iso(ultimo[0]) < timedelta(hours=NUEVO_PUNTO_CADA_HORAS)
        if igual and reciente:
            return
    puntos.append(punto)


def limpiar(estado, historial, productos):
    """Quita los datos de enlaces y productos que ya no existen y el historial muy antiguo."""
    ids_validos = {e["id"] for p in productos for e in p.get("enlaces", [])}
    for tabla in (estado["enlaces"], historial):
        for eid in list(tabla):
            if eid not in ids_validos:
                del tabla[eid]
    if BUSQUEDAS.exists():
        for archivo in BUSQUEDAS.glob("*.json"):
            if archivo.stem not in {p["id"] for p in productos}:
                archivo.unlink()
    limite = iso(ahora() - timedelta(days=DIAS_HISTORIAL))
    for eid, puntos in historial.items():
        historial[eid] = [p for p in puntos if p[0] >= limite] or puntos[-1:]


# ---------- Tareas de IA sobre los enlaces ya guardados ----------
def revisar_con_ia(productos, estado, solo):
    """Envío y "¿es el mismo producto?" para enlaces nuevos o con datos viejos."""
    if not ia.activa():
        return
    hace_dias = iso(ahora() - timedelta(days=DIAS_ENVIO_IA))
    for p in productos:
        if solo and p["id"] != solo:
            continue
        enlaces = [(en, estado["enlaces"].get(en["id"], {})) for en in p.get("enlaces", [])]
        leidos = [(en, e) for en, e in enlaces if e.get("precio") is not None and not e.get("error")]

        # 1. ¿Es el mismo producto? Solo si el enlace es nuevo o su título ha cambiado
        pendientes = [(en, e) for en, e in leidos
                      if not en.get("coincide_ok") and (e.get("coincide") or {}).get("titulo") != e.get("titulo")]
        if pendientes:
            try:
                res = ia.revisar_enlaces(p["nombre"], p.get("descripcion", ""), [
                    {"id": en["id"], "tienda": e.get("tienda"), "titulo": e.get("titulo"),
                     "precio": e.get("precio"), "moneda": e.get("moneda")} for en, e in leidos])
                for en, e in pendientes:
                    if en["id"] in res:
                        e["coincide"] = {**res[en["id"]], "titulo": e.get("titulo")}
                print(f"  [IA] {p['nombre']}: revisados {len(pendientes)} enlaces")
            except ia.ErrorIA as err:
                print(f"  [IA] {p['nombre']}: no se pudieron revisar los enlaces ({err})")

        # 2. Gastos de envío que no publica la tienda
        sin_envio = [(en, e) for en, e in leidos if en.get("envio") is None and (
            not e.get("envio") or (e["envio"].get("fuente") == "IA" and e["envio"].get("actualizado", "") < hace_dias))]
        if sin_envio:
            try:
                res = ia.consultar_envio([{"id": en["id"], "url": en["url"], "tienda": e.get("tienda")}
                                          for en, e in sin_envio])
                for en, e in sin_envio:
                    if en["id"] in res:
                        e["envio"] = {**res[en["id"]], "actualizado": iso(ahora())}
                    elif e.get("envio"):
                        e["envio"]["actualizado"] = iso(ahora())   # no volver a preguntar hasta dentro de unos días
                print(f"  [IA] {p['nombre']}: envío consultado en {len(sin_envio)} tiendas")
            except ia.ErrorIA as err:
                print(f"  [IA] {p['nombre']}: no se pudo consultar el envío ({err})")

        for en, e in enlaces:
            if e:
                calcular_totales(e, en)


# ---------- Ofertas y avisos ----------
def valido_para_oferta(en, e):
    return (e.get("total_eur") is not None and e.get("stock") is not False and not e.get("error")
            and (en.get("coincide_ok") or (e.get("coincide") or {}).get("veredicto") != "no"))


def mejor_oferta(producto, enlaces_estado):
    validos = []
    for enlace in producto.get("enlaces", []):
        e = enlaces_estado.get(enlace["id"], {})
        if valido_para_oferta(enlace, e):
            validos.append({**e, "url": enlace["url"]})
    return min(validos, key=lambda e: e["total_eur"]) if validos else None


def avisar(titulo, mensaje, url):
    tema = os.environ.get("NTFY_TOPIC", "").strip()
    if not tema:
        return
    servidor = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    cuerpo = json.dumps({"topic": tema, "title": titulo, "message": mensaje,
                         "click": url, "tags": ["moneybag"], "priority": 4}).encode()
    peticion = urllib.request.Request(servidor, data=cuerpo, method="POST",
                                      headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(peticion, timeout=15).close()
        print(f"  Aviso enviado: {titulo}")
    except Exception as e:
        print(f"  No se pudo enviar el aviso: {e}")


def revisar_ofertas(productos, estado):
    actuales = {}
    for p in productos:
        mejor = mejor_oferta(p, estado["enlaces"])
        if mejor and p.get("precio_deseado") and mejor["total_eur"] <= p["precio_deseado"]:
            actuales[p["id"]] = (p, mejor)
    avisadas = set(estado.get("ofertas_avisadas", []))
    for pid, (p, mejor) in actuales.items():
        if pid not in avisadas:
            envio = " con envío" if mejor.get("envio_eur") is not None else ""
            avisar(f"¡Oferta! {p['nombre']}",
                   f"{euros(mejor['total_eur'])}{envio} en {mejor.get('tienda', 'la tienda')} "
                   f"(tu objetivo: {euros(p['precio_deseado'])})",
                   mejor["url"])
    # Solo se avisa una vez; si deja de estar en oferta y vuelve, se avisa otra vez
    estado["ofertas_avisadas"] = sorted(actuales)


# ---------- Buscar tiendas con IA ----------
RE_ASIN = re.compile(r"/(?:dp|gp/product|gp/aw/d)/([A-Z0-9]{10})", re.I)


def clave_url(url):
    """Para no repetir la misma ficha con distintos parámetros."""
    p = urlparse(url)
    host = (p.hostname or "").lower().removeprefix("www.")
    m = RE_ASIN.search(p.path)
    if "amazon." in host and m:
        return f"{host}/dp/{m.group(1).upper()}"
    return host + p.path.rstrip("/").lower()


def limpiar_url(url):
    """Quita el rastreo (utm_, srsltid...) que añade Google a los enlaces."""
    p = urlparse(url)
    query = "&".join(q for q in p.query.split("&")
                     if q and not q.lower().startswith(("utm_", "srsltid", "gclid", "fbclid")))
    return urlunparse(p._replace(query=query, fragment=""))


def buscar(producto):
    """Busca tiendas para el producto y devuelve el resultado (se guarda en datos/busquedas/)."""
    registro = {"inicio": iso(ahora()), "fin": None, "error": None, "candidatos": [], "descartados": 0}
    if not ia.activa():
        registro.update(error="La búsqueda con IA aún no está activada (falta la clave de Gemini).",
                        fin=iso(ahora()))
        return registro
    print(f"Buscando tiendas para «{producto['nombre']}»...")
    try:
        encontrados = ia.buscar_tiendas(producto["nombre"], producto.get("descripcion", ""))
    except ia.ErrorIA as e:
        registro.update(error=f"La IA no pudo buscar: {e}", fin=iso(ahora()))
        return registro

    ya = {clave_url(en["url"]) for en in producto.get("enlaces", [])}
    hosts_ya = set()
    candidatos = []
    for c in encontrados:
        url = c["url"]
        if c.get("redireccion") or "vertexaisearch" in url:
            url = scraper.resolver_redireccion(url)
            if not url:
                continue
        url = limpiar_url(url)
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")
        if clave_url(url) in ya or host in hosts_ya or len(urlparse(url).path) < 3:
            continue
        hosts_ya.add(host)          # una ficha por tienda
        candidatos.append({**c, "url": url})
    candidatos = candidatos[:MAX_CANDIDATOS]
    print(f"  La IA propone {len(candidatos)} tiendas; compruebo cada una")

    verificados = []
    for i, c in enumerate(candidatos):
        if i:
            time.sleep(random.uniform(1, 3))
        try:
            d = scraper.comprobar(c["url"])     # el precio lo lee siempre el lector, nunca la IA
        except scraper.ErrorLectura as e:
            print(f"  ✗ {c['url'][:80]}: {e}")
            registro["descartados"] += 1
            continue
        except Exception as e:
            print(f"  ✗ {c['url'][:80]}: {type(e).__name__}")
            registro["descartados"] += 1
            continue
        envio = d.get("envio") or c.get("envio")
        cand = {"id": f"c{i}", "url": c["url"], "tienda": scraper.nombre_tienda(c["url"]),
                "pais": c.get("pais"), "titulo": d.get("titulo"), "imagen": d.get("imagen"),
                "precio": d["precio"], "moneda": d["moneda"], "stock": d.get("stock"),
                "envio": envio}
        calcular_totales(cand, {})
        verificados.append(cand)
        print(f"  ✓ {cand['tienda']}: {cand['precio']} {cand['moneda']}")

    if verificados:
        try:
            revision = ia.revisar_enlaces(producto["nombre"], producto.get("descripcion", ""), verificados)
            for c in verificados:
                if c["id"] in revision:
                    c["coincide"] = {**revision[c["id"]], "titulo": c.get("titulo")}
        except ia.ErrorIA as e:
            print(f"  (No se pudo revisar si son el mismo producto: {e})")

    orden = {"si": 0, "variante": 1, None: 1, "no": 2}
    verificados.sort(key=lambda c: (orden.get((c.get("coincide") or {}).get("veredicto")),
                                    c["stock"] is False, c.get("total_eur") or 1e9))
    registro["candidatos"] = verificados
    registro["fin"] = iso(ahora())
    if not verificados:
        registro["error"] = ("La IA no ha encontrado tiendas con precio legible. Prueba con un nombre más "
                             "concreto (marca y modelo) o pega los enlaces a mano.")
    return registro


def semilla(url, pid):
    """Si el enlace salió de una búsqueda, aprovecha lo que ya se averiguó (envío, revisión)."""
    busqueda = leer(BUSQUEDAS / f"{pid}.json", {})
    for c in busqueda.get("candidatos", []):
        if clave_url(c["url"]) == clave_url(url):
            datos = {k: c[k] for k in ("envio", "coincide", "titulo", "imagen") if c.get(k)}
            if datos.get("envio"):
                datos["envio"] = {**datos["envio"], "actualizado": busqueda.get("fin") or iso(ahora())}
            return datos
    return {}


# ---------- Programa ----------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--datos", required=True, help="Carpeta con productos.json y datos/")
    parser.add_argument("--producto", default="", help="ID del producto (vacío = todos)")
    parser.add_argument("--accion", default="comprobar", choices=["comprobar", "buscar"])
    args = parser.parse_args()
    solo = args.producto.strip()

    global PRODUCTOS, ESTADO, HISTORIAL, BUSQUEDAS
    carpeta = Path(args.datos).resolve()
    PRODUCTOS = carpeta / "productos.json"
    ESTADO = carpeta / "datos" / "estado.json"
    HISTORIAL = carpeta / "datos" / "historial.json"
    BUSQUEDAS = carpeta / "datos" / "busquedas"

    productos = leer(PRODUCTOS, [])
    estado = leer(ESTADO, {})
    estado.setdefault("enlaces", {})
    historial = leer(HISTORIAL, {})
    cargar_tasas(estado)
    print(f"IA (Gemini): {'activada' if ia.activa() else 'desactivada (falta GEMINI_API_KEY)'}")

    if args.accion == "buscar":
        producto = next((p for p in productos if p["id"] == solo), None)
        if not producto:
            print("No existe ese producto.")
            return
        guardar(BUSQUEDAS / f"{producto['id']}.json", buscar(producto))
        print(f"Terminado. Consultas a la IA: {ia.llamadas()}")
        return

    inicio = iso(ahora())
    objetivo = [p for p in productos if not solo or p["id"] == solo]
    enlaces = [(p, e) for p in objetivo for e in p.get("enlaces", [])]
    print(f"Comprobando {len(enlaces)} enlaces de {len(objetivo)} productos...")
    enlaces.sort(key=lambda pe: scraper.nombre_tienda(pe[1]["url"]))  # alterna menos entre tiendas

    for i, (p, enlace) in enumerate(enlaces):
        if i:
            time.sleep(random.uniform(*PAUSA_ENTRE_ENLACES))
        anterior = estado["enlaces"].get(enlace["id"]) or semilla(enlace["url"], p["id"])
        e = comprobar_enlace(enlace["url"], anterior)
        calcular_totales(e, enlace)
        estado["enlaces"][enlace["id"]] = e
        resultado = f"ERROR: {e['error']}" if e.get("error") else (
            "agotado" if e.get("stock") is False else f"{e['precio']} {e['moneda']}")
        print(f"  [{e['tienda']}] {p['nombre']}: {resultado}")

    revisar_con_ia(objetivo, estado, solo)
    for p, enlace in enlaces:
        anotar_historial(historial, enlace["id"], estado["enlaces"][enlace["id"]])

    limpiar(estado, historial, productos)
    revisar_ofertas(productos, estado)
    estado["ejecucion"] = {"inicio": inicio, "fin": iso(ahora()), "producto": solo or None}
    if not solo:
        estado["ultima_revision"] = estado["ejecucion"]["fin"]

    guardar(ESTADO, estado)
    guardar(HISTORIAL, historial)
    print(f"Terminado. Consultas a la IA: {ia.llamadas()}")


if __name__ == "__main__":
    main()
