"""
avisos.py - Manda al móvil (con ntfy) los recordatorios de las notas del calendario.

Lo ejecuta GitHub Actions una vez al día desde el repositorio privado de datos (WEBS).
Lee calendario/notas.json y avisa de:
  - Todo lo que tengas MAÑANA.
  - Los cumpleaños y las notas importantes (categoría Importante o destacadas con ★)
    también con 10 días de antelación.

Uso:     python avisos.py --notas calendario/notas.json [--prueba]
Necesita el secreto NTFY_TOPIC (el mismo canal del Vigilante de precios).
"""
import argparse
import json
import os
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

# ===== Ajustes =====
ZONA = ZoneInfo("Europe/Madrid")
URL_CALENDARIO = "https://hojairu.github.io/calendario/"
AVISO_NORMAL = [1]              # resto de notas: el día antes
AVISO_IMPORTANTE = [10, 1]      # importantes y destacadas: 10 días antes y el día antes
AVISO_CUMPLE = [10, 1]          # cumpleaños: 10 días antes y el día antes

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


def dias_de_aviso(nota):
    if nota.get("cat") == "cumple":
        return AVISO_CUMPLE
    if nota.get("cat") == "importante" or nota.get("destacada"):
        return AVISO_IMPORTANTE
    return AVISO_NORMAL


def proxima_fecha(nota, hoy):
    """Fecha del evento. Los cumpleaños se repiten cada año."""
    fecha = date.fromisoformat(nota["fecha"])
    if nota.get("cat") != "cumple":
        return fecha
    for anio in (hoy.year, hoy.year + 1):
        try:
            f = fecha.replace(year=anio)
        except ValueError:          # 29 de febrero en año no bisiesto
            f = date(anio, 2, 28)
        if f >= hoy:
            return f
    return None


def recordatorios(notas, hoy):
    """Lista de (días que faltan, fecha, nota) que toca avisar hoy."""
    lista = []
    for nota in notas.values():
        if nota.get("borrada") or nota.get("hecha") or not nota.get("fecha"):
            continue
        fecha = proxima_fecha(nota, hoy)
        if not fecha:
            continue
        faltan = (fecha - hoy).days
        if faltan in dias_de_aviso(nota):
            lista.append((faltan, fecha, nota))
    lista.sort(key=lambda r: (r[0], r[2].get("hora") or "99"))
    return lista


def linea(faltan, fecha, nota):
    cuando = "Mañana" if faltan == 1 else f"En {faltan} días ({fecha.day} de {MESES[fecha.month - 1]})"
    icono = "🎂 " if nota.get("cat") == "cumple" else ("★ " if nota.get("destacada") or nota.get("cat") == "importante" else "")
    hora = f" a las {nota['hora']}" if nota.get("hora") else ""
    return f"{cuando}{hora}: {icono}{nota.get('texto', '').strip()}"


def enviar(titulo, mensaje, prioridad):
    tema = os.environ.get("NTFY_TOPIC", "").strip()
    if not tema:
        print("Falta el secreto NTFY_TOPIC: no se envía nada.")
        return False
    servidor = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
    cuerpo = json.dumps({"topic": tema, "title": titulo, "message": mensaje, "click": URL_CALENDARIO,
                         "tags": ["calendar"], "priority": prioridad}).encode()
    peticion = urllib.request.Request(servidor, data=cuerpo, method="POST",
                                      headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(peticion, timeout=20) as r:
        print(f"Aviso enviado (HTTP {r.status}).")
    return True


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--notas", required=True)
    args.add_argument("--prueba", action="store_true", help="manda un aviso de prueba aunque no toque nada")
    args = args.parse_args()

    hoy = datetime.now(ZONA).date()
    ruta = Path(args.notas)
    notas = json.loads(ruta.read_text(encoding="utf-8")).get("notas", {}) if ruta.exists() else {}
    lista = recordatorios(notas, hoy)
    # En los registros de GitHub no se escribe el texto de las notas (privacidad): solo cuántas hay
    print(f"{hoy}: {len(notas)} notas guardadas, {len(lista)} recordatorios para hoy.")

    if lista:
        lineas = [linea(*r) for r in lista]
        titulo = "Mañana tienes algo" if all(r[0] == 1 for r in lista) else "Recordatorios del calendario"
        if len(lista) == 1:
            titulo = lineas[0].split(": ", 1)[0]
            lineas = [lineas[0].split(": ", 1)[1]]
        urgente = any(r[0] == 1 and dias_de_aviso(r[2]) is not AVISO_NORMAL for r in lista)
        enviar(titulo, "\n".join(lineas), 4 if urgente else 3)
    elif args.prueba:
        enviar("Avisos del calendario activados",
               "Te avisaré la víspera de cada nota, y 10 días antes de cumpleaños y cosas importantes.", 3)


if __name__ == "__main__":
    main()
