"""
ia.py - Todo lo que usa Gemini (la IA de Google).

Solo funciona si el repositorio de datos tiene el secreto GEMINI_API_KEY.
Sin él, el vigilante funciona igual que siempre, pero sin las funciones de IA.

La IA solo busca y clasifica; los precios los lee siempre el lector (scraper.py).

Funciones:
  buscar_tiendas()   Busca en Google dónde comprar un producto (con envío a España)
  revisar_enlaces()  Clasifica cada enlace: mismo producto, otra variante u otro producto
  consultar_envio()  Averigua los gastos de envío a España de cada tienda
"""
import json
import os
import re
import time

import requests

BASE = "https://generativelanguage.googleapis.com/v1beta"
API = BASE + "/models/{modelo}:generateContent"
MAX_LLAMADAS = 25          # por ejecución, para no gastar el cupo gratis diario

_llamadas = 0
_modelo_ok = None
_modelos = None
diagnostico = []           # problemas con la IA en esta ejecución (se guardan en estado.json)


def _apuntar(texto):
    print(f"  [IA] {texto}")
    if texto not in diagnostico:
        diagnostico.append(texto[:300])


def _elegir_modelos(cabeceras):
    """Pregunta a Google qué modelos hay y prueba primero los "flash" estables más nuevos."""
    preferido = os.environ.get("GEMINI_MODEL", "").strip()
    nombres = []
    try:
        r = requests.get(BASE + "/models?pageSize=200", headers=cabeceras, timeout=30)
        r.raise_for_status()
        nombres = [m["name"].removeprefix("models/") for m in r.json().get("models", [])
                   if "generateContent" in m.get("supportedGenerationMethods", [])]
    except Exception as e:
        _apuntar(f"No pude listar los modelos de Gemini: {e}")

    def version(n):
        m = re.match(r"gemini-(\d+(?:\.\d+)?)-flash$", n)
        return float(m.group(1)) if m else -1

    estables = sorted((n for n in nombres if version(n) > 0), key=version, reverse=True)
    resto = [n for n in ("gemini-flash-latest", "gemini-2.5-flash") if not nombres or n in nombres]
    lista = [m for m in [preferido, *estables, *resto] if m]
    return list(dict.fromkeys(lista)) or ["gemini-flash-latest"]


class ErrorIA(Exception):
    pass


def activa():
    return bool(os.environ.get("GEMINI_API_KEY", "").strip())


def llamadas():
    return _llamadas


# ---------- Llamada a Gemini ----------
def _pedir(prompt, herramientas=None, json_puro=False):
    """Devuelve (texto, metadatos de búsqueda)."""
    global _llamadas, _modelo_ok
    if not activa():
        raise ErrorIA("Falta la clave de Gemini (secreto GEMINI_API_KEY)")
    if _llamadas >= MAX_LLAMADAS:
        raise ErrorIA("Límite de consultas a la IA de esta comprobación alcanzado")
    cuerpo = {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
              "generationConfig": {"temperature": 0.2}}
    if herramientas:
        cuerpo["tools"] = [{h: {}} for h in herramientas]
    if json_puro:
        cuerpo["generationConfig"]["responseMimeType"] = "application/json"
    cabeceras = {"x-goog-api-key": os.environ["GEMINI_API_KEY"].strip(),
                 "Content-Type": "application/json"}

    global _modelos
    if _modelos is None:
        _modelos = _elegir_modelos(cabeceras)
        print(f"  [IA] Modelos a probar: {', '.join(_modelos[:4])}")
    modelos = [_modelo_ok] if _modelo_ok else _modelos[:4]
    fallos = []
    for modelo in modelos:
        for intento in range(3):
            _llamadas += 1
            try:
                r = requests.post(API.format(modelo=modelo), json=cuerpo, headers=cabeceras, timeout=120)
            except requests.RequestException as e:
                fallos.append(f"{modelo}: sin conexión ({type(e).__name__})")
                time.sleep(5)
                continue
            if r.status_code == 404:          # ese modelo no existe: probar el siguiente
                fallos.append(f"{modelo}: no disponible")
                break
            if r.status_code in (429, 500, 503) and intento < 2:
                time.sleep(20 * (intento + 1))  # cupo por minuto o Gemini saturado
                continue
            if r.status_code in (401, 403):
                raise ErrorIA(f"Gemini rechazó la clave (HTTP {r.status_code}): {_mensaje(r)}")
            if r.status_code >= 400:      # 400 = ese modelo no admite algo (p. ej. la búsqueda): probar otro
                fallos.append(f"{modelo}: HTTP {r.status_code} {_mensaje(r)}")
                break
            datos = r.json()
            _modelo_ok = modelo
            cand = (datos.get("candidates") or [{}])[0]
            texto = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", [])
                            if not p.get("thought"))
            return texto, cand.get("groundingMetadata") or {}
    _modelo_ok = None if fallos else _modelo_ok
    error = "; ".join(fallos) or "sin respuesta"
    _apuntar(error)
    raise ErrorIA(error)


def _mensaje(r):
    try:
        return r.json()["error"]["message"][:200]
    except Exception:
        return r.text[:200]


def _json(texto):
    """Saca el JSON de la respuesta aunque venga entre ```json ... ``` o con texto alrededor."""
    m = re.search(r"```(?:json)?\s*(.+?)```", texto, re.S)
    if m:
        texto = m.group(1)
    for abre, cierra in (("{", "}"), ("[", "]")):
        i, j = texto.find(abre), texto.rfind(cierra)
        if i >= 0 and j > i:
            try:
                return json.loads(texto[i:j + 1])
            except ValueError:
                continue
    raise ErrorIA("La IA no devolvió datos legibles")


def _numero(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v >= 0 else None
    m = re.search(r"\d+(?:[.,]\d+)?", str(v))
    return float(m.group(0).replace(",", ".")) if m else None


def _envio(d, fuente="IA"):
    """Normaliza la información de envío que da la IA."""
    if not isinstance(d, dict):
        return None
    coste = _numero(d.get("envio_coste"))
    gratis = _numero(d.get("envio_gratis_desde"))
    if coste is None and gratis is None:
        return None
    return {"coste": coste, "gratis_desde": gratis,
            "moneda": (str(d.get("envio_moneda") or "EUR").upper()[:3]),
            "nota": str(d.get("envio_nota") or "")[:160] or None, "fuente": fuente}


REGLAS_ENVIO = """Para el envío a España (península), indica:
- "envio_coste": coste del envío estándar más barato para un pedido de solo este producto (0 si es gratis), o null si no lo sabes.
- "envio_gratis_desde": importe a partir del cual el envío es gratis, o null si no hay.
- "envio_moneda": moneda de esos importes (EUR, USD, GBP...).
- "envio_nota": nota muy breve si hace falta (p. ej. "gratis con Prime", "posibles aduanas", "solo recogida en tienda")."""


# ---------- 1. Buscar tiendas ----------
def buscar_tiendas(nombre, descripcion=""):
    """Busca en Google dónde comprar el producto. Devuelve una lista de candidatos (sin verificar)."""
    prompt = f"""Busca en Google tiendas online donde se pueda comprar este producto NUEVO con envío a España.

Producto: {nombre}
Detalles: {descripcion or "(ninguno)"}

- Incluye tiendas de España y también de otros países si envían a España (Amazon, la tienda oficial de la marca, grandes cadenas, tiendas especializadas...).
- Quiero la URL DIRECTA de la ficha del producto en cada tienda, no búsquedas, categorías, comparadores, foros, reseñas, vídeos ni segunda mano.
- Si no estás seguro de la URL exacta de la ficha, no te la inventes: omite esa tienda.
- Como máximo 10 tiendas, primero las más conocidas y fiables.
{REGLAS_ENVIO}

Responde SOLO con este JSON:
{{"resultados": [{{"url": "...", "tienda": "...", "pais": "ES", "envio_coste": null, "envio_gratis_desde": null, "envio_moneda": "EUR", "envio_nota": null}}]}}"""
    texto, meta = _pedir(prompt, herramientas=["google_search"])
    try:
        resultados = _json(texto)
        resultados = resultados.get("resultados", []) if isinstance(resultados, dict) else resultados
    except ErrorIA:
        resultados = []
    candidatos = []
    for r in resultados if isinstance(resultados, list) else []:
        if isinstance(r, dict) and str(r.get("url", "")).startswith("http"):
            candidatos.append({"url": r["url"].strip(), "tienda": r.get("tienda"),
                               "pais": r.get("pais"), "envio": _envio(r)})
    # Fuentes que Google citó: a veces son fichas de producto que la IA no copió bien
    for chunk in meta.get("groundingChunks", []):
        uri = (chunk.get("web") or {}).get("uri")
        if uri:
            candidatos.append({"url": uri, "tienda": (chunk.get("web") or {}).get("title"),
                               "pais": None, "envio": None, "redireccion": True})
    return candidatos


# ---------- 2. ¿Es el mismo producto? ----------
def revisar_enlaces(nombre, descripcion, enlaces):
    """enlaces: [{"id", "tienda", "titulo", "precio", "moneda"}] -> {id: {"veredicto", "motivo"}}"""
    lista = "\n".join(f'- id={e["id"]} | tienda: {e.get("tienda")} | título: {e.get("titulo") or "?"} | '
                      f'precio: {e.get("precio")} {e.get("moneda") or ""}' for e in enlaces)
    prompt = f"""Un usuario vigila el precio de este producto:
Producto: {nombre}
Detalles: {descripcion or "(ninguno)"}

Estos son los anuncios de varias tiendas. Para cada uno decide si es EXACTAMENTE ese producto:
- "si": es el mismo producto (el color o la talla pueden variar si el usuario no los especificó).
- "variante": es el mismo producto pero otra versión que importa (otra capacidad, modelo anterior/posterior, pack, reacondicionado, importación de otro país o idioma, color distinto si el usuario lo pidió...).
- "no": es otro producto, un accesorio, un recambio o una funda.
Fíjate también en precios absurdamente bajos o altos comparados con los demás.

{lista}

Responde SOLO con JSON: {{"revision": [{{"id": "...", "veredicto": "si|variante|no", "motivo": "frase muy breve en español"}}]}}"""
    texto, _ = _pedir(prompt, json_puro=True)
    d = _json(texto)
    filas = d.get("revision", []) if isinstance(d, dict) else d
    res = {}
    for f in filas if isinstance(filas, list) else []:
        if isinstance(f, dict) and f.get("id") and f.get("veredicto") in ("si", "variante", "no"):
            res[str(f["id"])] = {"veredicto": f["veredicto"], "motivo": str(f.get("motivo") or "")[:160]}
    return res


# ---------- 3. Gastos de envío ----------
def consultar_envio(enlaces):
    """enlaces: [{"id", "url", "tienda"}] -> {id: envio}"""
    lista = "\n".join(f'- id={e["id"]} | {e.get("tienda")} | {e["url"]}' for e in enlaces)
    prompt = f"""Busca las condiciones de envío a España (península) de cada una de estas tiendas online
para un pedido de solo el producto del enlace. Mira su página de envíos o la propia ficha.
{REGLAS_ENVIO}

{lista}

Responde SOLO con JSON: {{"envios": [{{"id": "...", "envio_coste": null, "envio_gratis_desde": null, "envio_moneda": "EUR", "envio_nota": null}}]}}"""
    texto, _ = _pedir(prompt, herramientas=["google_search"])
    d = _json(texto)
    filas = d.get("envios", []) if isinstance(d, dict) else d
    res = {}
    for f in filas if isinstance(filas, list) else []:
        if isinstance(f, dict) and f.get("id"):
            env = _envio(f)
            if env:
                res[str(f["id"])] = env
    return res
