"""
diagnostico.py - Prueba temporal: qué imitaciones de navegador pasan el bloqueo de cada tienda
y si el buscador acepta búsquedas por tienda (site:). Escribe <datos>/datos/diagnostico.json. No lo usa la web.
"""
import json
import sys
import time
from pathlib import Path

from bs4 import BeautifulSoup
from curl_cffi import requests as http

import scraper

URLS = [
    "https://www.carrefour.es/altavoz-inalambrico-jbl-charge-5-negro/VC4A-13856264/p",
    "https://www.pccomponentes.com/freidora-de-aire-cosori-smart-chef-edition-55-l-1700-w-wi-fi",
    "https://www.notino.es/diesel/only-the-brave-eau-de-toilette-para-hombre/",
    "https://www.sephora.es/p/the-one-for-men---eau-de-parfum-P340017.html",
]
IMITACIONES = ["chrome", "chrome131_android", "edge", "firefox", "safari", "safari_ios", "chrome_android"]
BUSQUEDAS = ["dolce gabbana the one hombre (site:druni.es OR site:primor.eu OR site:notino.es OR site:douglas.es)",
             "google pixel 10a site:mediamarkt.es"]
LIMITE = 300


def probar(url, imitar, calentar):
    t = time.time()
    try:
        s = http.Session(impersonate=imitar)
        if calentar:
            s.get("https://" + url.split("/")[2] + "/", headers=scraper.CABECERAS, timeout=20)
            time.sleep(1)
        r = s.get(url, headers=scraper.CABECERAS, timeout=20)
        res = {"http": r.status_code, "s": round(time.time() - t, 1)}
        if r.status_code == 200:
            try:
                d = scraper.analizar(r.text, url)
                res.update(precio=d["precio"], titulo=(d["titulo"] or "")[:80])
            except scraper.ErrorLectura as e:
                res["error"] = f"{e.tipo}: {e}"[:100]
                res["titulo_pagina"] = (BeautifulSoup(r.text, "html.parser").title or "").__str__()[:100]
        return res
    except Exception as e:
        return {"excepcion": f"{type(e).__name__}: {e}"[:120]}


def main():
    salida = Path(sys.argv[1]) / "datos" / "diagnostico.json"
    informe, inicio = {}, time.time()
    for q in BUSQUEDAS:
        try:
            informe[q] = [r["url"][:100] for r in scraper._resultados_bing(q)][:10]
        except Exception as e:
            informe[q] = f"{type(e).__name__}: {e}"[:150]
        try:
            informe["ddg: " + q] = [r["url"][:100] for r in scraper._resultados_duckduckgo(q)][:10]
        except Exception as e:
            informe["ddg: " + q] = f"{type(e).__name__}: {e}"[:150]
    salida.write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf-8")
    for url in URLS:
        fila = {}
        for imitar in IMITACIONES:
            for calentar in (False, True):
                if time.time() - inicio > LIMITE:
                    break
                fila[f"{imitar}{' +portada' if calentar else ''}"] = probar(url, imitar, calentar)
        informe[url] = fila
        salida.write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf-8")
        print(url[:70], round(time.time() - inicio))


if __name__ == "__main__":
    main()
