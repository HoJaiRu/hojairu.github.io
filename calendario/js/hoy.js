// hoy.js - La tarjeta "Hoy" de arriba: el resumen matinal.
// Saludo, lo que tienes hoy y mañana, y la cuenta atrás de lo destacado y del próximo festivo.

import { CONFIG } from "./config.js";
import { clave, hoy, sumarDias, diasEntre, fechaLarga, festivo, desdeClave } from "./fechas.js";
import { notasDe, diasConNotas } from "./almacen.js";
import { esc, colorDe } from "./vistas.js";

const $ = (s) => document.querySelector(s);
const CLAVE_ABIERTA = "calendario.hoyAbierta";

function saludo() {
  const h = new Date().getHours();
  const base = h < 6 ? "Buenas noches" : h < 13 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
  return CONFIG.nombre ? `${base}, ${CONFIG.nombre}` : base;
}

function enDias(n) {
  if (n === 0) return "hoy";
  if (n === 1) return "mañana";
  return `en ${n} días`;
}

function itemNota(n) {
  return `<li><button class="mini-nota${n.hecha ? " hecha" : ""}" data-fecha="${n.fecha}" style="--c:${colorDe(n.cat)}">` +
    `<i></i>${n.hora ? `<em>${esc(n.hora)}</em>` : ""}<span>${esc(n.texto)}</span></button></li>`;
}

function lista(notas, fest, vacio) {
  let html = fest ? `<li class="festivo-item"><span>${esc(fest)}</span></li>` : "";
  html += notas.map(itemNota).join("");
  return html || `<li class="tenue vacio">${vacio}</li>`;
}

export function pintarHoy() {
  const tarjeta = $("#tarjeta-hoy");
  const d0 = hoy(), d1 = sumarDias(d0, 1);
  const notasHoy = notasDe(clave(d0));
  const notasManana = notasDe(clave(d1));

  // Cuenta atrás: notas destacadas de los próximos días + el próximo festivo
  const proximas = [];
  const limite = clave(sumarDias(d0, CONFIG.diasCuentaAtras));
  for (const [k, notas] of diasConNotas()) {
    if (k <= clave(d0) || k > limite) continue;
    for (const n of notas) if (n.destacada && !n.hecha) proximas.push(n);
  }
  proximas.sort((a, b) => a.fecha.localeCompare(b.fecha));

  let proxFestivo = null;
  for (let i = 1; i <= 366 && !proxFestivo; i++) {
    const d = sumarDias(d0, i);
    if (festivo(d)) proxFestivo = { nombre: festivo(d), dias: i };
  }

  $("#hoy-saludo").textContent = saludo();
  $("#hoy-fecha").textContent = fechaLarga(d0);
  $("#hoy-lista").innerHTML = lista(notasHoy, festivo(d0), "Nada anotado");
  $("#manana-lista").innerHTML = lista(notasManana, festivo(d1), "Nada anotado");

  let cuenta = proximas.slice(0, 5).map((n) => {
    const dias = diasEntre(d0, desdeClave(n.fecha));
    return `<li><button class="mini-nota cuenta" data-fecha="${n.fecha}" style="--c:${colorDe(n.cat)}">` +
      `<i></i><span>${esc(n.texto)}</span><b>${enDias(dias)}</b></button></li>`;
  }).join("");
  if (proxFestivo) {
    cuenta += `<li class="festivo-item"><span>${esc(proxFestivo.nombre)}</span><b>${enDias(proxFestivo.dias)}</b></li>`;
  }
  $("#cuenta-lista").innerHTML = cuenta || `<li class="tenue vacio">Destaca una nota (★) para verla aquí</li>`;

  // Resumen de una línea, para cuando la tarjeta está plegada
  const pendientes = notasHoy.filter((n) => !n.hecha).length;
  let corto = pendientes ? `${pendientes} cosa${pendientes > 1 ? "s" : ""} hoy` : "Nada pendiente hoy";
  if (proximas[0]) corto += ` · ${proximas[0].texto.slice(0, 40)} ${enDias(diasEntre(d0, desdeClave(proximas[0].fecha)))}`;
  $("#hoy-corto").textContent = corto;

  return tarjeta;
}

export function iniciarHoy(alPulsarFecha) {
  const tarjeta = $("#tarjeta-hoy");
  let abierta = true;
  try { abierta = localStorage.getItem(CLAVE_ABIERTA) !== "no"; } catch {}
  tarjeta.open = abierta;
  tarjeta.addEventListener("toggle", () => {
    try { localStorage.setItem(CLAVE_ABIERTA, tarjeta.open ? "si" : "no"); } catch {}
  });
  tarjeta.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fecha]");
    if (b) alPulsarFecha(b.dataset.fecha);
  });
  pintarHoy();
}
