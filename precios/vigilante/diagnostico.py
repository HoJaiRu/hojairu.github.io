"""
diagnostico.py - Prueba temporal: qué tiendas se leen desde GitHub y con qué método.
Escribe <datos>/datos/diagnostico.json. Solo para ajustar el lector; no lo usa la web.
"""
import json
import sys
import time
from pathlib import Path

import ia
import scraper

URLS = [
    "https://www.aromas.es/jpg-lemale-elixir-parfum-edp-hombre/136959M.html",
    "https://www.pccomponentes.com/airpods-pro-2a-generacion-con-estuche-de-carga-inalambrica-usb-c-",
]
PRODUCTOS = ["Apple AirPods Pro 2", "Diesel Only The Brave Eau de Toilette", "Nike Air Force 1 '07 blancas",
             "Freidora de aire Cosori 5,5 L"]


def probar(url, metodo):
    t = time.time()
    try:
        if metodo == "navegador":
            d = scraper.analizar(scraper.descargar_navegador(url), url)
        else:
            d = scraper.comprobar(url)
        return {"r": "OK", "precio": d["precio"], "titulo": (d["titulo"] or "")[:60], "s": round(time.time() - t, 1)}
    except scraper.ErrorLectura as e:
        return {"r": f"{e.tipo}: {e}"[:140], "s": round(time.time() - t, 1)}
    except Exception as e:
        return {"r": f"{type(e).__name__}: {e}"[:140]}


def main():
    salida = Path(sys.argv[1]) / "datos" / "diagnostico.json"
    urls, busquedas = list(URLS), {}
    for p in PRODUCTOS:
        try:
            enc = ia.buscar_tiendas(p)
            busquedas[p] = len(enc)
            urls += [c["url"] for c in enc if not c.get("redireccion")][:8]
        except ia.ErrorIA as e:
            busquedas[p] = str(e)[:200]
    informe = {"_busquedas": busquedas, "_ia": ia.diagnostico}
    for url in dict.fromkeys(urls):
        fila = {"lector": probar(url, "lector")}
        if fila["lector"]["r"] != "OK":
            fila["navegador"] = probar(url, "navegador")
        informe[url] = fila
        print(url[:80], {k: v["r"][:40] for k, v in fila.items()})
    salida.write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
