// almacen.js - Dónde se guardan tus operaciones (compras, ventas, dividendos).
//
// 1) SIEMPRE en este navegador (localStorage): funciona al momento y sin internet.
// 2) Y, si este navegador tiene tu llave de GitHub, también en tu repositorio PRIVADO
//    (WEBS/cartera/cartera.json). Así la ves igual en el PC y en el móvil, y el robot
//    sabe de qué valores tiene que traer el precio.
//
// La web es pública, pero tu cartera no: sin tu llave nadie puede leer ese archivo.
// Si dos dispositivos cambian cosas a la vez, se mezclan registro a registro (gana el más reciente).

import { CONFIG } from "./config.js";
import { gh, API_REPO, tieneLlave, ponerLlave, ErrorGitHub, deB64, aB64 } from "./github.js";

const CLAVE_LOCAL = "cartera.datos";
const COLECCIONES = ["activos", "operaciones"];
const DIAS_GUARDAR_BORRADOS = 180;   // los borrados se recuerdan un tiempo para que la mezcla funcione

let datos = vacio();   // { version, activos: { TICKER: activo }, operaciones: { id: operación } }
let sha = null;        // versión del archivo en GitHub
let enCurso = false, pendiente = false, temporizador = null;
const oyentes = new Set();
export const estado = { modo: "local", texto: "Solo en este navegador" };

function vacio() { return { version: 1, activos: {}, operaciones: {} }; }

// ---------- Avisar a la web de que algo cambió ----------
export function alCambiar(fn) { oyentes.add(fn); }
function avisar(que) { for (const fn of oyentes) fn(que); }
function ponerEstado(modo, texto) {
  estado.modo = modo; estado.texto = texto;
  avisar("estado");
}

// ---------- Copia en este navegador ----------
function normalizar(d) {
  const r = vacio();
  for (const c of COLECCIONES) r[c] = (d && typeof d[c] === "object" && d[c]) || {};
  return r;
}
function leerLocal() {
  try { return normalizar(JSON.parse(localStorage.getItem(CLAVE_LOCAL))); } catch { return vacio(); }
}
function guardarLocal() {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(datos)); } catch {}
}

// ---------- Lo que usa el resto de la web ----------
export function iniciar() {
  datos = leerLocal();
  if (tieneLlave()) sincronizar();
  // Al volver a la pestaña, traer cambios hechos en otro dispositivo
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && tieneLlave()) sincronizar();
  });
}

const vivos = (col) => Object.values(datos[col]).filter((x) => !x.borrado);
export const activos = () => vivos("activos");
export const activo = (ticker) => (datos.activos[ticker] && !datos.activos[ticker].borrado ? datos.activos[ticker] : null);
export const operaciones = () => vivos("operaciones").sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.creada || 0) - (b.creada || 0));
export const vacia = () => operaciones().length === 0;

export function guardarActivo(a) {
  const anterior = datos.activos[a.ticker] || { creada: Date.now() };
  const nuevo = { ...anterior, ...a, mod: Date.now() };
  delete nuevo.borrado;
  datos.activos[a.ticker] = nuevo;
  cambiado();
}

export function guardarOperacion(op) {
  const ahora = Date.now();
  const id = op.id || nuevoId();
  const anterior = datos.operaciones[id] || { creada: ahora };
  const nueva = { ...anterior, ...op, id, mod: ahora };
  delete nueva.borrado;
  datos.operaciones[id] = nueva;
  cambiado();
  return id;
}

export function borrarOperacion(id) {
  const op = datos.operaciones[id];
  if (!op) return;
  // No se elimina del todo: se marca como borrada para que el otro dispositivo también la borre
  datos.operaciones[id] = { id, borrado: true, mod: Date.now() };
  // Si el valor se queda sin operaciones, también desaparece de la lista
  if (datos.activos[op.ticker] && !operaciones().some((o) => o.ticker === op.ticker)) {
    datos.activos[op.ticker] = { ticker: op.ticker, borrado: true, mod: Date.now() };
  }
  cambiado();
}

function cambiado() {
  guardarLocal();
  avisar("datos");
  if (tieneLlave()) {
    ponerEstado("pendiente", "Guardando…");
    clearTimeout(temporizador);
    temporizador = setTimeout(sincronizar, 1000);   // espera un poco por si haces varios cambios seguidos
  }
}

function nuevoId() {
  return crypto.randomUUID ? crypto.randomUUID().slice(0, 13) : Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Copia de seguridad ----------
export const exportar = () => JSON.stringify(datos, null, 1);
export function importar(texto) {
  const otro = JSON.parse(texto);
  if (!otro || typeof otro.operaciones !== "object") throw new Error("Ese archivo no es una copia de la cartera");
  datos = mezclar(datos, normalizar(otro));
  cambiado();
  return Object.values(otro.operaciones).filter((o) => !o.borrado).length;
}

// ---------- Conectar con GitHub ----------
export async function conectar(nuevaLlave) {
  ponerLlave(nuevaLlave.trim());
  try {
    await leerRemoto();   // comprueba que la llave abre el repositorio
  } catch (e) {
    ponerLlave("");
    throw e;
  }
  await sincronizar();
}

export function desconectar() {
  ponerLlave("");
  ponerEstado("local", "Solo en este navegador");
}

// ---------- Leer, mezclar y guardar en GitHub ----------
const { rama, ruta } = CONFIG.github;
const URL_ARCHIVO = `${API_REPO}/contents/${ruta}`;

async function leerRemoto() {
  try {
    const { datos: r } = await gh("GET", `${URL_ARCHIVO}?ref=${rama}`);
    return { remoto: normalizar(JSON.parse(deB64(r.content))), sha: r.sha };
  } catch (e) {
    if (e.status !== 404) throw e;
    // 404 puede ser "el archivo aún no existe" (normal la primera vez) o "no hay acceso al repo"
    await gh("GET", API_REPO);
    return { remoto: vacio(), sha: null };
  }
}

// Une dos copias: por cada registro se queda la versión cambiada más recientemente
function mezclar(a, b) {
  const r = vacio();
  const limite = Date.now() - DIAS_GUARDAR_BORRADOS * 86400000;
  for (const c of COLECCIONES) {
    const todo = { ...a[c] };
    for (const [k, x] of Object.entries(b[c] || {})) {
      if (!todo[k] || (x.mod || 0) > (todo[k].mod || 0)) todo[k] = x;
    }
    for (const [k, x] of Object.entries(todo)) if (x.borrado && x.mod < limite) delete todo[k];
    r[c] = todo;
  }
  return r;
}

function iguales(a, b) {
  return COLECCIONES.every((c) => {
    const ka = Object.keys(a[c]), kb = Object.keys(b[c] || {});
    return ka.length === kb.length && ka.every((k) => b[c][k] && b[c][k].mod === a[c][k].mod);
  });
}

export async function sincronizar() {
  if (!tieneLlave()) return;
  if (enCurso) { pendiente = true; return; }
  enCurso = true;
  clearTimeout(temporizador);
  ponerEstado("pendiente", "Sincronizando…");
  try {
    for (let intento = 1; ; intento++) {
      const leido = await leerRemoto();
      sha = leido.sha;
      const mezcla = mezclar(datos, leido.remoto);
      const habiaCambiosFuera = !iguales(mezcla, datos);
      datos = mezcla;
      guardarLocal();
      if (habiaCambiosFuera) avisar("datos");
      if (sha && iguales(mezcla, leido.remoto)) break;   // GitHub ya está al día
      try {
        const { datos: r } = await gh("PUT", URL_ARCHIVO, {
          cuerpo: {
            message: "cartera: operaciones actualizadas",
            content: aB64(JSON.stringify(mezcla, null, 1) + "\n"),
            branch: rama,
            ...(sha ? { sha } : {}),
          },
        });
        sha = r.content.sha;
        avisar("subido");   // el robot ya puede ver los valores nuevos
        break;
      } catch (e) {
        // 409/422 = otro dispositivo guardó justo a la vez: se vuelve a leer y mezclar
        if ((e.status === 409 || e.status === 422) && intento < 3) continue;
        throw e;
      }
    }
    ponerEstado("ok", "Guardado en GitHub");
  } catch (e) {
    if (e instanceof ErrorGitHub && e.status === 401) desconectar();
    ponerEstado("error", e.message);
  } finally {
    enCurso = false;
    if (pendiente) { pendiente = false; sincronizar(); }
  }
}
