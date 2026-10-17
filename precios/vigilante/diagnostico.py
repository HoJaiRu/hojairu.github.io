"""
diagnostico.py - Prueba temporal: qué forma de descargar funciona con cada tienda desde GitHub.
Escribe <datos>/datos/diagnostico.json. Solo para ajustar el lector; no lo usa la web.
"""
import json
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import scraper

URLS = [
    "https://www.sephora.es/p/le-male-elixir---eau-de-parfum-P10051068.html",
    "https://www.aromas.es/jpg-lemale-elixir-parfum-edp-hombre/136959M.html",
    "https://www.perfumesclub.com/es/jean-paul-gaultier/le-male-elixir-parfum-limited",
    "https://www.druni.es/le-male-elixir-jean-paul-gaultier-eau-parfum-hombre",
]
BUSCAR = [  # (dominio, producto) -> se busca una ficha en DuckDuckGo
    ("elcorteingles.es", "AirPods Pro 2"), ("pccomponentes.com", "AirPods Pro 2"), ("fnac.es", "AirPods Pro 2"),
    ("carrefour.es", "AirPods Pro 2"), ("worten.es", "AirPods Pro 2"), ("coolmod.com", "Razer Viper V3 Pro"),
    ("decathlon.es", "zapatillas running"), ("zalando.es", "Nike Air Force 1"), ("notino.es", "Le Male Elixir"),
    ("primor.eu", "Le Male Elixir"), ("ikea.com", "Billy estantería"), ("lidl.es", "freidora de aire"),
    ("apple.com", "AirPods Pro 2"), ("aliexpress.com", "Xiaomi Redmi Buds"), ("ebay.es", "AirPods Pro 2"),
    ("leroymerlin.es", "taladro Bosch"), ("mediamarkt.es", "AirPods Pro 2"),
]
IMITAR = ["chrome", "safari", "safari_ios", "firefox", "edge", "chrome_android"]


def probar(url, imitar=None, jina=False):
    t = time.time()
    try:
        if jina:
            r = scraper.http.get("https://r.jina.ai/" + url, timeout=40,
                                 headers={"X-Return-Format": "html", "Accept": "text/html"})
            if r.status_code >= 400:
                return {"r": f"HTTP {r.status_code}"}
            html = r.text
        else:
            html = scraper.descargar(url, imitar=imitar)
        d = scraper.analizar(html, url)
        return {"r": "OK", "precio": d["precio"], "titulo": (d["titulo"] or "")[:60], "s": round(time.time() - t, 1)}
    except scraper.ErrorLectura as e:
        return {"r": f"{e.tipo}: {e}"[:120]}
    except Exception as e:
        return {"r": f"{type(e).__name__}: {e}"[:120]}


def main():
    salida = Path(sys.argv[1]) / "datos" / "diagnostico.json"
    urls = list(URLS)
    for dominio, q in BUSCAR:
        res = [r for r in scraper.buscar_en_web(f"site:{dominio} {q}") if dominio.split(".")[0] in (urlparse(r["url"]).hostname or "")]
        urls.append(res[0]["url"] if res else f"(sin resultado en buscador: {dominio})")
        time.sleep(2)
    informe = {}
    for url in urls:
        if not url.startswith("http"):
            informe[url] = {}
            continue
        fila = {}
        for imitar in IMITAR:
            fila[imitar] = probar(url, imitar)
            time.sleep(1)
            if fila[imitar]["r"] == "OK" and imitar == "chrome":
                break
        if fila.get("chrome", {}).get("r") != "OK":
            fila["jina"] = probar(url, jina=True)
        informe[url] = fila
        print(url, {k: v["r"][:30] for k, v in fila.items()})
    salida.write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
