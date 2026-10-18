// almacen.js - Dónde se guardan tus notas.
//
// 1) SIEMPRE en este navegador (localStorage): funciona al momento y sin internet.
// 2) Y, si este navegador tiene tu llave de GitHub, también en tu repositorio PRIVADO
//    (WEBS/calendario/notas.json). Así las ves igual en el PC y en el móvil.
//
// La web es pública, pero tus notas no: sin tu llave nadie puede leer ese archivo.
// Si dos dispositivos cambian cosas a la vez, se mezclan nota a nota (gana el cambio más reciente).

import { CONFIG } from "./config.js";

const CLAVE_LOCAL = "calendario.notas";
// La misma llave que usa el Vigilante de precios (mismo sitio web), así no hay que pegarla dos veces
const CLAVE_LLAVE = "vigilante-precios.token";
const DIAS_GUARDAR_BORRADAS = 180;
const CAT_ANUAL = "cumple";          // las notas de esta categoría salen todos los años   // las notas borradas se recuerdan un tiempo para que la mezcla funcione

let datos = vacio();       // { version, notas: { id: nota } }
let porDia = new Map();    // "AAAA-MM-DD" -> [notas], para pintar rápido
let llave = "";
let sha = null;            // versión del archivo en GitHub
let enCurso = false, pendiente = false, temporizador = null;
const oyentes = new Set();
export const estado = { modo: "local", texto: "Solo en este navegador" };

function vacio() { return { version: 1, notas: {} }; }

// ---------- Avisar a la web de que algo cambió ----------
export function alCambiar(fn) { oyentes.add(fn); }
function avisar(que) { for (const fn of oyentes) fn(que); }
function ponerEstado(modo, texto) {
  estado.modo = modo; estado.texto = texto;
  avisar("estado");
}

// ---------- Copia en este navegador ----------
function leerLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(CLAVE_LOCAL));
    return d && d.notas ? d : vacio();
  } catch { return vacio(); }
}
function guardarLocal() {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(datos)); } catch {}
}
function leerLlave() { try { return localStorage.getItem(CLAVE_LLAVE) || ""; } catch { return ""; } }

let anuales = new Map();   // "MM-DD" -> [cumpleaños], que se repiten cada año

function reindexar() {
  porDia = new Map();
  anuales = new Map();
  for (const n of Object.values(datos.notas)) {
    if (n.borrada) continue;
    const [indice, k] = n.cat === CAT_ANUAL ? [anuales, n.fecha.slice(5)] : [porDia, n.fecha];
    if (!indice.has(k)) indice.set(k, []);
    indice.get(k).push(n);
  }
  for (const lista of porDia.values()) lista.sort(ordenNotas);
}
// Primero las que tienen hora (por hora), luego las demás por orden de creación
function ordenNotas(a, b) {
  if (a.hora && b.hora) return a.hora.localeCompare(b.hora);
  if (a.hora) return -1;
  if (b.hora) return 1;
  return (a.creada || 0) - (b.creada || 0);
}

// ---------- Lo que usa el resto de la web ----------
export function iniciar() {
  datos = leerLocal();
  reindexar();
  llave = leerLlave();
  if (llave) sincronizar();
  // Al volver a la pestaña, traer cambios hechos en otro dispositivo
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && llave) sincronizar();
  });
}

// Notas de un día ("AAAA-MM-DD"), incluidos los cumpleaños de ese día de cualquier año
export function notasDe(claveDia) {
  const normales = porDia.get(claveDia) || [];
  const md = claveDia.slice(5);
  let cumples = anuales.get(md) || [];
  // Quien nació un 29 de febrero lo celebra el 28 los años que no son bisiestos
  const anio = +claveDia.slice(0, 4);
  if (md === "02-28" && !(anio % 4 === 0 && (anio % 100 !== 0 || anio % 400 === 0))) {
    cumples = cumples.concat(anuales.get("02-29") || []);
  }
  if (!cumples.length) return normales;
  return [...cumples.map((n) => ({ ...n, fecha: claveDia })), ...normales];
}
export const tieneLlave = () => !!llave;

export function guardarNota(nota) {
  const ahora = Date.now();
  const id = nota.id || nuevoId();
  const anterior = datos.notas[id] || { creada: ahora };
  const nueva = { ...anterior, ...nota, id, mod: ahora };
  delete nueva.borrada;   // por si se está deshaciendo un borrado
  datos.notas[id] = nueva;
  cambiado();
  return id;
}

export function borrarNota(id) {
  const n = datos.notas[id];
  if (!n) return;
  // No se elimina del todo: se marca como borrada para que el otro dispositivo también la borre
  datos.notas[id] = { id, fecha: n.fecha, borrada: true, mod: Date.now() };
  cambiado();
}

function cambiado() {
  guardarLocal();
  reindexar();
  avisar("notas");
  if (llave) {
    ponerEstado("pendiente", "Guardando…");
    clearTimeout(temporizador);
    temporizador = setTimeout(sincronizar, 1200);   // espera un poco por si haces varios cambios seguidos
  }
}

function nuevoId() {
  return crypto.randomUUID ? crypto.randomUUID().slice(0, 13) : Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- Copia de seguridad ----------
export function exportar() {
  return JSON.stringify(datos, null, 1);
}
export function importar(texto) {
  const otro = JSON.parse(texto);
  if (!otro || typeof otro.notas !== "object") throw new Error("Ese archivo no es una copia del calendario");
  datos = mezclar(datos, otro);
  cambiado();
  return Object.values(otro.notas).filter((n) => !n.borrada).length;
}

// ---------- Conectar con GitHub ----------
export async function conectar(nuevaLlave) {
  llave = nuevaLlave.trim();
  try {
    await leerRemoto();   // comprueba que la llave abre el repositorio
  } catch (e) {
    llave = "";
    throw e;
  }
  try { localStorage.setItem(CLAVE_LLAVE, llave); } catch {}
  await sincronizar();
}

export function desconectar() {
  llave = "";
  try { localStorage.removeItem(CLAVE_LLAVE); } catch {}
  ponerEstado("local", "Solo en este navegador");
}

// ---------- API de GitHub ----------
const { owner, repo, rama, ruta } = CONFIG.github;
const URL_ARCHIVO = `https://api.github.com/repos/${owner}/${repo}/contents/${ruta}`;

class ErrorGitHub extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function gh(metodo, url, cuerpo) {
  let r;
  try {
    r = await fetch(url, {
      method: metodo,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${llave}`,
        Accept: "application/vnd.github+json",
        ...(cuerpo ? { "Content-Type": "application/json" } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorGitHub("Sin conexión con GitHub", 0);
  }
  const datosRespuesta = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = {
      401: "La llave no es válida o ha caducado",
      403: "La llave no tiene permiso de escritura (Contents: Read and write)",
      404: `La llave no tiene acceso al repositorio ${repo}`,
    }[r.status] || `GitHub respondió con un error (${r.status})`;
    throw new ErrorGitHub(msg, r.status);
  }
  return datosRespuesta;
}

const deB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
function aB64(texto) {
  let binario = "";
  for (const b of new TextEncoder().encode(texto)) binario += String.fromCharCode(b);
  return btoa(binario);
}

async function leerRemoto() {
  try {
    const r = await gh("GET", `${URL_ARCHIVO}?ref=${rama}`);
    return { remoto: JSON.parse(deB64(r.content)), sha: r.sha };
  } catch (e) {
    if (e.status !== 404) throw e;
    // 404 puede ser "el archivo aún no existe" (normal la primera vez) o "no hay acceso al repo"
    await gh("GET", `https://api.github.com/repos/${owner}/${repo}`);
    return { remoto: vacio(), sha: null };
  }
}

// Une dos copias: por cada nota se queda la versión cambiada más recientemente
function mezclar(a, b) {
  const notas = { ...a.notas };
  for (const [id, n] of Object.entries(b.notas || {})) {
    if (!notas[id] || (n.mod || 0) > (notas[id].mod || 0)) notas[id] = n;
  }
  const limite = Date.now() - DIAS_GUARDAR_BORRADAS * 86400000;
  for (const [id, n] of Object.entries(notas)) {
    if (n.borrada && n.mod < limite) delete notas[id];
  }
  return { version: 1, notas };
}

function iguales(a, b) {
  const ka = Object.keys(a.notas), kb = Object.keys(b.notas || {});
  if (ka.length !== kb.length) return false;
  return ka.every((id) => b.notas[id] && b.notas[id].mod === a.notas[id].mod);
}

export async function sincronizar() {
  if (!llave) return;
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
      if (habiaCambiosFuera) { reindexar(); avisar("notas"); }
      if (sha && iguales(mezcla, leido.remoto)) break;   // GitHub ya está al día
      try {
        const r = await gh("PUT", URL_ARCHIVO, {
          message: "calendario: notas actualizadas",
          content: aB64(JSON.stringify(mezcla, null, 1) + "\n"),
          branch: rama,
          ...(sha ? { sha } : {}),
        });
        sha = r.content.sha;
        break;
      } catch (e) {
        // 409/422 = otro dispositivo guardó justo a la vez: se vuelve a leer y mezclar
        if ((e.status === 409 || e.status === 422) && intento < 3) continue;
        throw e;
      }
    }
    ponerEstado("ok", "Guardado en GitHub");
  } catch (e) {
    if (e.status === 401) desconectar();
    ponerEstado("error", e.message);
  } finally {
    enCurso = false;
    if (pendiente) { pendiente = false; sincronizar(); }
  }
}
