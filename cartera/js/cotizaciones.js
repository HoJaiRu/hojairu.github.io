// cotizaciones.js - Los precios de tus valores.
//
// De dónde salen:
//  - Acciones, ETF y fondos: el ROBOT (GitHub Actions en tu repo privado) los lee de Yahoo Finance
//    cada 30 min con la bolsa abierta, o al momento cuando pulsas "Actualizar". Los guarda en la rama
//    "cotizaciones" de WEBS y esta web la mira cada 30 s (si no ha cambiado, no cuesta nada).
//  - Criptomonedas: además, EN DIRECTO desde Binance cada 10 s (datos públicos, sin cuenta).
//  - Si un valor no tiene precio, puedes poner uno a mano en su ficha.
//
// Ningún servicio externo ve tu cartera: solo se pide el precio de cada valor, sin cantidades.

import { CONFIG } from "./config.js";
import { gh, API_REPO, tieneLlave } from "./github.js";
import * as almacen from "./almacen.js";

const CLAVE_LOCAL = "cartera.cotizaciones";
const { ramaCotizaciones, rutaCotizaciones, workflow, rama } = CONFIG.github;
const URL_COTIZACIONES = `${API_REPO}/contents/${rutaCotizaciones}?ref=${ramaCotizaciones}`;

let datos = leerLocal();     // lo último que trajo el robot
let etag = null;
const vivo = {};             // ticker -> precio en directo (cripto)
let esperandoRobot = null;   // { desde, antes } mientras el robot trabaja
let otraVez = false;         // se pidió otra actualización mientras el robot trabajaba
const oyentes = new Set();
export const estado = { texto: "", actualizando: false };

export function alCambiar(fn) { oyentes.add(fn); }
const avisar = () => { for (const fn of oyentes) fn(); };

function leerLocal() {
  try { return JSON.parse(localStorage.getItem(CLAVE_LOCAL)) || vacio(); } catch { return vacio(); }
}
function vacio() { return { actualizado: null, activos: {}, divisas: {}, errores: {} }; }

// ---------- Arranque ----------
let iniciado = false;
export function iniciar() {
  leer().then(refrescarSiViejo);
  if (iniciado) return;   // al conectar la llave se vuelve a llamar: solo leer, sin duplicar relojes
  iniciado = true;
  setInterval(() => { if (document.visibilityState === "visible") leer(); }, CONFIG.segundosLeerCotizaciones * 1000);
  leerCripto();
  setInterval(() => { if (document.visibilityState === "visible") leerCripto(); }, CONFIG.segundosCripto * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { leer(); leerCripto(); }
  });
  // Si llega una cripto nueva (o la cartera desde GitHub), su precio en directo se pide ya
  let antes = "";
  almacen.alCambiar((que) => {
    if (que !== "datos") return;
    const criptos = almacen.activos().map((a) => a.ticker + (a.simbolo || "")).join();
    if (criptos !== antes) { antes = criptos; leerCripto(); }
  });
}

// ---------- Lo que trae el robot ----------
async function leer() {
  if (!tieneLlave()) return;
  try {
    const r = await gh("GET", URL_COTIZACIONES, { aceptar: "application/vnd.github.raw+json", etag });
    if (r.status === 304) return;
    etag = r.etag;
    datos = typeof r.datos === "string" ? JSON.parse(r.datos) : r.datos;
    try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(datos)); } catch {}
    if (esperandoRobot && datos.actualizado !== esperandoRobot.antes) terminarEspera();
    avisar();
  } catch (e) {
    if (e.status !== 404) console.warn("Cotizaciones:", e.message);   // 404 = el robot aún no ha corrido nunca
  }
}

// Bolsas europeas y de EE. UU. abiertas, más o menos (de lunes a viernes, 7:00 a 21:00 UTC)
function hayBolsa(d = new Date()) {
  const dia = d.getUTCDay(), h = d.getUTCHours();
  return dia >= 1 && dia <= 5 && h >= 7 && h < 21;
}

function refrescarSiViejo() {
  if (!tieneLlave() || almacen.vacia() || !hayBolsa()) return;
  const edad = datos.actualizado ? (Date.now() - new Date(datos.actualizado)) / 60000 : Infinity;
  if (edad > CONFIG.minutosRefrescoAlAbrir) pedirActualizacion();
}

// Le pide al robot que traiga precios ahora (tarda unos 30-60 s)
export async function pedirActualizacion() {
  if (!tieneLlave()) throw new Error("Conecta GitHub para que el robot pueda traer precios");
  if (esperandoRobot) { otraVez = true; return; }   // ya está trabajando: se le pide otra vez cuando acabe
  await gh("POST", `${API_REPO}/actions/workflows/${workflow}/dispatches`, { cuerpo: { ref: rama } });
  esperandoRobot = { desde: Date.now(), antes: datos.actualizado, temporizador: setInterval(vigilarRobot, 5000) };
  estado.actualizando = true;
  avisar();
}
function vigilarRobot() {
  if (Date.now() - esperandoRobot.desde > 4 * 60000) terminarEspera();   // si tarda demasiado, se deja de esperar
  else leer();
}
function terminarEspera() {
  clearInterval(esperandoRobot.temporizador);
  esperandoRobot = null;
  estado.actualizando = false;
  avisar();
  if (otraVez) { otraVez = false; pedirActualizacion().catch(() => {}); }
}

// ---------- Cripto en directo (Binance, público) ----------
// Ticker al estilo Yahoo ("BTC-EUR") -> par de Binance ("BTCEUR"); los pares en dólares usan USDT
function parBinance(ticker) {
  const m = /^([A-Z0-9]+)-(EUR|USD)$/.exec(ticker);
  return m ? m[1] + (m[2] === "USD" ? "USDT" : "EUR") : null;
}

async function leerCripto() {
  // El símbolo bueno es el que encontró el robot (por ejemplo "Bitcoin" -> BTC-EUR)
  const simbolo = (a) => a.simbolo || datos.activos?.[a.ticker]?.simbolo || a.ticker;
  const criptos = almacen.activos().filter((a) => parBinance(simbolo(a)) && (a.tipo === "cripto" || datos.activos?.[a.ticker]?.tipo === "cryptocurrency"));
  if (!criptos.length) return;
  const resultados = await Promise.allSettled(criptos.map(async (a) => {
    const r = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${parBinance(simbolo(a))}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const t = await r.json();
    vivo[a.ticker] = {
      precio: +t.lastPrice,
      cierreAnterior: +t.openPrice,    // precio de hace 24 h (las criptos no "cierran")
      divisa: simbolo(a).endsWith("-USD") ? "USD" : "EUR",
      hora: new Date(t.closeTime).toISOString(),
    };
  }));
  if (resultados.some((r) => r.status === "fulfilled")) avisar();
}

// ---------- Consultas ----------
export const actualizado = () => datos.actualizado;
export const error = (ticker) => datos.errores?.[ticker] || null;
export const hayVivo = () => Object.keys(vivo).length > 0;

// Precio actual de un valor: { precio, cierreAnterior, divisa, nombre, hora, fuente } o null
export function de(ticker) {
  const robot = datos.activos?.[ticker];
  if (vivo[ticker]) return { ...robot, ...vivo[ticker], fuente: "vivo" };
  if (robot?.precio != null) return { ...robot, fuente: "robot" };
  const manual = almacen.activo(ticker)?.precioManual;
  if (manual) return { precio: manual.precio, cierreAnterior: manual.precio, divisa: almacen.activo(ticker).divisa || "EUR", hora: manual.fecha, fuente: "manual" };
  return null;
}

// Otros valores que encajaban con el nombre que escribiste (para elegir si el robot no acertó)
export const candidatos = (ticker) => datos.activos?.[ticker]?.candidatos || datos.opciones?.[ticker] || [];

// Historial de cierres diarios de un valor: { d: ["AAAA-MM-DD"...], c: [precio...] }
export const historico = (ticker) => datos.activos?.[ticker]?.historico || null;

// Cuántos euros vale 1 unidad de una moneda (hoy, o el día indicado)
export function aEuros(divisa, fecha) {
  if (!divisa || divisa === "EUR") return 1;
  const fx = datos.divisas?.[divisa];
  if (!fx) return null;
  if (fecha && fx.historico) {
    const v = valorEn(fx.historico, fecha);
    if (v != null) return v;
  }
  return fx.precio;
}

// Último cierre conocido en o antes de una fecha (búsqueda binaria)
export function valorEn(h, fecha) {
  let lo = 0, hi = h.d.length - 1, res = null;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (h.d[m] <= fecha) { res = h.c[m]; lo = m + 1; } else hi = m - 1;
  }
  return res;
}
