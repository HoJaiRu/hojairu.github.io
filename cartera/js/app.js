// app.js - Une todas las piezas: resumen, gráfico, posiciones, desplegables,
// ventana de operación, menú y atajos de teclado.

import { TIPOS, COLORES } from "./config.js";
import * as almacen from "./almacen.js";
import * as cot from "./cotizaciones.js";
import * as calc from "./calculos.js";
import * as g from "./graficos.js";
import * as f from "./formato.js";
import { tieneLlave } from "./github.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const hoyISO = () => new Date().toISOString().slice(0, 10);

// Preferencias de esta pantalla (se recuerdan en este navegador)
const pref = { rango: "365", reparto: "tipo" };
try { Object.assign(pref, JSON.parse(localStorage.getItem("cartera.pref"))); } catch {}
const guardarPref = () => { try { localStorage.setItem("cartera.pref", JSON.stringify(pref)); } catch {} };

const abiertos = new Set();     // posiciones desplegadas
let ultimo = null;              // último resumen calculado
let valorAnterior = null;
let tickerNuevoPendiente = false;   // al guardar un valor nuevo, pedir su precio al robot

// ---------- Pintar todo ----------
function pintar() {
  const vacia = almacen.vacia();
  $("#bienvenida").hidden = !vacia;
  $("#contenido").hidden = vacia;
  $("#btn-nueva").hidden = vacia;
  $("#btn-bienvenida-conectar").hidden = tieneLlave();
  if (vacia) return;

  ultimo = calc.cartera();
  pintarResumen(ultimo);
  pintarGrafico();
  pintarPosiciones(ultimo);
  pintarReparto(ultimo);
  pintarResultados(ultimo);
  pintarOperaciones();
  pintarEstadoPrecios();
}

function pintarResumen(c) {
  const valor = $("#valor");
  valor.textContent = f.euros(c.valor);
  // Destello suave cuando el valor cambia (precio nuevo)
  if (valorAnterior != null && Math.abs(c.valor - valorAnterior) > 0.005) {
    valor.classList.remove("destello-sube", "destello-baja");
    void valor.offsetWidth;
    valor.classList.add(c.valor > valorAnterior ? "destello-sube" : "destello-baja");
  }
  valorAnterior = c.valor;
  const gan = $("#ganancia"), hoy = $("#hoy");
  gan.className = f.clase(c.ganancia);
  gan.textContent = `${f.eurosSigno(c.ganancia)} · ${f.pct(c.gananciaPct)}`;
  hoy.className = f.clase(c.hoy);
  hoy.textContent = `${f.eurosSigno(c.hoy)} · ${f.pct(c.hoyPct)}`;
}

function pintarEstadoPrecios() {
  const partes = [];
  if (cot.estado.actualizando) partes.push("Actualizando precios…");
  else if (!tieneLlave()) partes.push("Conecta GitHub para tener precios automáticos");
  else partes.push(`Precios ${f.haceCuanto(cot.actualizado())}`);
  if (cot.hayVivo()) partes.push(`<span class="en-vivo"><i></i>cripto en directo</span>`);
  if (ultimo?.sinPrecio) partes.push(`${ultimo.sinPrecio} sin precio`);
  $("#precios-estado").innerHTML = partes.join(" · ");
  const b = $("#btn-actualizar");
  b.hidden = !tieneLlave();
  b.classList.toggle("girando", cot.estado.actualizando);
}

// ---------- Gráfico ----------
function pintarGrafico() {
  let serie = calc.evolucion();
  const dias = +pref.rango;
  if (dias) {
    const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
    const recorte = serie.filter((p) => p.dia >= desde);
    if (recorte.length >= 2) serie = recorte;
  }
  g.lineas($("#grafico"), serie);
  for (const b of $$("#rangos button")) b.setAttribute("aria-selected", b.dataset.rango === pref.rango);
}

// ---------- Posiciones ----------
function iniciales(t) { return t.replace(/[-.].*$/, "").slice(0, 4); }

function pintarPosiciones(c) {
  $("#num-posiciones").textContent = c.abiertas.length;
  $("#posiciones").innerHTML = c.abiertas.map((p) => {
    const tipo = TIPOS[p.activo.tipo] || TIPOS.otro;
    const abierto = abiertos.has(p.ticker);
    return `<li class="posicion${abierto ? " abierta" : ""}" data-ticker="${f.esc(p.ticker)}">
      <button class="pos-fila" aria-expanded="${abierto}">
        <span class="pos-icono" style="--c:${tipo.color}">${f.esc(iniciales(p.ticker))}</span>
        <span class="pos-nombre"><b>${f.esc(p.nombre)}</b><small>${f.esc(p.ticker)} · ${f.num(p.cantidad)}</small></span>
        <span class="pos-mini">${g.mini(cot.historico(p.ticker))}</span>
        <span class="pos-hoy ${f.clase(p.hoyPct)}" title="Hoy">${p.hoyPct == null ? "" : f.pct(p.hoyPct)}</span>
        <span class="pos-valor"><b>${p.valor == null ? `<span class="tenue">${p.error ? "⚠ " : ""}sin precio</span>` : f.euros(p.valor)}</b>
          <small class="${f.clase(p.ganancia)}">${p.gananciaPct == null ? "" : f.pct(p.gananciaPct)}</small></span>
      </button>
      ${abierto ? detallePosicion(p) : ""}
    </li>`;
  }).join("") + (c.cerradas.length ? `<li class="cerradas tenue">${c.cerradas.length} vendida${c.cerradas.length > 1 ? "s" : ""} del todo: ${c.cerradas.map((p) => f.esc(p.ticker)).join(", ")}</li>` : "");
}

function detallePosicion(p) {
  const c = p.cotizacion, div = c?.divisa || calc.divisaDe(p.ticker);
  const fuente = !c ? "" : c.fuente === "vivo" ? "En directo (Binance)" : c.fuente === "manual" ? `Precio a mano · ${f.fecha(c.hora.slice(0, 10))}` : `Robot · ${f.haceCuanto(c.hora)}`;
  const dato = (etq, val, cls = "") => `<div><small>${etq}</small><b class="${cls}">${val}</b></div>`;
  return `<div class="pos-detalle">
    <div class="datos">
      ${dato("Precio actual", f.precio(c?.precio, div))}
      ${dato("Precio medio", f.euros(p.precioMedio))}
      ${dato("Invertido", f.euros(p.coste))}
      ${dato("Valor", f.euros(p.valor))}
      ${dato("Ganancia", f.eurosSigno(p.ganancia), f.clase(p.ganancia))}
      ${dato("Hoy", f.eurosSigno(p.hoy), f.clase(p.hoy))}
      ${dato("Peso", f.pctSimple(p.peso || 0))}
      ${p.dividendos ? dato("Dividendos", f.euros(p.dividendos)) : ""}
    </div>
    <p class="pos-fuente tenue">${fuente}${p.error ? `<span class="error"> · El robot no encuentra este valor (${f.esc(p.error)})</span>` : ""}</p>
    <div class="fila">
      <button class="btn" data-accion="nueva" data-ticker="${f.esc(p.ticker)}">+ Operación</button>
      <button class="btn-texto" data-accion="manual" data-ticker="${f.esc(p.ticker)}">Precio a mano</button>
    </div>
  </div>`;
}

// ---------- Reparto ----------
function pintarReparto(c) {
  let partes;
  if (pref.reparto === "tipo") {
    const suma = {};
    for (const p of c.abiertas) suma[p.activo.tipo || "otro"] = (suma[p.activo.tipo || "otro"] || 0) + (p.valor ?? p.coste);
    partes = Object.entries(suma).sort((a, b) => b[1] - a[1])
      .map(([t, v]) => ({ nombre: (TIPOS[t] || TIPOS.otro).nombre, valor: v, color: (TIPOS[t] || TIPOS.otro).color }));
  } else {
    // Los 7 más grandes con su color; el resto junto en "Otros"
    const orden = c.abiertas.map((p) => ({ nombre: p.nombre, valor: p.valor ?? p.coste }));
    partes = orden.slice(0, 7).map((p, i) => ({ ...p, color: COLORES[i] }));
    const resto = orden.slice(7).reduce((s, p) => s + p.valor, 0);
    if (resto) partes.push({ nombre: "Otros", valor: resto, color: COLORES[7] });
  }
  g.quesito($("#quesito"), partes);
  for (const b of $$("#modo-reparto button")) b.setAttribute("aria-selected", b.dataset.modo === pref.reparto);
}

// ---------- Resultados por año ----------
function pintarResultados(c) {
  const anios = Object.entries(c.porAnio).filter(([, r]) => r.realizado || r.dividendos).sort((a, b) => b[0] - a[0]);
  $("#tabla-resultados").innerHTML = anios.length
    ? `<thead><tr><th>Año</th><th>Ventas</th><th>Dividendos</th><th>Total</th></tr></thead><tbody>${anios.map(([a, r]) =>
      `<tr><td>${a}</td><td class="${f.clase(r.realizado)}">${f.eurosSigno(r.realizado)}</td><td>${f.euros(r.dividendos)}</td>
       <td class="${f.clase(r.realizado + r.dividendos)}"><b>${f.eurosSigno(r.realizado + r.dividendos)}</b></td></tr>`).join("")}</tbody>`
    : `<tbody><tr><td class="tenue">Aún no has vendido nada ni cobrado dividendos.</td></tr></tbody>`;
}

// ---------- Lista de operaciones ----------
const NOMBRE_OP = { compra: "Compra", venta: "Venta", dividendo: "Dividendo" };
function pintarOperaciones() {
  const ops = almacen.operaciones().reverse();
  $("#num-operaciones").textContent = ops.length;
  $("#operaciones").innerHTML = ops.map((o) => {
    const detalle = o.tipo === "dividendo" ? f.euros(o.importe)
      : `${f.num(o.cantidad)} × ${f.precio(o.precio, o.divisa)}`;
    return `<li><button class="op" data-id="${o.id}">
      <span class="op-tipo ${o.tipo}">${NOMBRE_OP[o.tipo]}</span>
      <span class="op-centro"><b>${f.esc(o.ticker)}</b><small>${detalle}</small></span>
      <span class="op-fecha tenue">${f.fecha(o.fecha)}</span>
    </button></li>`;
  }).join("");
}

// ---------- Aviso abajo ----------
let temporizadorAviso;
function avisar(texto) {
  const el = $("#aviso");
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- Estado de la sincronización ----------
function pintarSync() {
  const { modo, texto } = almacen.estado;
  const b = $("#sync");
  b.dataset.modo = modo;
  b.title = texto + (modo === "local" ? " · Pulsa para sincronizar con GitHub" : "");
  b.querySelector("span").textContent = { local: "Local", pendiente: "Guardando", ok: "Sincronizado", error: "Error" }[modo];
  const conectado = tieneLlave();
  $('#menu [data-accion="conectar"]').hidden = conectado;
  $('#menu [data-accion="actualizar"]').hidden = !conectado;
  $('#menu [data-accion="desconectar"]').hidden = !conectado;
  if (modo === "error") avisar(texto);
}

const OJO = `<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const OJO_CERRADO = `<svg class="icono" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;
function pintarOjo() {
  const oculto = f.estaOculto();
  const b = $("#btn-ojo");
  b.innerHTML = oculto ? OJO_CERRADO : OJO;
  b.setAttribute("aria-pressed", oculto);
  b.title = oculto ? "Mostrar importes (H)" : "Ocultar importes (H)";
  document.body.classList.toggle("oculto", oculto);
}
const pintarTema = () => { $("#btn-tema").textContent = window.tema.actual() === "oscuro" ? "☀" : "☾"; };

// ---------- Ventana de operación ----------
const dlgOp = $("#dlg-op");
let editando = null;   // id de la operación que se edita (o null si es nueva)
let tipoOp = "compra";

function abrirOp({ id, ticker, tipo } = {}) {
  const op = id ? almacen.operaciones().find((o) => o.id === id) : null;
  editando = op ? op.id : null;
  $("#op-titulo").textContent = op ? "Editar operación" : "Nueva operación";
  $("#btn-borrar-op").hidden = !op;
  $("#op-error").hidden = true;
  $("#lista-tickers").innerHTML = almacen.activos().map((a) => `<option value="${f.esc(a.ticker)}">${f.esc(a.nombre || "")}</option>`).join("");
  $("#op-ticker").value = op?.ticker || ticker || "";
  $("#op-fecha").value = op?.fecha || hoyISO();
  $("#op-cantidad").value = op?.cantidad ?? "";
  $("#op-precio").value = op?.precio ?? "";
  $("#op-comision").value = op?.comision || "";
  $("#op-importe").value = op?.importe ?? "";
  $("#op-nombre").value = "";
  ponerTipoOp(op?.tipo || tipo || "compra");
  alCambiarTicker(op?.divisa);
  dlgOp.showModal();
  if (!$("#op-ticker").value) $("#op-ticker").focus();
  else $(tipoOp === "dividendo" ? "#op-importe" : "#op-cantidad").focus();
}

function ponerTipoOp(t) {
  tipoOp = t;
  for (const b of $$("#op-tipo button")) b.setAttribute("aria-checked", b.dataset.tipo === t);
  $("#op-compraventa").hidden = t === "dividendo";
  $("#op-dividendo").hidden = t !== "dividendo";
  $("#op-cantidad").required = $("#op-precio").required = t !== "dividendo";
  $("#op-importe").required = t === "dividendo";
  calcularTotal();
}

function alCambiarTicker(divisaFija) {
  const t = $("#op-ticker").value.trim().toUpperCase();
  const existe = !!almacen.activo(t);
  $("#op-nuevo").hidden = existe || !t;
  if (!existe && /-(EUR|USD)$/.test(t)) $("#op-clase").value = "cripto";
  $("#op-divisa").value = divisaFija || (t ? calc.divisaDe(t) : "EUR");
  calcularTotal();
}

function calcularTotal() {
  const cant = +$("#op-cantidad").value, precio = +$("#op-precio").value, com = +$("#op-comision").value || 0;
  const div = $("#op-divisa").value;
  let txt = "";
  if (tipoOp !== "dividendo" && cant && precio) {
    const bruto = cant * precio;
    const fx = cot.aEuros(div);
    const enEuros = fx != null ? bruto * fx : null;
    txt = `Total: ${div === "EUR" ? f.precio(bruto, "EUR") : `${f.precio(bruto, div)}${enEuros != null ? ` ≈ ${f.precio(enEuros, "EUR")}` : ""}`}`;
    if (com) txt += ` ${tipoOp === "compra" ? "+" : "−"} ${f.precio(com, "EUR")} de comisión`;
  }
  $("#op-total").textContent = txt;
}

function guardarOp(ev) {
  ev.preventDefault();
  let ticker = $("#op-ticker").value.trim().toUpperCase().replace(/\s+/g, "");
  const esNuevo = !almacen.activo(ticker);
  const clase = esNuevo ? $("#op-clase").value : almacen.activo(ticker).tipo;
  if (esNuevo && clase === "cripto" && !ticker.includes("-")) ticker += "-EUR";   // BTC -> BTC-EUR
  const error = (msg) => { $("#op-error").textContent = msg; $("#op-error").hidden = false; };
  if (!ticker) return error("Escribe el símbolo del valor");

  const op = { id: editando || undefined, tipo: tipoOp, ticker, fecha: $("#op-fecha").value };
  if (tipoOp === "dividendo") {
    op.importe = +$("#op-importe").value;
    if (!(op.importe > 0)) return error("Escribe el importe cobrado");
  } else {
    op.cantidad = +$("#op-cantidad").value;
    op.precio = +$("#op-precio").value;
    op.divisa = $("#op-divisa").value;
    op.comision = +$("#op-comision").value || 0;
    if (!(op.cantidad > 0) || !(op.precio > 0)) return error("Escribe la cantidad y el precio");
    if (tipoOp === "venta") {
      const tengo = almacen.operaciones().filter((o) => o.ticker === ticker && o.id !== editando && o.fecha <= op.fecha)
        .reduce((s, o) => s + (o.tipo === "compra" ? o.cantidad : o.tipo === "venta" ? -o.cantidad : 0), 0);
      if (op.cantidad > tengo + 1e-9) return error(`En esa fecha solo tenías ${f.num(tengo)} de ${ticker}`);
    }
  }
  if (esNuevo) {
    almacen.guardarActivo({ ticker, tipo: clase, nombre: $("#op-nombre").value.trim() || undefined, divisa: op.divisa });
    tickerNuevoPendiente = tieneLlave();
  }
  almacen.guardarOperacion(op);
  dlgOp.close();
  avisar(esNuevo && tieneLlave() ? `Guardado. Buscando el precio de ${ticker}…` : "Guardado");
}

// ---------- Precio a mano ----------
let tickerManual = null;
function abrirManual(ticker) {
  tickerManual = ticker;
  const a = almacen.activo(ticker);
  $("#manual-etiqueta").textContent = `Precio de ${ticker} (${calc.divisaDe(ticker)})`;
  $("#manual-precio").value = a?.precioManual?.precio ?? "";
  $("#dlg-manual").showModal();
}

// ---------- Conectar ----------
function abrirConectar() {
  $("#llave").value = "";
  $("#llave-error").hidden = true;
  $("#dlg-llave").showModal();
}

async function actualizarPrecios() {
  try {
    await cot.pedirActualizacion();
    avisar("Pidiendo precios nuevos al robot…");
  } catch (e) { avisar(e.message); }
}

// ---------- Eventos ----------
function iniciarEventos() {
  $("#btn-tema").addEventListener("click", () => { window.tema.cambiar(); pintarTema(); });
  $("#btn-ojo").addEventListener("click", () => { f.alternarOculto(); pintarOjo(); pintar(); });
  $("#btn-nueva").addEventListener("click", () => abrirOp());
  $("#btn-actualizar").addEventListener("click", actualizarPrecios);
  $("#sync").addEventListener("click", () => (tieneLlave() ? almacen.sincronizar() : abrirConectar()));

  // Menú ⋯
  const menu = $("#menu"), btnMenu = $("#btn-menu");
  const cerrarMenu = () => { menu.hidden = true; btnMenu.setAttribute("aria-expanded", "false"); };
  btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    btnMenu.setAttribute("aria-expanded", !menu.hidden);
  });
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) cerrarMenu(); });

  // Botones con data-accion (menú, bienvenida, fichas de posiciones)
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-accion]");
    if (!b) return;
    cerrarMenu();
    const accion = b.dataset.accion;
    if (accion === "conectar") abrirConectar();
    else if (accion === "nueva") abrirOp({ ticker: b.dataset.ticker });
    else if (accion === "manual") abrirManual(b.dataset.ticker);
    else if (accion === "actualizar") actualizarPrecios();
    else if (accion === "desconectar") {
      if (confirm("¿Quitar la llave de este navegador? Tu cartera seguirá guardada en GitHub.")) almacen.desconectar();
    } else if (accion === "exportar") {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([almacen.exportar()], { type: "application/json" }));
      a.download = `cartera-${hoyISO()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } else if (accion === "importar") $("#archivo-importar").click();
  });

  $("#archivo-importar").addEventListener("change", async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    try { avisar(`Cargadas ${almacen.importar(await archivo.text())} operaciones`); } catch (err) { avisar(err.message); }
    e.target.value = "";
  });

  // Desplegar / plegar una posición
  $("#posiciones").addEventListener("click", (e) => {
    const fila = e.target.closest(".pos-fila");
    if (!fila) return;
    const t = fila.closest(".posicion").dataset.ticker;
    abiertos.has(t) ? abiertos.delete(t) : abiertos.add(t);
    pintarPosiciones(ultimo);
  });
  // Editar una operación
  $("#operaciones").addEventListener("click", (e) => {
    const b = e.target.closest(".op");
    if (b) abrirOp({ id: b.dataset.id });
  });

  $("#rangos").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    pref.rango = b.dataset.rango; guardarPref(); pintarGrafico();
  });
  $("#modo-reparto").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    pref.reparto = b.dataset.modo; guardarPref(); pintarReparto(ultimo);
  });

  // Ventana de operación
  $("#op-tipo").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) ponerTipoOp(b.dataset.tipo); });
  $("#op-ticker").addEventListener("input", () => alCambiarTicker());
  for (const id of ["#op-cantidad", "#op-precio", "#op-comision", "#op-divisa"]) $(id).addEventListener("input", calcularTotal);
  $("#form-op").addEventListener("submit", guardarOp);
  $("#btn-cancelar-op").addEventListener("click", () => dlgOp.close());
  $("#btn-borrar-op").addEventListener("click", () => {
    if (!editando || !confirm("¿Borrar esta operación?")) return;
    almacen.borrarOperacion(editando);
    dlgOp.close();
    avisar("Operación borrada");
  });

  // Precio a mano
  $("#form-manual").addEventListener("submit", (e) => {
    e.preventDefault();
    const a = almacen.activo(tickerManual);
    if (a) almacen.guardarActivo({ ...a, precioManual: { precio: +$("#manual-precio").value, fecha: new Date().toISOString() } });
    $("#dlg-manual").close();
  });
  $("#btn-cancelar-manual").addEventListener("click", () => $("#dlg-manual").close());

  // Conectar con GitHub
  $("#form-llave").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#llave-error");
    err.hidden = true;
    try {
      await almacen.conectar($("#llave").value);
      $("#dlg-llave").close();
      avisar("Conectado. Tu cartera se guarda en GitHub");
      cot.iniciar();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  $("#btn-cancelar-llave").addEventListener("click", () => $("#dlg-llave").close());

  // Atajos de teclado
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, dialog") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "n" || e.key === "N") { e.preventDefault(); abrirOp(); }
    if (e.key === "h" || e.key === "H") { f.alternarOculto(); pintarOjo(); pintar(); }
  });

  // Redibujar el gráfico si cambia el ancho de la ventana
  let temporizador;
  addEventListener("resize", () => { clearTimeout(temporizador); temporizador = setTimeout(() => !almacen.vacia() && pintarGrafico(), 150); });
  // El texto "Precios hace X min" se refresca solo
  setInterval(() => { if (!almacen.vacia()) pintarEstadoPrecios(); }, 30000);
}

// ---------- Arranque ----------
almacen.alCambiar((que) => {
  if (que === "estado") pintarSync();
  else if (que === "datos") pintar();
  else if (que === "subido" && tickerNuevoPendiente) {
    tickerNuevoPendiente = false;
    cot.pedirActualizacion().catch((e) => avisar(e.message));
  }
});
cot.alCambiar(pintar);

pintarTema();
pintarOjo();
iniciarEventos();
almacen.iniciar();
pintarSync();
pintar();
cot.iniciar();
