"""
diagnostico.py - Prueba temporal: guarda trozos del HTML de las tiendas que no se leen,
para ajustar el lector. Escribe <datos>/datos/diagnostico.json. No lo usa la web.
"""
import json
import re
import sys
import time
from pathlib import Path

from bs4 import BeautifulSoup

import scraper

URLS = [
    "https://www.pccomponentes.com/freidora-de-aire-cosori-smart-chef-edition-55-l-1700-w-wi-fi",
    "https://www.notino.es/diesel/only-the-brave-eau-de-toilette-para-hombre/",
    "https://www.primor.eu/es_es/diesel-only-the-brave-eau-de-toilette-84982.html",
    "https://www.fnac.es/Freidora-de-aire-sin-aceite-Cosori-Premium-Chef-Edition-1700W-5-5L-Blanca-Pequeno-electrodomestico-Freidora/a9034293",
    "https://www.aromas.es/jpg-lemale-elixir-parfum-edp-hombre/136959M.html",
    "https://www.perfumesclub.com/es/diesel/only-the-brave-eau-de-toilette-vaporizador/p_35162/",
]
LIMITE = 360  # segundos en total


def resumen(html):
    soup = BeautifulSoup(html, "html.parser")
    jsonld = [b.get_text()[:500] for b in soup.find_all("script", type="application/ld+json")][:4]
    metas = {(m.get("property") or m.get("name") or m.get("itemprop")): m.get("content")
             for m in soup.find_all("meta") if "price" in str(m.get("property") or m.get("name") or m.get("itemprop") or "").lower()}
    itemprop = [str(e)[:200] for e in soup.find_all(attrs={"itemprop": re.compile("price", re.I)})][:4]
    trozos = [html[max(0, m.start() - 120):m.end() + 80].replace("\n", " ")
              for m in re.finditer(r'"(?:price|salePrice|finalPrice|sellingPrice|priceAmount)"\s*:', html)][:6]
    euros = [html[max(0, m.start() - 150):m.end() + 20].replace("\n", " ")
             for m in re.finditer(r"\d{1,4},\d{2}\s?(?:€|&euro;)", html)][:4]
    texto = soup.get_text(" ", strip=True)
    return {"largo": len(html), "titulo": soup.title.get_text(strip=True)[:120] if soup.title else None,
            "marcas": [m for m in scraper.MARCAS_BLOQUEO if m in html[:200000].lower()],
            "jsonld": jsonld, "metas": metas, "itemprop": itemprop, "json_precio": trozos, "euros": euros,
            "texto": texto[:400]}


def main():
    salida = Path(sys.argv[1]) / "datos" / "diagnostico.json"
    informe, inicio = {}, time.time()
    for url in URLS:
        fila = {}
        for metodo in ("chrome", "safari_ios", "navegador"):
            if time.time() - inicio > LIMITE:
                fila[metodo] = "sin tiempo"
                continue
            t = time.time()
            try:
                html = scraper.descargar_navegador(url, espera=12) if metodo == "navegador" \
                    else scraper.descargar(url, imitar=metodo)
                fila[metodo] = resumen(html)
            except scraper.ErrorLectura as e:
                fila[metodo] = f"{e.tipo}: {e}"
            except Exception as e:
                fila[metodo] = f"{type(e).__name__}: {e}"[:200]
            if isinstance(fila[metodo], dict):
                fila[metodo]["s"] = round(time.time() - t, 1)
        informe[url] = fila
        salida.write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf-8")
        print(url[:70], round(time.time() - inicio))


if __name__ == "__main__":
    main()
