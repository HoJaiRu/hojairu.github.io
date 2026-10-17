"""
scraper.py - Lee precio, imagen y stock de una pagina de producto.

Orden de busqueda (se queda con lo primero que encuentre):
  1. Datos estructurados JSON-LD (schema.org) -> la mayoria de tiendas
  2. Selectores especificos de tienda (Amazon, usando su version movil)
  3. Etiquetas <meta> y microdatos itemprop genericos
"""
import json
import re
import time
import base64
from urllib.parse import parse_qs, quote_plus, urlparse

from bs4 import BeautifulSoup

# curl_cffi imita a un Chrome real (menos bloqueos). Si no esta, usa requests.
try:
    from curl_cffi import requests as http
    IMITA_CHROME = True
except ImportError:  # pragma: no cover
    import requests as http
    IMITA_CHROME = False


class ErrorLectura(Exception):
    """Error 'esperado' al leer una tienda. El texto se muestra en la zona de errores.

    tipo: "conexion", "404", "bloqueo", "http" o "sin_precio".
    """
    def __init__(self, mensaje, tipo="otro", html=None):
        super().__init__(mensaje)
        self.tipo = tipo
        self.html = html      # la página descargada, para que la IA la lea como último recurso


CABECERAS = {"Accept-Language": "es-ES,es;q=0.9,en;q=0.8"}
if not IMITA_CHROME:
    CABECERAS.update({
        "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })

NOMBRES_TIENDA = {
    "amazon.": "Amazon", "pccomponentes.": "PcComponentes", "mediamarkt.": "MediaMarkt",
    "elcorteingles.": "El Corte Inglés", "aliexpress.": "AliExpress", "fnac.": "Fnac",
    "carrefour.": "Carrefour", "coolmod.": "Coolmod", "worten.": "Worten",
    "decathlon.": "Decathlon", "zalando.": "Zalando", "ebay.": "eBay", "lidl.": "Lidl",
    "leroymerlin.": "Leroy Merlin", "ikea.": "IKEA", "apple.": "Apple", "xiaomi.": "Xiaomi",
    "dji.": "DJI", "backmarket.": "Back Market", "alcampo.": "Alcampo",
}

# Selectores CSS para tiendas que no publican datos estándar.
# Cada selector es "css" (usa el texto) o ("css", "atributo").
SELECTORES = {
    "amazon.": {
        "precio": [("#twister-plus-price-data-price", "value"),
                   ("#attach-base-product-price", "value"),
                   "#corePriceDisplay_mobile_feature_div .priceToPay .a-offscreen",
                   "#corePrice_feature_div .a-offscreen",
                   "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
                   "#priceblock_dealprice", "#priceblock_ourprice", "#price_inside_buybox"],
        "imagen": [("#main-image", "data-a-hires"), ("#main-image", "src"),
                   ("#landingImage", "data-old-hires"), ("#landingImage", "src")],
        "titulo": ["#title", "#productTitle"],
        "stock": ["#availability"],
    },
}

# Amazon bloquea la web normal desde servidores, pero no su versión móvil vista desde un iPhone
RE_ASIN = re.compile(r"/(?:dp|gp/product|gp/aw/d|exec/obidos/asin)/([A-Z0-9]{10})", re.I)


def url_amazon_movil(url):
    p = urlparse(url)
    m = RE_ASIN.search(p.path)
    if "amazon." not in (p.hostname or "") or not m:
        return None
    return f"https://{p.hostname}/gp/aw/d/{m.group(1).upper()}?th=1&psc=1"

MARCAS_BLOQUEO = ["captcha", "just a moment", "attention required", "access denied",
                  "robot check", "are you a human", "unusual traffic", "pardon our interruption"]


def nombre_tienda(url):
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    for clave, nombre in NOMBRES_TIENDA.items():
        if clave in host:
            pais = host.rsplit(".", 1)[-1]
            # Tiendas de otros países: "Amazon (DE)", "Fnac (FR)"... (amazon.co.uk -> UK)
            return nombre if pais in ("es", "com") else f"{nombre} ({pais.upper()})"
    return host or "Tienda"


def leer_precio_texto(valor, estructurado=False):
    """Convierte '1.299,99 €', '29,9', 1299 o '1299.00' en float."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, (int, float)):
        return float(valor) if valor > 0 else None
    s = re.sub(r"[^\d,.]", "", str(valor))
    if not re.search(r"\d", s):
        return None
    if "," in s and "." in s:                       # 1.299,99  o  1,299.99
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:                                  # 29,99  o  1,299
        partes = s.split(",")
        s = s.replace(",", ".") if len(partes) == 2 and len(partes[1]) <= 2 else s.replace(",", "")
    elif "." in s and not estructurado:             # 1.299 (miles) en texto de la web
        partes = s.split(".")
        if len(partes) > 2 or len(partes[1]) == 3:
            s = s.replace(".", "")
    try:
        n = float(s)
    except ValueError:
        return None
    return n if n > 0 else None


def _estado_stock(texto):
    """True = disponible, False = agotado, None = no se sabe."""
    if not texto:
        return None
    t = str(texto).lower()
    if any(x in t for x in ("outofstock", "soldout", "discontinued", "agotado",
                            "no disponible", "currently unavailable", "sin stock")):
        return False
    if any(x in t for x in ("instock", "limitedavailability", "onlineonly", "preorder",
                            "presale", "en stock", "in stock", "disponible")):
        return True
    return None


# ---------- 1. JSON-LD ----------
def _recorrer(nodo):
    if isinstance(nodo, list):
        for n in nodo:
            yield from _recorrer(n)
    elif isinstance(nodo, dict):
        yield nodo
        for v in nodo.values():
            if isinstance(v, (list, dict)):
                yield from _recorrer(v)


def _bloques_jsonld(soup):
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        texto = tag.string or tag.get_text() or ""
        try:
            yield from _recorrer(json.loads(texto.strip(), strict=False))
        except ValueError:
            continue


def _tipos(d):
    t = d.get("@type", [])
    return [x.lower() for x in ([t] if isinstance(t, str) else t) if isinstance(x, str)]


def _primera_imagen(img):
    if isinstance(img, str):
        return img
    if isinstance(img, list) and img:
        return _primera_imagen(img[0])
    if isinstance(img, dict):
        return img.get("url") or img.get("contentUrl")
    return None


def _envio_oferta(o):
    """Gastos de envío publicados en la oferta (schema.org OfferShippingDetails), preferiblemente a España."""
    detalles = o.get("shippingDetails")
    detalles = detalles if isinstance(detalles, list) else [detalles]
    elegido = None
    for d in detalles:
        if not isinstance(d, dict):
            continue
        destino = json.dumps(d.get("shippingDestination") or "").upper()
        if elegido is None or '"ES"' in destino or "SPAIN" in destino or "ESPA" in destino:
            elegido = d
    if not elegido:
        return None
    tarifa = elegido.get("shippingRate")
    tarifa = tarifa[0] if isinstance(tarifa, list) and tarifa else tarifa
    if not isinstance(tarifa, dict):
        return None
    coste = tarifa.get("value", tarifa.get("price"))
    if coste in (None, ""):
        return None
    try:
        coste = float(str(coste).replace(",", "."))
    except ValueError:
        return None
    return {"coste": coste, "gratis_desde": None,
            "moneda": (tarifa.get("currency") or tarifa.get("priceCurrency") or "EUR").upper()[:3],
            "nota": None, "fuente": "tienda"}


def _datos_oferta(o):
    if not isinstance(o, dict):
        return None
    precio = o.get("price") if o.get("price") not in (None, "") else o.get("lowPrice")
    moneda = o.get("priceCurrency")
    spec = o.get("priceSpecification")
    if isinstance(spec, list) and spec:
        spec = spec[0]
    if precio in (None, "") and isinstance(spec, dict):
        precio = spec.get("price")
        moneda = moneda or spec.get("priceCurrency")
    return {"precio": leer_precio_texto(precio, estructurado=True),
            "moneda": moneda, "stock": _estado_stock(o.get("availability")),
            "envio": _envio_oferta(o)}


def _mejor_oferta(ofertas):
    if isinstance(ofertas, dict):
        return _datos_oferta(ofertas)
    if isinstance(ofertas, list):
        datos = [d for d in (_datos_oferta(o) for o in ofertas) if d and d["precio"]]
        if not datos:
            return None
        en_stock = [d for d in datos if d["stock"] is not False] or datos
        return min(en_stock, key=lambda d: d["precio"])
    return None


def _desde_jsonld(soup):
    res = {}
    bloques = list(_bloques_jsonld(soup))
    for d in bloques:
        if "product" in _tipos(d):
            res.setdefault("titulo", d.get("name"))
            if not res.get("imagen"):
                res["imagen"] = _primera_imagen(d.get("image"))
            oferta = _mejor_oferta(d.get("offers"))
            if oferta and (oferta["precio"] or oferta["stock"] is False):
                res.update({k: v for k, v in oferta.items() if v is not None})
                return res
    for d in bloques:  # Ofertas sueltas sin Product
        if {"offer", "aggregateoffer"} & set(_tipos(d)):
            oferta = _datos_oferta(d)
            if oferta and oferta["precio"]:
                res.update({k: v for k, v in oferta.items() if v is not None})
                return res
    return res


# ---------- 2. Selectores de tienda ----------
def _valor(soup, sel):
    css, attr = sel if isinstance(sel, tuple) else (sel, None)
    el = soup.select_one(css)
    if not el:
        return None
    return (el.get(attr) or None) if attr else (el.get_text(" ", strip=True) or None)


def _desde_selectores(soup, url, html=""):
    host = (urlparse(url).hostname or "").lower()
    conf = next((v for k, v in SELECTORES.items() if k in host), None)
    if not conf:
        return {}
    res = {}
    for sel in conf.get("precio", []):
        precio = leer_precio_texto(_valor(soup, sel), estructurado=isinstance(sel, tuple))
        if precio:
            res["precio"] = precio
            break
    if not res.get("precio") and "amazon." in host:
        m = re.search(r'"priceAmount"\s*:\s*(\d+(?:\.\d+)?)', html)
        if m:
            res["precio"] = leer_precio_texto(m.group(1), estructurado=True)
    for clave in ("imagen", "titulo"):
        for sel in conf.get(clave, []):
            v = _valor(soup, sel)
            if v:
                res[clave] = v
                break
    for sel in conf.get("stock", []):
        v = _valor(soup, sel)
        if v:
            res["stock"] = _estado_stock(v)
            break
    return {k: v for k, v in res.items() if v is not None}


# ---------- 3. Meta / itemprop ----------
def _meta(soup, *nombres):
    for n in nombres:
        m = soup.find("meta", attrs={"property": n}) or soup.find("meta", attrs={"name": n})
        if m and m.get("content"):
            return m["content"]
    return None


def _desde_meta(soup):
    res = {}
    p = _meta(soup, "product:price:amount", "og:price:amount")
    if p:
        res["precio"] = leer_precio_texto(p, estructurado=True)
    if not res.get("precio"):
        # Microdatos schema.org (itemprop). Si hay varias variantes, la más barata.
        precios = []
        for el in soup.find_all(attrs={"itemprop": ["price", "lowPrice"]}):
            if el.get("content"):
                precios.append(leer_precio_texto(el["content"], estructurado=True))
            else:
                precios.append(leer_precio_texto(el.get_text()))
        precios = [x for x in precios if x]
        if precios:
            res["precio"] = min(precios)
    res["moneda"] = _meta(soup, "product:price:currency", "og:price:currency")
    if not res["moneda"]:
        el = soup.find(attrs={"itemprop": "priceCurrency"})
        res["moneda"] = el and (el.get("content") or el.get_text(strip=True)) or None
    disp = _meta(soup, "product:availability", "og:availability")
    if not disp:
        el = soup.find(attrs={"itemprop": "availability"})
        disp = el and (el.get("href") or el.get("content"))
    res["stock"] = _estado_stock(disp)
    res["imagen"] = _meta(soup, "og:image", "twitter:image")
    res["titulo"] = _meta(soup, "og:title") or (soup.title.get_text(strip=True) if soup.title else None)
    return {k: v for k, v in res.items() if v is not None}


# ---------- Descarga ----------
def descargar(url, imitar="chrome"):
    opciones = {"headers": CABECERAS, "timeout": 25, "allow_redirects": True}
    if IMITA_CHROME:
        opciones["impersonate"] = imitar
    try:
        r = http.get(url, **opciones)
    except Exception as e:
        msg = str(e).lower()
        if "timed out" in msg or "timeout" in msg:
            raise ErrorLectura("La tienda no responde (tiempo de espera agotado)", "conexion")
        raise ErrorLectura("No se pudo conectar con la tienda (¿enlace mal copiado o sin internet?)", "conexion")
    if r.status_code == 404:
        raise ErrorLectura("Página no encontrada (404): el producto puede haberse retirado", "404")
    if r.status_code in (401, 403, 429, 503):
        raise ErrorLectura(f"La tienda bloquea la lectura automática (HTTP {r.status_code})", "bloqueo")
    if r.status_code >= 400:
        raise ErrorLectura(f"La tienda devolvió un error (HTTP {r.status_code})", "http")
    return r.text


def analizar(html, url):
    """Extrae los datos de un HTML ya descargado."""
    soup = BeautifulSoup(html, "html.parser")
    datos = {}
    for fuente in (_desde_jsonld(soup), _desde_selectores(soup, url, html), _desde_meta(soup)):
        for k, v in fuente.items():
            if datos.get(k) is None and v is not None:
                datos[k] = v

    if not datos.get("precio") and datos.get("stock") is not False:
        texto = html[:200000].lower()
        if any(m in texto for m in MARCAS_BLOQUEO):
            raise ErrorLectura("La tienda ha mostrado un captcha o bloqueo anti-bots", "bloqueo", html)
        raise ErrorLectura("No encuentro el precio en la página (puede que la tienda lo cargue con JavaScript)",
                           "sin_precio", html)

    imagen = datos.get("imagen")
    if imagen and imagen.startswith("//"):
        imagen = "https:" + imagen
    return {
        "precio": datos.get("precio"),
        "moneda": (datos.get("moneda") or "EUR").upper()[:3],
        "stock": datos.get("stock"),
        "imagen": imagen,
        "titulo": (datos.get("titulo") or "")[:300] or None,
        "envio": datos.get("envio"),
    }


def comprobar(url):
    """Descarga y analiza un enlace. Lanza ErrorLectura si algo falla."""
    movil = url_amazon_movil(url)
    if not movil:
        return analizar(descargar(url), url)
    try:
        return analizar(descargar(movil, imitar="safari_ios"), movil)
    except ErrorLectura as e:
        if "captcha" not in str(e):
            raise
        time.sleep(6)  # a veces basta con reintentar
        return analizar(descargar(movil, imitar="safari_ios"), movil)


# ---------- Ayudas para la IA ----------
def texto_para_ia(html, maximo=25000):
    """Texto visible de la página (sin menús ni scripts), recortado para mandarlo a la IA."""
    soup = BeautifulSoup(html, "html.parser")
    extra = []
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        extra.append((tag.string or tag.get_text() or "")[:3000])
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "iframe"]):
        tag.decompose()
    titulo = soup.title.get_text(strip=True) if soup.title else ""
    texto = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    return (f"TÍTULO: {titulo}\n{texto}\n\nDATOS ESTRUCTURADOS:\n" + "\n".join(extra))[:maximo]


def resolver_redireccion(url):
    """Los enlaces que cita Google pasan por una redirección: devuelve la dirección final."""
    try:
        r = http.get(url, headers=CABECERAS, timeout=15, allow_redirects=False,
                     **({"impersonate": "chrome"} if IMITA_CHROME else {}))
        destino = r.headers.get("location") or r.headers.get("Location")
        return destino if destino and destino.startswith("http") else None
    except Exception:
        return None


# Webs que nunca son tiendas: no hace falta ni enseñárselas a la IA
NO_TIENDAS = ("youtube.", "reddit.", "wikipedia.", "facebook.", "instagram.", "tiktok.", "x.com",
              "twitter.", "pinterest.", "forocoches.", "xataka.", "duckduckgo.", "bing.", "google.")


def _resultados_duckduckgo(consulta):
    html = descargar(f"https://html.duckduckgo.com/html/?q={quote_plus(consulta)}&kl=es-es")
    soup = BeautifulSoup(html, "html.parser")
    res = []
    for a in soup.select("a.result__a"):
        href = a.get("href", "")
        if "uddg=" in href:
            href = parse_qs(urlparse(href).query).get("uddg", [""])[0]
        caja = a.find_parent(class_="result")
        extracto = caja.select_one(".result__snippet") if caja else None
        res.append({"url": href, "titulo": a.get_text(" ", strip=True),
                    "extracto": extracto.get_text(" ", strip=True) if extracto else ""})
    return res


def _resultados_bing(consulta):
    html = descargar(f"https://www.bing.com/search?q={quote_plus(consulta)}&cc=ES&setlang=es&count=20")
    soup = BeautifulSoup(html, "html.parser")
    res = []
    for li in soup.select("li.b_algo"):
        a = li.select_one("h2 a")
        if not a:
            continue
        href = a.get("href", "")
        if "bing.com/ck/a" in href:          # enlace de rastreo: la dirección real va en u=a1<base64>
            u = parse_qs(urlparse(href).query).get("u", [""])[0]
            try:
                href = base64.urlsafe_b64decode(u[2:] + "=" * (-len(u[2:]) % 4)).decode()
            except Exception:
                continue
        extracto = li.select_one("p")
        res.append({"url": href, "titulo": a.get_text(" ", strip=True),
                    "extracto": extracto.get_text(" ", strip=True) if extracto else ""})
    return res


def buscar_en_web(consulta):
    """Busca en DuckDuckGo (y si falla, en Bing). Devuelve [{url, titulo, extracto}]."""
    for buscador in (_resultados_duckduckgo, _resultados_bing):
        try:
            res = [r for r in buscador(consulta) if r["url"].startswith("http")
                   and not any(n in (urlparse(r["url"]).hostname or "") for n in NO_TIENDAS)]
        except ErrorLectura as e:
            print(f"  ({buscador.__name__[12:]}: {e})")
            continue
        if res:
            return res
    return []
