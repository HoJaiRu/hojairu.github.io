// app.js - Web del Vigilante de precios.
// Lee y guarda los datos en el repositorio privado de cada persona (API de GitHub + su llave)
// y lanza la comprobación de precios (GitHub Actions) cuando se pulsa "Comprobar".
// La búsqueda de tiendas con IA también corre en GitHub Actions (ver vigilante/ia.py):
// la web solo la lanza y luego lee el resultado de datos/busquedas/<producto>.json.

// ===== Perfiles =====
// Cada perfil es un repositorio privado con sus datos. La llave de cada persona decide
// qué perfiles puede abrir: si abre varios (el administrador), aparece un selector.
// Para añadir a alguien: crear su repositorio (copia de precios-perfil2) y añadirlo aquí.
const PERFILES = [
  { repo: "WEBS", nombre: "Mis productos" },
  { repo: "precios-perfil2", nombre: "Perfil 2" },
];

// ===== Configuración =====
const CONFIG = {
  owner: "HoJaiRu",
  rama: "main",
  workflow: "precios-vigilar.yml",
  intervaloHoras: 3,     // igual que el "cron" del workflow
  minutoCron: 17,
};
const RUTA = {
  productos: "precios/productos.json",
  estado: "precios/datos/estado.json",
  historial: "precios/datos/historial.json",
  busqueda: (id) => `precios/datos/busquedas/${id}.json`,
};
const CLAVE_TOKEN = "vigilante-precios.token";
const CLAVE_PERFIL = "vigilante-precios.perfil";

const $ = (sel, el = document) => el.querySelector(sel);
let token = "";
let perfiles = [];       // perfiles que abre la llave de este navegador
let repo = "";           // repositorio del perfil que se está viendo
let productosRaw = [];   // tal cual está en productos.json
let estado = { enlaces: {} };
let historial = {};
let productos = [];      // productos con sus precios, listos para pintar
let busquedas = {};       // id de producto -> resultado de la búsqueda con IA (se lee al abrir el producto)
const abiertos = new Set();
const comprobando = new Map();   // id de producto (o "*" = todos, o "buscar:id") -> hora en que se pidió

// ---------- Llave (token) guardada en este navegador ----------
function leerToken() { try { return localStorage.getItem(CLAVE_TOKEN) || ""; } catch { return ""; } }
function guardarToken(t) { try { t ? localStorage.setItem(CLAVE_TOKEN, t) : localStorage.removeItem(CLAVE_TOKEN); } catch {} }
function leerPerfil() { try { return localStorage.getItem(CLAVE_PERFIL) || ""; } catch { return ""; } }
function guardarPerfil(r) { try { localStorage.setItem(CLAVE_PERFIL, r); } catch {} }

// ---------- API de GitHub ----------
class ErrorGitHub extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function gh(metodo, ruta, cuerpo, aceptar = "application/vnd.github+json") {
  let r;
  try {
    r = await fetch("https://api.github.com" + ruta, {
      method: metodo,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: aceptar,
        ...(cuerpo ? { "Content-Type": "application/json" } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorGitHub("Sin conexión con GitHub. Revisa tu internet.", 0);
  }
  if (r.status === 204) return null;
  const texto = await r.text();
  let datos;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  if (!r.ok) {
    const msg = {
      401: "La llave no es válida o ha caducado.",
      403: "La llave no tiene permiso para esto. Revisa que tenga Contents y Actions en «Read and write».",
      404: "No encuentro el repositorio o el archivo. ¿La llave tiene acceso al repositorio WEBS?",
    }[r.status] || `GitHub respondió con un error (${r.status}).`;
    if (r.status === 401) desconectar(msg);
    throw new ErrorGitHub(msg, r.status);
  }
  return datos;
}

const rutaContenido = (ruta) => `/repos/${CONFIG.owner}/${repo}/contents/${ruta}?ref=${CONFIG.rama}`;
const deB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
function aB64(texto) {
  let binario = "";
  for (const b of new TextEncoder().encode(texto)) binario += String.fromCharCode(b);
  return btoa(binario);
}

async function leerJSON(ruta, defecto) {
  try {
    const d = await gh("GET", rutaContenido(ruta), null, "application/vnd.github.raw+json");
    return typeof d === "string" ? JSON.parse(d) : (d ?? defecto);
  } catch (e) {
    if (e.status === 404) return defecto;
    throw e;
  }
}

async function leerProductos() {
  try {
    const d = await gh("GET", rutaContenido(RUTA.productos));
    return { lista: JSON.parse(deB64(d.content)), sha: d.sha };
  } catch (e) {
    if (e.status === 404) return { lista: [], sha: null };
    throw e;
  }
}

// Lee productos.json, aplica el cambio y lo guarda (reintenta si otro cambio se cruzó)
async function cambiarProductos(mensaje, cambio) {
  for (let intento = 1; ; intento++) {
    const { lista, sha } = await leerProductos();
    const resultado = cambio(lista);
    const cuerpo = {
      message: `precios: ${mensaje}`,
      content: aB64(JSON.stringify(lista, null, 1) + "\n"),
      branch: CONFIG.rama,
      ...(sha ? { sha } : {}),
    };
    try {
      await gh("PUT", `/repos/${CONFIG.owner}/${repo}/contents/${RUTA.productos}`, cuerpo);
      productosRaw = lista;
      construir();
      pintar();
      return resultado;
    } catch (e) {
      if ((e.status === 409 || e.status === 422) && intento < 3) continue;
      throw e;
    }
  }
}

async function lanzarComprobacion(productoId = "", accion = "comprobar") {
  await gh("POST", `/repos/${CONFIG.owner}/${repo}/actions/workflows/${CONFIG.workflow}/dispatches`,
    { ref: CONFIG.rama, inputs: { producto: productoId, accion } });
  comprobando.set(accion === "buscar" ? "buscar:" + productoId : (productoId || "*"), Date.now());
  pintar();
  vigilarComprobacion();
}

// ---------- Utilidades ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function dinero(n, moneda = "EUR") {
  if (n == null) return "—";
  try { return new Intl.NumberFormat("es-ES", { style: "currency", currency: moneda || "EUR" }).format(n); }
  catch { return n.toFixed(2) + " " + moneda; }
}

function hace(iso) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} día${d > 1 ? "s" : ""}`;
}

function proximaRevision() {
  const t = new Date();
  t.setUTCSeconds(0, 0);
  t.setUTCMinutes(t.getUTCMinutes() + 1);
  while (t.getUTCMinutes() !== CONFIG.minutoCron || t.getUTCHours() % CONFIG.intervaloHoras !== 0) {
    t.setUTCMinutes(t.getUTCMinutes() + 1);
  }
  return t.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function leerPrecio(valor) {
  const s = String(valor ?? "").replace(/[€\s]/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error("El precio deseado no es un número válido");
  if (n <= 0) throw new Error("El precio deseado debe ser mayor que 0");
  return Math.round(n * 100) / 100;
}

function urlValida(url) {
  url = (url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`Enlace no válido (debe empezar por https://): ${url.slice(0, 60)}`);
  return url;
}

function nuevoId(prefijo) {
  const aleatorio = crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(16).slice(2);
  return prefijo + aleatorio.slice(0, 10);
}

function tiendaDe(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Tienda"; }
}

function avisar(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (el.hidden = true), 4500);
}

const imagen = (p) => p.imagen
  ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">`
  : `<div class="sin-img">🏷️</div>`;

// Si una imagen no carga, pone el icono en su lugar
document.addEventListener("error", (ev) => {
  if (ev.target.tagName === "IMG") {
    const div = document.createElement("div");
    div.className = "sin-img";
    div.textContent = "🏷️";
    ev.target.replaceWith(div);
  }
}, true);

// ---------- Unir productos + estado + historial ----------
function construir() {
  const enlacesEstado = estado.enlaces || {};
  const hace30 = new Date(Date.now() - 30 * 864e5).toISOString();
  productos = productosRaw.map((p) => {
    const enlaces = (p.enlaces || []).map((e) => {
      const est = { precio: null, moneda: "EUR", stock: null, imagen: null, error: null, ultima_lectura: null,
        tienda: tiendaDe(e.url), ...(enlacesEstado[e.id] || {}) };
      // Precio final = precio en euros + envío (el envío escrito a mano manda sobre el de la tienda o la IA)
      const precioEur = est.precio_eur ?? (est.moneda === "EUR" ? est.precio : null);
      const envio = e.envio ?? est.envio_eur ?? null;
      const veredicto = e.coincide_ok ? "si" : est.coincide?.veredicto;
      return {
        ...est, id: e.id, url: e.url,
        precio_eur: precioEur,
        envio_eur: envio,
        envio_fuente: e.envio != null ? "manual" : est.envio_fuente,
        total: precioEur != null ? Math.round((precioEur + (envio || 0)) * 100) / 100 : null,
        veredicto,
        motivo: est.coincide?.motivo || "",
      };
    });
    const validos = enlaces.filter((e) => e.total != null && e.stock !== false && !e.error && e.veredicto !== "no");
    const mejor = validos.length ? validos.reduce((a, b) => (b.total < a.total ? b : a)) : null;
    const precios30 = enlaces.flatMap((e) => (historial[e.id] || [])
      .filter(([fecha, precio, stock]) => fecha >= hace30 && precio != null && stock !== false)
      .map(([, precio]) => precio));
    if (mejor) precios30.push(mejor.precio_eur);
    const lecturas = enlaces.map((e) => e.ultima_lectura).filter(Boolean).sort();
    return {
      ...p,
      descripcion: p.descripcion || "",
      enlaces,
      mejor,
      imagen: mejor?.imagen || enlaces.find((e) => e.imagen)?.imagen || null,
      oferta: Boolean(mejor && p.precio_deseado && mejor.total <= p.precio_deseado),
      agotado: !mejor && enlaces.some((e) => e.stock === false),
      minimo_30d: precios30.length ? Math.min(...precios30) : null,
      ultima_lectura: lecturas.at(-1) || null,
    };
  });
}

async function cargar() {
  const repoPedido = repo;
  const [p, e, h] = await Promise.all([
    leerProductos(),
    leerJSON(RUTA.estado, { enlaces: {} }),
    leerJSON(RUTA.historial, {}),
  ]);
  if (repoPedido !== repo) return;   // se cambió de perfil mientras cargaba
  productosRaw = p.lista;
  estado = e || { enlaces: {} };
  historial = h || {};
  await Promise.all([...abiertos].map(cargarBusqueda));
  if (repoPedido !== repo) return;
  construir();
  pintar();
}

// ---------- Pintar ----------
function pintar() {
  pintarEstado();
  pintarOfertas();
  pintarProductos();
  pintarErrores();
}

function pintarEstado() {
  const btn = $("#btn-comprobar-todo");
  if (comprobando.has("*")) {
    $("#estado").innerHTML = `<span class="girando">↻</span> Comprobando todos los precios… (1-3 min)`;
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  const ultima = estado.ultima_revision ? ` · última ${hace(estado.ultima_revision)}` : "";
  $("#estado").textContent = `Revisión automática cada ${CONFIG.intervaloHoras} h${ultima} · próxima hacia las ${proximaRevision()}`;
}

function pintarOfertas() {
  const ofertas = productos.filter((p) => p.oferta);
  $("#ofertas").hidden = ofertas.length === 0;
  $("#lista-ofertas").innerHTML = ofertas.map((p) => {
    const ahorro = p.precio_deseado - p.mejor.total;
    return `
      <div class="oferta-item" data-ir="${esc(p.id)}" title="Ver producto">
        ${imagen(p)}
        <div class="min0">
          <div class="nombre">${esc(p.nombre)}</div>
          <div class="precio">${dinero(p.mejor.total)}</div>
          <div class="detalle-oferta">en ${esc(p.mejor.tienda)} · ${textoEnvio(p.mejor)} · ${ahorro > 0 ? dinero(ahorro) + " por debajo de tu objetivo" : "justo tu objetivo"}</div>
        </div>
        <a class="btn oferta" href="${esc(p.mejor.url)}" target="_blank" rel="noopener noreferrer">Ir a la tienda ↗</a>
      </div>`;
  }).join("");
}

function textoPrecio(p) {
  if (comprobando.has(p.id) || comprobando.has("*")) return `<div class="precio sin"><span class="girando">↻</span> Comprobando…</div>`;
  if (p.mejor) return `<div class="precio">${dinero(p.mejor.total)}</div>`;
  if (p.agotado) return `<div class="precio sin">Agotado</div>`;
  if (p.enlaces.length === 0) return `<div class="precio sin">Sin enlaces</div>`;
  if (!p.ultima_lectura) return `<div class="precio sin">Pendiente de comprobar</div>`;
  return `<div class="precio sin">Sin precio (ver errores)</div>`;
}

function pintarProductos() {
  $("#vacio").hidden = productos.length > 0;
  $("#productos").innerHTML = productos.map((p) => {
    const abierto = abiertos.has(p.id);
    const falta = p.mejor && p.precio_deseado && !p.oferta
      ? `<div class="falta">a ${dinero(p.mejor.total - p.precio_deseado)} de tu objetivo (${dinero(p.precio_deseado)})</div>`
      : "";
    return `
      <article class="tarjeta ${abierto ? "abierta" : ""} ${p.oferta ? "es-oferta" : ""}" data-id="${esc(p.id)}">
        <div class="resumen" role="button" tabindex="0" aria-expanded="${abierto}">
          <div class="img-caja">${imagen(p)}${p.oferta ? '<span class="etiqueta-oferta">OFERTA</span>' : ""}</div>
          <div class="info">
            <div class="nombre">${esc(p.nombre)}</div>
            ${textoPrecio(p)}
            ${p.mejor ? `<div class="meta">en ${esc(p.mejor.tienda)} · ${textoEnvio(p.mejor)}</div>` : ""}
            ${comprobando.has("buscar:" + p.id) ? `<div class="meta"><span class="girando">✨</span> Buscando tiendas…</div>` : ""}
            ${falta}
          </div>
          ${abierto ? '<div class="cerrar">Cerrar ▲</div>' : ""}
        </div>
        ${abierto ? detalle(p) : ""}
      </article>`;
  }).join("");
}

function detalle(p) {
  const ocupado = comprobando.has(p.id) || comprobando.has("*");
  const buscando = comprobando.has("buscar:" + p.id);
  const filas = p.enlaces.map((e) => {
    const esMejor = p.mejor && p.mejor.id === e.id;
    let est;
    if (e.error) est = `<span class="chip ko" title="${esc(e.error)}">⚠ Error</span>`;
    else if (e.stock === false) est = `<span class="chip gris">Agotado</span>`;
    else if (e.veredicto === "no") est = `<span class="chip ko" title="${esc(e.motivo)}">✗ Otro producto</span>`;
    else if (e.veredicto === "variante") est = `<span class="chip duda" title="${esc(e.motivo)}">⚠ Variante</span>`;
    else if (e.ultima_lectura) est = `<span class="chip ok">✓ OK</span>`;
    else est = `<span class="chip gris">Pendiente</span>`;
    if (e.fuente === "IA" && !e.error) est += ` <span class="chip ia" title="El lector no entendía esta página y el precio lo ha leído la IA">✨ IA</span>`;
    const precioOriginal = e.precio != null && e.moneda !== "EUR"
      ? `<div class="tenue">${dinero(e.precio, e.moneda)}</div>` : "";
    return `
      <tr class="${esMejor ? "mejor" : ""}">
        <td class="tienda"><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer" title="${esc(e.url)}">${esc(e.tienda)} ↗</a></td>
        <td class="p">${e.total != null ? dinero(e.total) : "—"}${precioOriginal}</td>
        <td class="col-envio"><button class="btn-envio" data-envio="${esc(e.id)}" title="${esc(tituloEnvio(e))}">${celdaEnvio(e)}</button></td>
        <td>${est}</td>
        <td class="tenue col-fecha">${hace(e.ultima_lectura)}</td>
        <td class="der"><button class="btn-x" data-borrar-enlace="${esc(e.id)}" title="Quitar enlace">×</button></td>
      </tr>`;
  }).join("");

  return `
    <div class="detalle">
      <form class="formulario" data-form="editar">
        <label>Nombre <input name="nombre" value="${esc(p.nombre)}" required></label>
        <label>Descripción <textarea name="descripcion" rows="3">${esc(p.descripcion)}</textarea></label>
        <label>Precio deseado (€) <input name="precio_deseado" inputmode="decimal" value="${p.precio_deseado ?? ""}"></label>
        <div class="dato-min">Mínimo últimos 30 días: <b>${p.minimo_30d != null ? dinero(p.minimo_30d) : "—"}</b></div>
        <div class="botones">
          <button class="btn primario" type="submit">Guardar</button>
          <button class="btn" type="button" data-accion="comprobar" ${ocupado ? "disabled" : ""}>↻ Comprobar ahora</button>
          <button class="btn" type="button" data-accion="buscar" ${buscando ? "disabled" : ""}>${buscando ? '<span class="girando">✨</span> Buscando…' : "✨ Buscar tiendas"}</button>
          <button class="btn peligro" type="button" data-accion="borrar">Eliminar</button>
        </div>
      </form>
      <div>
        ${p.enlaces.length ? `
          <table class="tabla">
            <thead><tr><th>Tienda</th><th>Total</th><th class="col-envio">Envío</th><th>Estado</th><th class="col-fecha">Comprobado</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>` : `<p class="tenue">Este producto aún no tiene enlaces.</p>`}
        <p class="tenue nota-total">Total = precio + envío a España, en euros. Toca el envío para corregirlo a mano.</p>
        ${sugerencias(p, buscando)}
        <form class="form-enlace" data-form="enlace">
          <input name="url" placeholder="Pega aquí el enlace de otra tienda…" required>
          <button class="btn" type="submit">Añadir</button>
        </form>
      </div>
    </div>`;
}

// ---------- Envío ----------
function textoEnvio(e) {
  if (e.envio_eur == null) return "envío sin confirmar";
  return e.envio_eur === 0 ? "envío gratis" : `${dinero(e.envio_eur)} de envío incl.`;
}
function celdaEnvio(e) {
  if (e.envio_eur == null) return `<span class="tenue">¿?</span>`;
  const valor = e.envio_eur === 0 ? "Gratis" : dinero(e.envio_eur);
  return e.envio_fuente === "manual" ? `${valor} ✎` : valor;
}
function tituloEnvio(e) {
  const origen = { manual: "escrito por ti", tienda: "publicado por la tienda", IA: "averiguado por la IA" }[e.envio_fuente];
  const nota = e.envio?.nota ? ` · ${e.envio.nota}` : "";
  return (e.envio_eur == null ? "Envío desconocido" : `Envío ${origen || ""}${nota}`) + ". Toca para cambiarlo.";
}

// ---------- Sugerencias de la IA ----------
function sugerencias(p, buscando) {
  if (buscando) return `<div class="sugerencias"><p class="tenue"><span class="girando">✨</span> La IA está buscando tiendas y comprobando sus precios (1-3 min)…</p></div>`;
  const b = busquedas[p.id];
  if (!b) return "";
  if (b.error && !(b.candidatos || []).length) return `<div class="sugerencias"><p class="motivo">${esc(b.error)}</p></div>`;
  const ya = new Set(p.enlaces.map((e) => claveUrl(e.url)));
  const lista = (b.candidatos || []).filter((c) => !ya.has(claveUrl(c.url)));
  if (!lista.length) return "";
  const filas = lista.map((c) => {
    const v = c.coincide?.veredicto;
    const chip = v === "no" ? `<span class="chip ko">✗ Otro producto</span>`
      : v === "variante" ? `<span class="chip duda">⚠ Variante</span>`
      : c.stock === false ? `<span class="chip gris">Agotado</span>` : "";
    const envio = c.envio_eur == null ? "envío ¿?" : c.envio_eur === 0 ? "envío gratis" : `+${dinero(c.envio_eur)} envío`;
    return `
      <label class="sugerencia">
        <input type="checkbox" name="sug" value="${esc(c.url)}" ${v === "si" && c.stock !== false ? "checked" : ""}>
        <span class="min0">
          <span class="sug-cab"><span class="sug-tienda">${esc(c.tienda)}</span> ${chip}</span>
          <span class="sug-titulo" title="${esc(c.titulo || "")}">${esc(c.titulo || c.url)}</span>
          ${c.coincide?.motivo && v !== "si" ? `<span class="tenue">${esc(c.coincide.motivo)}</span>` : ""}
        </span>
        <span class="der">
          <b>${c.total_eur != null ? dinero(c.total_eur) : dinero(c.precio, c.moneda)}</b>
          <span class="tenue sug-envio">${envio}</span>
          <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" class="tenue">ver ↗</a>
        </span>
      </label>`;
  }).join("");
  return `
    <details class="sugerencias" open>
      <summary>✨ La IA ha encontrado ${lista.length} tienda${lista.length > 1 ? "s" : ""}</summary>
      <form data-form="sugerencias">
        ${filas}
        <div class="botones">
          <button class="btn primario" type="submit">Añadir las marcadas</button>
          <button class="btn-texto" type="button" data-accion="descartar">Descartar sugerencias</button>
        </div>
      </form>
    </details>`;
}

function claveUrl(url) {
  try {
    const u = new URL(url);
    const asin = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/i);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    return asin && host.includes("amazon.") ? `${host}/dp/${asin[1].toUpperCase()}` : host + u.pathname.replace(/\/$/, "").toLowerCase();
  } catch { return url; }
}

async function cargarBusqueda(id) {
  try {
    const b = await leerJSON(RUTA.busqueda(id), null);
    if (b) busquedas[id] = b; else delete busquedas[id];
  } catch { /* sin sugerencias */ }
}

function pintarErrores() {
  const errores = productos.flatMap((p) => p.enlaces.filter((e) => e.error).map((e) => ({ p, e })));
  // Avisos de la IA: enlaces que quizá no son el mismo producto
  const dudas = productos.flatMap((p) => p.enlaces
    .filter((e) => !e.error && (e.veredicto === "no" || e.veredicto === "variante")).map((e) => ({ p, e })));
  $("#num-errores").textContent = (errores.length + dudas.length) || "";
  const htmlErrores = errores.map(({ p, e }) => `
        <div class="error-item">
          <div><div class="prod" data-ir="${esc(p.id)}">${esc(p.nombre)}</div><div class="tenue">${esc(e.tienda)} · ${hace(e.ultima_lectura)}</div></div>
          <div><div class="motivo">${esc(e.error)}</div><div class="url">${esc(e.url)}</div></div>
          <a class="btn" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>
        </div>`).join("");
  const htmlDudas = dudas.map(({ p, e }) => `
        <div class="error-item duda">
          <div><div class="prod" data-ir="${esc(p.id)}">${esc(p.nombre)}</div><div class="tenue">${esc(e.tienda)}</div></div>
          <div><div class="motivo">✨ ${e.veredicto === "no" ? "La IA cree que es otro producto (no cuenta para el mejor precio)" : "La IA cree que es otra variante"}: ${esc(e.motivo)}</div>
            <div class="url">${esc(e.titulo || e.url)}</div></div>
          <div class="botones">
            <button class="btn" data-correcto="${esc(p.id)}|${esc(e.id)}" title="Quitar este aviso">Es correcto</button>
            <a class="btn" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Abrir ↗</a>
          </div>
        </div>`).join("");
  $("#lista-errores").innerHTML = htmlErrores + htmlDudas || `<p class="todo-ok">✓ Todos los enlaces se están leyendo bien.</p>`;
}

// ---------- Esperar a que termine la comprobación en GitHub ----------
let vigilando = false;

async function vigilarComprobacion() {
  if (vigilando) return;
  vigilando = true;
  try {
    while (comprobando.size) {
      await new Promise((r) => setTimeout(r, 8000));
      let nuevo = null;
      const busquedasTerminadas = [];
      try {
        if ([...comprobando.keys()].some((k) => !k.startsWith("buscar:"))) nuevo = await leerJSON(RUTA.estado, null);
        for (const [clave, pedido] of comprobando) {
          if (!clave.startsWith("buscar:")) continue;
          const id = clave.slice(7);
          const b = await leerJSON(RUTA.busqueda(id), null);
          if (b?.fin && new Date(b.inicio).getTime() >= pedido - 60000) {
            busquedas[id] = b;
            busquedasTerminadas.push(clave);
          }
        }
      } catch { continue; }
      const inicio = nuevo?.ejecucion?.inicio ? new Date(nuevo.ejecucion.inicio).getTime() : 0;
      let terminado = false;
      for (const [id, pedido] of comprobando) {
        if (busquedasTerminadas.includes(id)) {
          comprobando.delete(id);
          const b = busquedas[id.slice(7)];
          avisar(b.error && !b.candidatos?.length ? b.error : "✨ Búsqueda terminada: marca las tiendas que quieras añadir");
          pintar();
        } else if (id.startsWith("buscar:")) {
          if (Date.now() - pedido > 10 * 60000) {
            comprobando.delete(id);
            avisar("La búsqueda está tardando mucho. Mira la pestaña Actions de tu repositorio.");
          }
        } else if (inicio >= pedido - 60000) {   // una ejecución que empezó después de pedirla
          comprobando.delete(id);
          terminado = true;
        } else if (Date.now() - pedido > 10 * 60000) {
          comprobando.delete(id);
          avisar("La comprobación está tardando mucho. Mira la pestaña Actions de tu repositorio.");
        }
      }
      if (terminado) {
        await cargar();
        const ofertas = productos.filter((p) => p.oferta).length;
        avisar(ofertas ? `Comprobado · ${ofertas} producto(s) a tu precio 🔥` : "Comprobación terminada");
      } else {
        pintar();
      }
    }
  } finally {
    vigilando = false;
  }
}

// ---------- Acciones ----------
async function accion(fn) {
  try { await fn(); } catch (e) { avisar(e.message); }
}

function irA(id) {
  abiertos.add(id);
  pintar();
  document.querySelector(`.tarjeta[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#productos").addEventListener("click", (ev) => {
  const tarjeta = ev.target.closest(".tarjeta");
  if (!tarjeta) return;
  const id = tarjeta.dataset.id;

  if (ev.target.closest(".resumen")) {
    if (abiertos.has(id)) abiertos.delete(id);
    else {
      abiertos.add(id);
      cargarBusqueda(id).then(pintar);
    }
    return pintar();
  }
  const envio = ev.target.closest("[data-envio]");
  if (envio) return cambiarEnvio(id, envio.dataset.envio);
  const borrarEnlace = ev.target.closest("[data-borrar-enlace]");
  if (borrarEnlace) {
    if (!confirm("¿Quitar este enlace?")) return;
    const eid = borrarEnlace.dataset.borrarEnlace;
    return accion(() => cambiarProductos("quitar enlace", (lista) => {
      const p = lista.find((x) => x.id === id);
      if (p) p.enlaces = p.enlaces.filter((e) => e.id !== eid);
    }));
  }
  const tipo = ev.target.closest("[data-accion]")?.dataset.accion;
  if (tipo === "comprobar") return accion(() => lanzarComprobacion(id));
  if (tipo === "buscar") return accion(async () => {
    await lanzarComprobacion(id, "buscar");
    avisar("✨ Buscando tiendas con IA (1-3 min)…");
  });
  if (tipo === "descartar") {
    delete busquedas[id];
    return pintar();
  }
  if (tipo === "borrar") {
    const p = productos.find((x) => x.id === id);
    if (!confirm(`¿Eliminar "${p.nombre}" y todo su historial?`)) return;
    return accion(async () => {
      await cambiarProductos(`eliminar ${p.nombre}`, (lista) => {
        const i = lista.findIndex((x) => x.id === id);
        if (i >= 0) lista.splice(i, 1);
      });
      abiertos.delete(id);
      avisar("Producto eliminado");
    });
  }
});

$("#productos").addEventListener("keydown", (ev) => {
  if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList.contains("resumen")) {
    ev.preventDefault();
    ev.target.click();
  }
});

$("#productos").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const id = form.closest(".tarjeta").dataset.id;
  const datos = Object.fromEntries(new FormData(form));
  const boton = form.querySelector("[type=submit]");
  boton.disabled = true;
  try {
    if (form.dataset.form === "sugerencias") {
      const urls = new FormData(form).getAll("sug");
      if (!urls.length) throw new Error("Marca al menos una tienda");
      await cambiarProductos(`añadir ${urls.length} tiendas sugeridas`, (lista) => {
        const p = lista.find((x) => x.id === id);
        if (p) for (const url of urls) p.enlaces.push({ id: nuevoId("e"), url });
      });
      await lanzarComprobacion(id);
      avisar(`${urls.length} tienda(s) añadida(s). Comprobando precios (1-2 min)…`);
    } else if (form.dataset.form === "editar") {
      const nombre = datos.nombre.trim();
      if (!nombre) throw new Error("El nombre no puede quedar vacío");
      const precio = leerPrecio(datos.precio_deseado);
      await cambiarProductos(`editar ${nombre}`, (lista) => {
        const p = lista.find((x) => x.id === id);
        if (p) Object.assign(p, { nombre, descripcion: datos.descripcion.trim(), precio_deseado: precio });
      });
      avisar("Cambios guardados");
    } else {
      const url = urlValida(datos.url);
      boton.textContent = "Guardando…";
      await cambiarProductos("añadir enlace", (lista) => {
        lista.find((x) => x.id === id)?.enlaces.push({ id: nuevoId("e"), url });
      });
      await lanzarComprobacion(id);
      avisar("Enlace añadido. Comprobando su precio (1-2 min)…");
    }
  } catch (e) {
    avisar(e.message);
    boton.disabled = false;
  }
});

document.addEventListener("click", (ev) => {
  if (ev.target.closest("a")) return;
  const ir = ev.target.closest("[data-ir]");
  if (ir) irA(ir.dataset.ir);
});

$("#lista-errores").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-correcto]");
  if (!b) return;
  const [pid, eid] = b.dataset.correcto.split("|");
  accion(async () => {
    await cambiarProductos("marcar enlace como correcto", (lista) => {
      const en = lista.find((x) => x.id === pid)?.enlaces.find((e) => e.id === eid);
      if (en) en.coincide_ok = true;
    });
    avisar("Hecho: ese enlace ya cuenta como el mismo producto");
  });
});

function cambiarEnvio(pid, eid) {
  const e = productos.find((x) => x.id === pid)?.enlaces.find((x) => x.id === eid);
  const actual = e?.envio_fuente === "manual" ? String(e.envio_eur).replace(".", ",") : "";
  const texto = prompt(
    "Gastos de envío a España en € para esta tienda (0 = gratis).\nDéjalo vacío para que se calculen solos.", actual);
  if (texto === null) return;
  accion(async () => {
    const valor = texto.trim() === "" ? null : Number(texto.replace(",", ".").replace(/[€\s]/g, ""));
    if (valor !== null && !(valor >= 0)) throw new Error("El envío debe ser un número (0 = gratis)");
    await cambiarProductos("cambiar envío", (lista) => {
      const en = lista.find((x) => x.id === pid)?.enlaces.find((x) => x.id === eid);
      if (!en) return;
      if (valor === null) delete en.envio; else en.envio = Math.round(valor * 100) / 100;
    });
    avisar(valor === null ? "El envío se calculará solo en la próxima comprobación" : "Envío guardado");
  });
}

// ---------- Nuevo producto ----------
function campoEnlace() {
  const input = document.createElement("input");
  input.name = "enlace";
  input.type = "url";
  input.placeholder = "https://www.tienda.com/producto…";
  $("#nuevo-enlaces").appendChild(input);
  return input;
}

function abrirNuevo() {
  $("#form-nuevo").reset();
  $("#nuevo-enlaces").innerHTML = "";
  campoEnlace();
  $("#dlg-nuevo").showModal();
}

$("#btn-nuevo").addEventListener("click", abrirNuevo);
$("#btn-vacio").addEventListener("click", abrirNuevo);
$("#btn-cancelar").addEventListener("click", () => $("#dlg-nuevo").close());
$("#btn-mas-enlace").addEventListener("click", () => campoEnlace().focus());

$("#form-nuevo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const boton = ev.target.querySelector("[type=submit]");
  try {
    const nombre = f.get("nombre").trim();
    if (!nombre) throw new Error("Ponle un nombre al producto");
    const producto = {
      id: nuevoId("p"),
      nombre,
      descripcion: f.get("descripcion").trim(),
      precio_deseado: leerPrecio(f.get("precio_deseado")),
      creado: new Date().toISOString().slice(0, 19) + "Z",
      enlaces: f.getAll("enlace").filter((u) => u.trim()).map((u) => ({ id: nuevoId("e"), url: urlValida(u) })),
    };
    boton.disabled = true;
    await cambiarProductos(`nuevo producto ${nombre}`, (lista) => { lista.unshift(producto); });
    $("#dlg-nuevo").close();
    abiertos.add(producto.id);
    if (producto.enlaces.length) {
      await lanzarComprobacion(producto.id);
      avisar("Producto creado. Comprobando precios (1-2 min)…");
    } else {
      await lanzarComprobacion(producto.id, "buscar");
      avisar("Producto creado. ✨ La IA está buscando tiendas (1-3 min)…");
    }
    pintar();
  } catch (e) {
    avisar(e.message);
  } finally {
    boton.disabled = false;
  }
});

$("#btn-comprobar-todo").addEventListener("click", () => accion(async () => {
  await lanzarComprobacion("");
  avisar("Comprobando todos los precios (1-3 min)…");
}));

// ---------- Conectar / desconectar ----------
function mostrar(conectado) {
  $("#conectar").hidden = conectado;
  $("#contenido").hidden = !conectado;
  $("#acciones").hidden = !conectado;
  if (!conectado) {
    $("#estado").textContent = "Sin conectar";
    $("#selector-perfil").hidden = true;
  }
}

function desconectar(motivo) {
  token = "";
  perfiles = [];
  repo = "";
  guardarToken("");
  mostrar(false);
  const err = $("#conectar-error");
  err.hidden = !motivo;
  err.textContent = motivo || "";
}

// Prueba la llave contra cada perfil y se queda con los que puede abrir
async function detectarPerfiles() {
  const pruebas = await Promise.allSettled(
    PERFILES.map((p) => gh("GET", `/repos/${CONFIG.owner}/${p.repo}`)));
  const fallo401 = pruebas.find((r) => r.status === "rejected" && r.reason.status === 401);
  if (fallo401) throw fallo401.reason;
  perfiles = PERFILES.filter((_, i) => pruebas[i].status === "fulfilled");
  if (!perfiles.length) {
    throw new ErrorGitHub("Esta llave no abre ningún perfil. Revisa a qué repositorio le diste acceso.", 404);
  }
  const guardado = leerPerfil();
  repo = (perfiles.find((p) => p.repo === guardado) || perfiles[0]).repo;
  pintarSelectorPerfil();
}

function pintarSelectorPerfil() {
  const sel = $("#perfil");
  sel.innerHTML = perfiles.map((p) =>
    `<option value="${esc(p.repo)}" ${p.repo === repo ? "selected" : ""}>${esc(p.nombre)}</option>`).join("");
  $("#selector-perfil").hidden = perfiles.length < 2;   // solo el administrador ve el selector
  // Franja de color cuando el administrador está viendo el perfil de otra persona
  document.body.classList.toggle("perfil-ajeno", perfiles.length > 1 && repo !== perfiles[0].repo);
}

async function cambiarPerfil(nuevo) {
  if (nuevo === repo) return;
  repo = nuevo;
  guardarPerfil(repo);
  pintarSelectorPerfil();
  abiertos.clear();
  comprobando.clear();
  productosRaw = []; estado = { enlaces: {} }; historial = {}; busquedas = {};
  construir();
  pintar();
  $("#estado").textContent = "Cargando…";
  try { await cargar(); } catch (e) { avisar(e.message); }
}

$("#perfil").addEventListener("change", (ev) => cambiarPerfil(ev.target.value));

async function entrar() {
  await detectarPerfiles();
  mostrar(true);
  await cargar();
}

$("#form-conectar").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const boton = ev.target.querySelector("button");
  boton.disabled = true;
  token = $("#token").value.trim();
  try {
    await entrar();
    guardarToken(token);
    $("#token").value = "";
    $("#conectar-error").hidden = true;
  } catch (e) {
    token = "";
    mostrar(false);
    $("#conectar-error").hidden = false;
    $("#conectar-error").textContent = e.message;
  } finally {
    boton.disabled = false;
  }
});

$("#btn-desconectar").addEventListener("click", () => {
  if (confirm("¿Quitar la llave de este navegador? Tendrás que volver a pegarla para entrar.")) desconectar();
});

// ---------- Arranque ----------
async function refrescar() {
  if (!token || !repo || comprobando.size) return;
  try { await cargar(); } catch { /* se reintenta en el siguiente ciclo */ }
}

token = leerToken();
if (token) {
  entrar().catch((e) => avisar(e.message));
} else {
  mostrar(false);
}
setInterval(() => { if (!document.hidden) refrescar(); }, 120000);
setInterval(() => { if (token && repo && !comprobando.size) pintarEstado(); }, 30000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refrescar(); });
