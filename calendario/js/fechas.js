// fechas.js - Utilidades de fechas y festivos de España.
// Las fechas de las notas se guardan como texto "AAAA-MM-DD" (sin horas), así no hay líos de husos horarios.

import { FESTIVOS_EXTRA, JUEVES_SANTO } from "./config.js";

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const DIAS_CORTOS = ["L", "M", "X", "J", "V", "S", "D"];

const dos = (n) => String(n).padStart(2, "0");

// Date -> "2026-10-17"
export function clave(d) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

// "2026-10-17" -> Date (a mediodía, para evitar saltos por cambio de hora)
export function desdeClave(texto) {
  const [a, m, d] = texto.split("-").map(Number);
  return new Date(a, m - 1, d, 12);
}

export function hoy() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

export function sumarDias(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Días completos entre dos fechas (b - a)
export function diasEntre(a, b) {
  return Math.round((desdeClave(clave(b)) - desdeClave(clave(a))) / 86400000);
}

// Lunes = 0 ... Domingo = 6
export const diaSemana = (d) => (d.getDay() + 6) % 7;

// Las 42 casillas (6 semanas) que se ven en un mes, empezando en lunes
export function casillasDelMes(anio, mes) {
  const primero = new Date(anio, mes, 1, 12);
  const inicio = sumarDias(primero, -diaSemana(primero));
  return Array.from({ length: 42 }, (_, i) => sumarDias(inicio, i));
}

// Número de semana ISO (la que usan los calendarios europeos)
export function numeroSemana(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const enero4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - enero4) / 86400000 - 3 + ((enero4.getUTCDay() + 6) % 7)) / 7);
}

export function fechaLarga(d) {
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
}

// ---------- Festivos ----------

// Domingo de Pascua (algoritmo de Meeus/Butcher)
function pascua(anio) {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes - 1, dia, 12);
}

const NACIONALES = [
  ["01-01", "Año Nuevo"],
  ["01-06", "Reyes"],
  ["05-01", "Día del Trabajo"],
  ["08-15", "Asunción de la Virgen"],
  ["10-12", "Fiesta Nacional"],
  ["11-01", "Todos los Santos"],
  ["12-06", "Día de la Constitución"],
  ["12-08", "Inmaculada Concepción"],
  ["12-25", "Navidad"],
];

const cacheFestivos = new Map();

// Devuelve un Map { "AAAA-MM-DD": "Nombre del festivo" } del año pedido
export function festivosDe(anio) {
  if (cacheFestivos.has(anio)) return cacheFestivos.get(anio);
  const mapa = new Map();
  for (const [md, nombre] of NACIONALES) mapa.set(`${anio}-${md}`, nombre);
  const p = pascua(anio);
  mapa.set(clave(sumarDias(p, -2)), "Viernes Santo");
  if (JUEVES_SANTO) mapa.set(clave(sumarDias(p, -3)), "Jueves Santo");
  for (const { fecha, nombre } of FESTIVOS_EXTRA) {
    if (/^\d{2}-\d{2}$/.test(fecha)) mapa.set(`${anio}-${fecha}`, nombre);
    else if (fecha.startsWith(anio + "-")) mapa.set(fecha, nombre);
  }
  cacheFestivos.set(anio, mapa);
  return mapa;
}

export const festivo = (d) => festivosDe(d.getFullYear()).get(clave(d)) || "";

// ---------- Puentes ----------
const libre = (d) => d.getDay() % 6 === 0 || !!festivo(d);   // sábado, domingo o festivo

// Próximo "puente": un festivo que, junto con el fin de semana, da 3 o más días libres seguidos.
// Devuelve { nombre, inicio (Date), dias } o null.
export function proximoPuente(desde, maxDias = 400) {
  for (let i = 1; i <= maxDias; i++) {
    const d = sumarDias(desde, i);
    if (!festivo(d) || d.getDay() % 6 === 0) continue;   // festivo en día laborable
    let inicio = d, fin = d;
    while (libre(sumarDias(inicio, -1))) inicio = sumarDias(inicio, -1);
    while (libre(sumarDias(fin, 1))) fin = sumarDias(fin, 1);
    const dias = diasEntre(inicio, fin) + 1;
    if (dias < 3 || clave(inicio) <= clave(desde)) {
      i += diasEntre(d, fin);   // salta este bloque
      continue;
    }
    // Nombre: el de Semana Santa si toca; si no, el del festivo
    const nombres = [];
    for (let x = inicio; clave(x) <= clave(fin); x = sumarDias(x, 1)) if (festivo(x)) nombres.push(festivo(x));
    const tiene = (t) => nombres.some((n) => n.startsWith(t));
    const nombre = tiene("Viernes Santo") ? "Semana Santa"
      : tiene("Día de la Constitución") && tiene("Inmaculada") ? "Puente de diciembre"
      : nombres[nombres.length - 1].replace(" (trasladado)", "");
    return { nombre, inicio, dias };
  }
  return null;
}
