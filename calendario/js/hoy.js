// hoy.js - La tarjeta "Hoy" de arriba: el resumen matinal.
// Saludo, lo que tienes hoy y mañana, y la cuenta atrás de lo destacado y del próximo festivo.

import { CONFIG } from "./config.js";
import { clave, hoy, sumarDias, diasEntre, fechaLarga, festivo, desdeClave, proximoPuente } from "./fechas.js";
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
  const d0 = hoy(), kHoy = clave(d0);
  const notasHoy = notasDe(kHoy);

  // Próximos: las 3 notas pendientes más cercanas (después de hoy)
  // Cuenta atrás: las notas destacadas de los próximos días
  const futuras = [], destacadas = [];
  const limite = clave(sumarDias(d0, CONFIG.diasCuentaAtras));
  for (const [k, notas] of diasConNotas()) {
    if (k <= kHoy) continue;
    for (const n of notas) {
      if (n.hecha) continue;
      futuras.push(n);
      if (n.destacada && k <= limite) destacadas.push(n);
    }
  }
  const porFecha = (a, b) => a.fecha.localeCompare(b.fecha) || (a.hora || "99").localeCompare(b.hora || "99");
  futuras.sort(porFecha);
  destacadas.sort(porFecha);
  const faltan = (n) => diasEntre(d0, desdeClave(n.fecha));

  $("#hoy-saludo").textContent = saludo();
  $("#hoy-fecha").textContent = fechaLarga(d0);
  $("#hoy-lista").innerHTML = lista(notasHoy, festivo(d0), "Nada anotado");

  $("#proximos-lista").innerHTML = futuras.slice(0, 3).map((n) => itemCuenta(n, faltan(n))).join("")
    || `<li class="tenue vacio">No hay nada anotado más adelante</li>`;

  let cuenta = destacadas.slice(0, 4).map((n) => itemCuenta(n, faltan(n))).join("");
  const puente = proximoPuente(d0);
  if (puente) {
    cuenta += `<li class="festivo-item"><span>${esc(puente.nombre)} · ${puente.dias} días libres</span>` +
      `<b>${enDias(diasEntre(d0, puente.inicio))}</b></li>`;
  }
  $("#cuenta-lista").innerHTML = cuenta || `<li class="tenue vacio">Destaca una nota (★) para verla aquí</li>`;

  // Resumen de una línea, para cuando la tarjeta está plegada
  const pendientes = notasHoy.filter((n) => !n.hecha).length;
  let corto = pendientes ? `${pendientes} cosa${pendientes > 1 ? "s" : ""} hoy` : "Nada pendiente hoy";
  if (futuras[0]) corto += ` · ${futuras[0].texto.slice(0, 40)} ${enDias(faltan(futuras[0]))}`;
  $("#hoy-corto").textContent = corto;

  return tarjeta;
}

function itemCuenta(n, dias) {
  return `<li><button class="mini-nota cuenta" data-fecha="${n.fecha}" style="--c:${colorDe(n.cat)}">` +
    `<i></i><span>${esc(n.texto)}</span><b>${enDias(dias)}</b></button></li>`;
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
