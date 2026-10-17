"""
vigilante.py - Comprueba los precios. Lo ejecuta GitHub Actions cada 3 h
y cuando pulsas "Comprobar" en la web, una vez por cada persona (repositorio privado).

Uso:     python vigilante.py --datos <carpeta de datos> [--producto ID]

Lee:     productos.json         (tus productos y enlaces; lo edita la web)
Escribe: datos/estado.json      (último precio, stock y error de cada enlace)
         datos/historial.json   (evolución de precios, para gráficas)
Avisa:   notificación al móvil con ntfy si un producto llega a tu precio
"""
import argparse
import json
import os
import random
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import scraper

# Carpeta de datos (la del repositorio privado de cada persona). Se fija en main().
PRODUCTOS = ESTADO = HISTORIAL = None

PAUSA_ENTRE_ENLACES = (2, 5)   # segundos, para no saturar a las tiendas
DIAS_HISTORIAL = 365           # se borra lo más antiguo
NUEVO_PUNTO_CADA_HORAS = 20    # aunque el precio no cambie, guarda un punto al día


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
        if d["imagen"]:
            nuevo["imagen"] = d["imagen"]
        if d["titulo"]:
            nuevo["titulo"] = d["titulo"]
    return nuevo


def anotar_historial(historial, enlace_id, e):
    if e.get("error"):
        return
    puntos = historial.setdefault(enlace_id, [])
    punto = [e["ultima_lectura"], e.get("precio"), e.get("stock")]
    if puntos:
        ultimo = puntos[-1]
        igual = ultimo[1] == punto[1] and ultimo[2] == punto[2]
        reciente = de_iso(punto[0]) - de_iso(ultimo[0]) < timedelta(hours=NUEVO_PUNTO_CADA_HORAS)
        if igual and reciente:
            return
    puntos.append(punto)


def limpiar(estado, historial, ids_validos):
    """Quita los datos de enlaces que ya no existen y el historial muy antiguo."""
    for tabla in (estado["enlaces"], historial):
        for eid in list(tabla):
            if eid not in ids_validos:
                del tabla[eid]
    limite = iso(ahora() - timedelta(days=DIAS_HISTORIAL))
    for eid, puntos in historial.items():
        historial[eid] = [p for p in puntos if p[0] >= limite] or puntos[-1:]


# ---------- Ofertas y avisos ----------
def mejor_oferta(producto, enlaces_estado):
    validos = []
    for enlace in producto.get("enlaces", []):
        e = enlaces_estado.get(enlace["id"], {})
        if e.get("precio") is not None and e.get("stock") is not False and not e.get("error"):
            validos.append({**e, "url": enlace["url"]})
    return min(validos, key=lambda e: e["precio"]) if validos else None


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
        if mejor and p.get("precio_deseado") and mejor["precio"] <= p["precio_deseado"]:
            actuales[p["id"]] = (p, mejor)
    avisadas = set(estado.get("ofertas_avisadas", []))
    for pid, (p, mejor) in actuales.items():
        if pid not in avisadas:
            avisar(f"¡Oferta! {p['nombre']}",
                   f"{euros(mejor['precio'])} en {mejor.get('tienda', 'la tienda')} "
                   f"(tu objetivo: {euros(p['precio_deseado'])})",
                   mejor["url"])
    # Solo se avisa una vez; si deja de estar en oferta y vuelve, se avisa otra vez
    estado["ofertas_avisadas"] = sorted(actuales)


# ---------- Programa ----------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--datos", required=True, help="Carpeta con productos.json y datos/")
    parser.add_argument("--producto", default="", help="ID del producto (vacío = todos)")
    args = parser.parse_args()
    solo = args.producto.strip()

    global PRODUCTOS, ESTADO, HISTORIAL
    carpeta = Path(args.datos).resolve()
    PRODUCTOS = carpeta / "productos.json"
    ESTADO = carpeta / "datos" / "estado.json"
    HISTORIAL = carpeta / "datos" / "historial.json"

    productos = leer(PRODUCTOS, [])
    estado = leer(ESTADO, {})
    estado.setdefault("enlaces", {})
    historial = leer(HISTORIAL, {})
    inicio = iso(ahora())

    objetivo = [p for p in productos if not solo or p["id"] == solo]
    enlaces = [(p, e) for p in objetivo for e in p.get("enlaces", [])]
    print(f"Comprobando {len(enlaces)} enlaces de {len(objetivo)} productos...")
    enlaces.sort(key=lambda pe: scraper.nombre_tienda(pe[1]["url"]))  # alterna menos entre tiendas

    for i, (p, enlace) in enumerate(enlaces):
        if i:
            time.sleep(random.uniform(*PAUSA_ENTRE_ENLACES))
        e = comprobar_enlace(enlace["url"], estado["enlaces"].get(enlace["id"], {}))
        estado["enlaces"][enlace["id"]] = e
        anotar_historial(historial, enlace["id"], e)
        resultado = f"ERROR: {e['error']}" if e.get("error") else (
            "agotado" if e.get("stock") is False else euros(e["precio"]))
        print(f"  [{e['tienda']}] {p['nombre']}: {resultado}")

    limpiar(estado, historial, {e["id"] for p in productos for e in p.get("enlaces", [])})
    revisar_ofertas(productos, estado)
    estado["ejecucion"] = {"inicio": inicio, "fin": iso(ahora()), "producto": solo or None}
    if not solo:
        estado["ultima_revision"] = estado["ejecucion"]["fin"]

    guardar(ESTADO, estado)
    guardar(HISTORIAL, historial)
    print("Terminado.")


if __name__ == "__main__":
    main()
