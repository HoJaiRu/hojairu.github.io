// app.js - Une todas las piezas: barra de herramientas, vistas, panel del día,
// tarjeta "Hoy", menú y atajos de teclado.

import { CATEGORIAS } from "./config.js";
import { clave, hoy, desdeClave } from "./fechas.js";
import * as almacen from "./almacen.js";
import { vistaMes, vistaTres, vistaAnio, tituloVista, esc } from "./vistas.js";
import { iniciarPanel, abrirPanel, cerrarPanel, pintarPanel, fechaAbierta } from "./panel.js";
import { iniciarHoy, pintarHoy } from "./hoy.js";

const $ = (s) => document.querySelector(s);
const CLAVE_VISTA = "calendario.vista";

// Qué se está viendo ahora mismo
const ver = {
  vista: "mes",          // "mes" | "tres" | "anio"
  anio: hoy().getFullYear(),
  mes: hoy().getMonth(), // 0 = enero
};
try { ver.vista = localStorage.getItem(CLAVE_VISTA) || "mes"; } catch {}

// ---------- Pintar ----------
function pintar(direccion = 0) {
  const sel = fechaAbierta();
  const html = ver.vista === "mes" ? vistaMes(ver.anio, ver.mes, sel)
    : ver.vista === "tres" ? vistaTres(ver.anio, ver.mes, sel)
    : vistaAnio(ver.anio, sel);
  const cont = $("#vista");
  cont.innerHTML = html;
  cont.dataset.vista = ver.vista;
  $("#titulo").innerHTML = tituloVista(ver.vista, ver.anio, ver.mes);

  // Animación suave al cambiar de mes (entra desde el lado hacia el que vas)
  if (direccion) {
    cont.classList.remove("entra-der", "entra-izq");
    void cont.offsetWidth;   // reinicia la animación
    cont.classList.add(direccion > 0 ? "entra-der" : "entra-izq");
  }

  for (const b of document.querySelectorAll(".segmentos button")) {
    b.setAttribute("aria-selected", b.dataset.vista === ver.vista);
  }
  // El botón "Hoy" se apaga si ya estás viendo hoy
  const h = hoy();
  const enHoy = ver.anio === h.getFullYear() && (ver.vista === "anio" || ver.mes === h.getMonth());
  $("#btn-hoy").classList.toggle("apagado", enHoy);
}

function mover(paso) {
  if (ver.vista === "anio") ver.anio += paso;
  else {
    const d = new Date(ver.anio, ver.mes + paso, 1);
    ver.anio = d.getFullYear();
    ver.mes = d.getMonth();
  }
  pintar(paso);
}

function irAHoy() {
  const h = hoy();
  const antes = ver.anio * 12 + ver.mes, ahora = h.getFullYear() * 12 + h.getMonth();
  ver.anio = h.getFullYear();
  ver.mes = h.getMonth();
  pintar(Math.sign(ahora - antes));
}

function cambiarVista(v) {
  ver.vista = v;
  try { localStorage.setItem(CLAVE_VISTA, v); } catch {}
  pintar();
}

// Abre un día y, si no se está viendo, lleva el calendario hasta él
function abrirDia(k) {
  const d = desdeClave(k);
  if (ver.vista === "mes" && (d.getFullYear() !== ver.anio || d.getMonth() !== ver.mes)) {
    const dir = Math.sign((d.getFullYear() * 12 + d.getMonth()) - (ver.anio * 12 + ver.mes));
    ver.anio = d.getFullYear();
    ver.mes = d.getMonth();
    abrirPanel(k);
    pintar(dir);
    return;
  }
  abrirPanel(k);
  pintar();
}

function moverDia(n) {
  const d = desdeClave(fechaAbierta());
  d.setDate(d.getDate() + n);
  abrirDia(clave(d));
}

// ---------- Aviso abajo (con botón "Deshacer" opcional) ----------
let temporizadorAviso;
function avisar(texto, boton, accion) {
  const el = $("#aviso");
  el.innerHTML = `<span>${esc(texto)}</span>${boton ? `<button class="btn-texto">${esc(boton)}</button>` : ""}`;
  el.hidden = false;
  if (boton) el.querySelector("button").onclick = () => { accion(); el.hidden = true; };
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, boton ? 6000 : 3500);
}

// ---------- Estado de la sincronización ----------
function pintarSync() {
  const { modo, texto } = almacen.estado;
  const b = $("#sync");
  b.dataset.modo = modo;
  b.title = texto + (modo === "local" ? " · Pulsa para sincronizar con GitHub" : "");
  b.querySelector("span").textContent =
    { local: "Local", pendiente: "Guardando", ok: "Sincronizado", error: "Error" }[modo];
  const conectado = almacen.tieneLlave();
  $('[data-accion="conectar"]').hidden = conectado;
  $('[data-accion="sincronizar"]').hidden = !conectado;
  $('[data-accion="desconectar"]').hidden = !conectado;
  $('[data-accion="movil"]').hidden = !conectado;
  if (modo === "error") avisar(texto);
}

// ---------- Menú ⋯ ----------
function alternarMenu(abrir = $("#menu").hidden) {
  $("#menu").hidden = !abrir;
  $("#btn-menu").setAttribute("aria-expanded", abrir);
}

const acciones = {
  conectar: () => {
    $("#llave-error").hidden = true;
    $("#llave").value = "";
    $("#dlg-llave").showModal();
  },
  sincronizar: () => almacen.sincronizar(),
  desconectar: () => {
    almacen.desconectar();
    avisar("Desconectado. Tus notas siguen en este navegador y en GitHub.");
  },
  exportar: () => {
    const blob = new Blob([almacen.exportar()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `calendario-${clave(hoy())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importar: () => $("#archivo-importar").click(),
  // Código QR con un enlace que lleva la llave detrás de "#": esa parte nunca se envía a ningún servidor
  movil: async () => {
    const { default: qrcode } = await import("./lib/qrcode.mjs");
    const qr = qrcode(0, "M");
    qr.addData(`${location.origin}${location.pathname}#llave=${encodeURIComponent(almacen.llaveActual())}`);
    qr.make();
    $("#qr-movil").src = qr.createDataURL(6, 3);
    $("#dlg-movil").showModal();
  },
};

function pintarIconoTema() {
  $("#btn-tema").textContent = window.tema.actual() === "oscuro" ? "☀" : "☾";
}

// ---------- Arranque ----------
function iniciar() {
  almacen.iniciar();

  // Leyenda de colores (abajo)
  $("#leyenda").innerHTML = CATEGORIAS.map((c) =>
    `<span style="--c:${c.color}"><i></i>${esc(c.nombre)}</span>`).join("") +
    `<span class="leyenda-festivo"><i></i>Festivo</span><span class="leyenda-sin-clase"><i></i>Sin clase</span>`;

  iniciarPanel({ alCerrar: () => pintar(), avisar, irADia: abrirDia });
  iniciarHoy(abrirDia);

  almacen.alCambiar((que) => {
    if (que === "estado") return pintarSync();
    pintar();
    pintarPanel();
    pintarHoy();
  });
  pintarSync();
  pintarIconoTema();

  // Barra de herramientas
  $("#btn-hoy").addEventListener("click", irAHoy);
  $("#btn-anterior").addEventListener("click", () => mover(-1));
  $("#btn-siguiente").addEventListener("click", () => mover(1));
  for (const b of document.querySelectorAll(".segmentos button")) {
    b.addEventListener("click", () => cambiarVista(b.dataset.vista));
  }
  $("#btn-tema").addEventListener("click", () => { window.tema.cambiar(); pintarIconoTema(); });
  $("#sync").addEventListener("click", () => (almacen.tieneLlave() ? almacen.sincronizar() : acciones.conectar()));

  // Menú
  $("#btn-menu").addEventListener("click", (e) => { e.stopPropagation(); alternarMenu(); });
  $("#menu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accion]");
    if (!b) return;
    alternarMenu(false);
    acciones[b.dataset.accion]();
  });
  document.addEventListener("click", (e) => {
    if (!$("#menu").hidden && !e.target.closest(".menu-envoltura")) alternarMenu(false);
  });

  // Importar copia
  $("#archivo-importar").addEventListener("change", async (e) => {
    const archivo = e.target.files[0];
    e.target.value = "";
    if (!archivo) return;
    try {
      const n = almacen.importar(await archivo.text());
      avisar(`Copia cargada: ${n} notas`);
    } catch (err) {
      avisar("No se pudo cargar: " + err.message);
    }
  });

  // Conectar con GitHub
  $("#btn-cancelar-llave").addEventListener("click", () => $("#dlg-llave").close());
  $("#form-llave").addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = $("#btn-conectar");
    boton.disabled = true;
    boton.textContent = "Comprobando…";
    try {
      await almacen.conectar($("#llave").value);
      $("#dlg-llave").close();
      avisar("Conectado: tus notas se guardan en GitHub");
    } catch (err) {
      $("#llave-error").textContent = err.message;
      $("#llave-error").hidden = false;
    } finally {
      boton.disabled = false;
      boton.textContent = "Conectar";
    }
  });

  // Clics en el calendario
  $("#vista").addEventListener("click", (e) => {
    const irMes = e.target.closest("[data-ir-mes]");
    if (irMes) {
      const [a, m] = irMes.dataset.irMes.split("-").map(Number);
      ver.anio = a;
      ver.mes = m;
      return cambiarVista("mes");
    }
    const dia = e.target.closest("[data-fecha]");
    if (dia) abrirDia(dia.dataset.fecha);
  });

  // Deslizar el dedo en el móvil para cambiar de mes
  let x0 = null, y0 = null;
  $("#vista").addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  $("#vista").addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) mover(dx < 0 ? 1 : -1);
    x0 = null;
  });

  // Atajos de teclado
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if ($("#dlg-llave").open || $("#dlg-movil").open) return;
      if (!$("#menu").hidden) return alternarMenu(false);
      return cerrarPanel();
    }
    // Mientras escribes, las teclas son para el texto (salvo las flechas con el cuadro vacío)
    const escribiendo = e.target.closest("input, textarea, select, dialog");
    const cuadroVacio = e.target.id === "nota-texto" && !e.target.value && e.key.startsWith("Arrow");
    if ((escribiendo && !cuadroVacio) || e.ctrlKey || e.metaKey || e.altKey) return;
    const accion = {
      // Con la ventana de un día abierta, las flechas pasan de día; si no, de mes
      ArrowLeft: () => (fechaAbierta() ? moverDia(-1) : mover(-1)),
      ArrowRight: () => (fechaAbierta() ? moverDia(1) : mover(1)),
      t: irAHoy, T: irAHoy,
      1: () => cambiarVista("mes"),
      2: () => cambiarVista("tres"),
      3: () => cambiarVista("anio"),
      n: () => abrirDia(clave(hoy())), N: () => abrirDia(clave(hoy())),
    }[e.key];
    if (accion) { e.preventDefault(); accion(); }
  });

  // Si la web se queda abierta de un día para otro, refresca "Hoy" a medianoche
  let ultimoDia = clave(hoy());
  setInterval(() => {
    if (clave(hoy()) !== ultimoDia) { ultimoDia = clave(hoy()); pintar(); pintarHoy(); }
  }, 60000);

  pintar();
  conectarDesdeEnlace();
}

// Si se abre con el enlace del código QR (…/calendario/#llave=…), se conecta solo
async function conectarDesdeEnlace() {
  const m = location.hash.match(/^#llave=(.+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname);   // borra la llave de la barra de direcciones
  try {
    await almacen.conectar(decodeURIComponent(m[1]));
    avisar("Conectado: ya ves tus notas en este dispositivo");
  } catch (err) {
    avisar("No se pudo conectar: " + err.message);
  }
}

iniciar();
