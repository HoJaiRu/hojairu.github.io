// vistas.js - Dibuja el calendario: Mes, 3 meses y Año.
// Solo genera el HTML; los clics los gestiona app.js.

import { CATEGORIAS } from "./config.js";
import { MESES, DIAS_CORTOS, clave, hoy, casillasDelMes, sumarDias, festivo, noLectivo, diaLibre, marcaCurso } from "./fechas.js";
import { notasDe } from "./almacen.js";

const colorDe = (catId) => (CATEGORIAS.find((c) => c.id === catId) || CATEGORIAS.at(-1)).color;

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Color con el que se "tiñe" un día. Las notas mandan sobre festivos y vacaciones:
//  - "tenido": tiene un cumpleaños o una nota destacada (color fuerte)
//  - "tenido-suave": es festivo o sin clase pero tiene alguna nota (color de la nota, suave)
function tinteDelDia(notas, d) {
  const fuerte = notas.find((n) => n.destacada || n.cat === "cumple");
  if (fuerte) return { color: colorDe(fuerte.cat), clase: " tenido" };
  if (notas.length && diaLibre(d)) return { color: colorDe(notas[0].cat), clase: " tenido-suave" };
  return { color: "", clase: "" };
}

function clasesDia(d, mes, seleccion) {
  const k = clave(d);
  return [
    "dia",
    d.getMonth() !== mes && "fuera",
    k === clave(hoy()) && "hoy",
    d.getDay() % 6 === 0 && "finde",
    festivo(d) ? "festivo" : noLectivo(d) && "sin-clase",
    marcaCurso(d) && "marca-curso",
    k === seleccion && "elegido",
  ].filter(Boolean).join(" ");
}

function cabeceraDias() {
  return `<div class="cab-dias">${DIAS_CORTOS.map((l) => `<span>${l}</span>`).join("")}</div>`;
}

function puntos(notas, max) {
  const vistos = notas.slice(0, max).map((n) =>
    `<i style="--c:${colorDe(n.cat)}"${n.hecha ? ' class="hecha"' : ""}></i>`).join("");
  const resto = notas.length > max ? `<b>+${notas.length - max}</b>` : "";
  return `<span class="puntos">${vistos}${resto}</span>`;
}

// ---------- MES (vista principal) ----------
export function vistaMes(anio, mes, seleccion) {
  const casillas = casillasDelMes(anio, mes).map((d) => {
    const k = clave(d);
    const notas = notasDe(k);
    // Etiqueta del día: festivo, inicio/fin de clases, o el nombre de las vacaciones
    // (este solo el primer día del periodo y cada lunes, para no repetirlo en todas las casillas)
    const nl = noLectivo(d);
    const fest = festivo(d) || marcaCurso(d) ||
      (nl && (nl !== noLectivo(sumarDias(d, -1)) || d.getDay() === 1 || d.getDate() === 1) ? nl : "");
    const tinte = tinteDelDia(notas, d);
    const chips = notas.slice(0, 3).map((n) =>
      `<span class="chip${n.hecha ? " hecha" : ""}" style="--c:${colorDe(n.cat)}">` +
      `${n.cat === "cumple" ? "🎂 " : ""}${n.hora ? `<em>${esc(n.hora)}</em> ` : ""}${esc(n.texto)}</span>`).join("");
    const mas = notas.length > 3 ? `<span class="chip-mas">+${notas.length - 3} más</span>` : "";
    const etiqueta = `${d.getDate()} de ${MESES[d.getMonth()]}${fest ? ", " + fest : ""}` +
      (notas.length ? `, ${notas.length} nota${notas.length > 1 ? "s" : ""}` : "");
    return `<button class="${clasesDia(d, mes, seleccion)}${tinte.clase}" data-fecha="${k}"` +
      `${tinte.color ? ` style="--tinte:${tinte.color}"` : ""} aria-label="${esc(etiqueta)}">` +
      `<span class="num">${d.getDate()}</span>` +
      (fest ? `<span class="nombre-festivo" title="${esc(fest)}">${esc(fest)}</span>` : "") +
      `<span class="chips">${chips}${mas}</span>` +
      (notas.length ? puntos(notas, 4) : "") +
      `</button>`;
  }).join("");
  return `<div class="mes">${cabeceraDias()}<div class="rejilla">${casillas}</div></div>`;
}

// ---------- Mes pequeño (para 3 meses y Año) ----------
function miniMes(anio, mes, seleccion, modo) {
  const casillas = casillasDelMes(anio, mes).map((d) => {
    if (d.getMonth() !== mes) return `<span class="mini-hueco"></span>`;
    const k = clave(d);
    const notas = notasDe(k);
    let extra = "";
    if (modo === "calor") {
      // Vista año: cuantas más notas, más intenso el color (mapa de calor)
      const nivel = Math.min(notas.length, 4);
      extra = nivel ? ` data-calor="${nivel}"` : "";
    }
    const tinte = tinteDelDia(notas, d);
    return `<button class="${clasesDia(d, mes, seleccion)} mini-dia${tinte.clase}" data-fecha="${k}"${extra}` +
      `${tinte.color ? ` style="--tinte:${tinte.color}"` : ""} title="${esc(diaLibre(d) || marcaCurso(d))}" aria-label="${d.getDate()} de ${MESES[mes]}">` +
      `<span class="num">${d.getDate()}</span>` +
      (modo === "puntos" && notas.length ? puntos(notas, 3) : "") +
      `</button>`;
  }).join("");
  return `<div class="mini-mes">` +
    `<button class="mini-titulo" data-ir-mes="${anio}-${mes}">${MESES[mes]}${modo === "puntos" ? ` <span class="tenue">${anio}</span>` : ""}</button>` +
    `${cabeceraDias()}<div class="mini-rejilla">${casillas}</div></div>`;
}

// ---------- 3 MESES ----------
export function vistaTres(anio, mes, seleccion) {
  let html = "";
  for (let i = 0; i < 3; i++) {
    const d = new Date(anio, mes + i, 1);
    html += miniMes(d.getFullYear(), d.getMonth(), seleccion, "puntos");
  }
  return `<div class="tres">${html}</div>`;
}

// ---------- AÑO (mapa de calor) ----------
export function vistaAnio(anio, seleccion) {
  let html = "";
  for (let m = 0; m < 12; m++) html += miniMes(anio, m, seleccion, "calor");
  return `<div class="anio">${html}</div>`;
}

export function tituloVista(vista, anio, mes) {
  if (vista === "anio") return `${anio}`;
  if (vista === "tres") {
    const fin = new Date(anio, mes + 2, 1);
    const finTexto = `${MESES[fin.getMonth()]} ${fin.getFullYear()}`;
    return fin.getFullYear() === anio
      ? `${MESES[mes]} – ${finTexto}`
      : `${MESES[mes]} ${anio} – ${finTexto}`;
  }
  return `${MESES[mes]} <span>${anio}</span>`;
}

export { colorDe };
