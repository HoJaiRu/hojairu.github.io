// hoy.js - La tarjeta "Hoy" de arriba: el resumen matinal.
// Saludo, lo que tienes hoy, los próximos eventos y la cuenta atrás (puentes, vacaciones y cumpleaños cercanos).

import { CONFIG, CURSO } from "./config.js";
import { clave, hoy, sumarDias, diasEntre, fechaLarga, diaLibre, desdeClave, proximoPuente, marcaCurso } from "./fechas.js";
import { notasDe } from "./almacen.js";
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
  const futuras = [];
  for (let i = 1; i <= 366; i++) {
    for (const n of notasDe(clave(sumarDias(d0, i)))) if (!n.hecha) futuras.push(n);
  }
  futuras.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora || "99").localeCompare(b.hora || "99"));
  const faltan = (n) => diasEntre(d0, desdeClave(n.fecha));

  $("#hoy-saludo").textContent = saludo();
  $("#hoy-fecha").textContent = fechaLarga(d0);
  $("#hoy-lista").innerHTML = lista(notasHoy, diaLibre(d0) || marcaCurso(d0), "Nada anotado");

  $("#proximos-lista").innerHTML = futuras.slice(0, 3).map((n) => itemCuenta(n, faltan(n))).join("")
    || `<li class="tenue vacio">No hay nada anotado más adelante</li>`;

  // Cuenta atrás: los próximos puentes y vacaciones, y los cumpleaños de los próximos 10 días
  const cuenta = [];
  for (const n of futuras) {
    if (n.cat === "cumple" && faltan(n) <= CONFIG.diasCumpleCuentaAtras) cuenta.push({ dias: faltan(n), html: itemCuenta(n, faltan(n)) });
  }
  for (const p of proximosDescansos(d0, 3)) {
    cuenta.push({ dias: p.faltan, html: `<li class="festivo-item"><span>${esc(p.nombre)}${p.dias ? ` · ${p.dias} días libres` : ""}</span><b>${enDias(p.faltan)}</b></li>` });
  }
  cuenta.sort((a, b) => a.dias - b.dias);
  $("#cuenta-lista").innerHTML = cuenta.map((c) => c.html).join("") || `<li class="tenue vacio">No hay puentes a la vista</li>`;

  // Resumen de una línea, para cuando la tarjeta está plegada
  const pendientes = notasHoy.filter((n) => !n.hecha).length;
  let corto = pendientes ? `${pendientes} cosa${pendientes > 1 ? "s" : ""} hoy` : "Nada pendiente hoy";
  if (futuras[0]) corto += ` · ${futuras[0].texto.slice(0, 40)} ${enDias(faltan(futuras[0]))}`;
  $("#hoy-corto").textContent = corto;

  return tarjeta;
}

// Los próximos "cuantos" puentes o vacaciones, incluidas las de verano (al acabar el curso)
function proximosDescansos(d0, cuantos) {
  const lista = [];
  let desde = d0;
  for (let i = 0; i < cuantos; i++) {
    const p = proximoPuente(desde);
    if (!p) break;
    lista.push({ nombre: p.nombre, dias: p.dias, faltan: diasEntre(d0, p.inicio) });
    desde = sumarDias(p.inicio, p.dias - 1);
  }
  if (CURSO && CURSO.fin >= clave(d0)) {
    const verano = sumarDias(desdeClave(CURSO.fin), 1);
    lista.push({ nombre: "Vacaciones de verano", dias: 0, faltan: diasEntre(d0, verano) });
  }
  return lista.sort((a, b) => a.faltan - b.faltan).slice(0, cuantos);
}

function itemCuenta(n, dias) {
  return `<li><button class="mini-nota cuenta" data-fecha="${n.fecha}" style="--c:${colorDe(n.cat)}">` +
    `<i></i><span>${n.cat === "cumple" ? "🎂 " : ""}${esc(n.texto)}</span><b>${enDias(dias)}</b></button></li>`;
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
