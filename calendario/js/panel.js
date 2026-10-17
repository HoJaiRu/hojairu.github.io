// panel.js - El panel lateral de un día: ver, añadir, editar, marcar y borrar notas.

import { CATEGORIAS } from "./config.js";
import { desdeClave, fechaLarga, festivo, numeroSemana } from "./fechas.js";
import { notasDe, guardarNota, borrarNota } from "./almacen.js";
import { esc, colorDe } from "./vistas.js";

const $ = (s) => document.querySelector(s);
const CLAVE_ULTIMA_CAT = "calendario.ultimaCategoria";

let fecha = null;       // día abierto ("AAAA-MM-DD") o null si el panel está cerrado
let editando = null;    // id de la nota que se está editando
let alCerrar = () => {};
let avisar = () => {};

export const fechaAbierta = () => fecha;

export function iniciarPanel(opciones) {
  alCerrar = opciones.alCerrar;
  avisar = opciones.avisar;

  // Botones de categoría (se generan a partir de config.js)
  let ultima = CATEGORIAS[0].id;
  try { ultima = localStorage.getItem(CLAVE_ULTIMA_CAT) || ultima; } catch {}
  $("#nota-cats").innerHTML = CATEGORIAS.map((c) =>
    `<label class="cat" style="--c:${c.color}">` +
    `<input type="radio" name="cat" value="${c.id}"${c.id === ultima ? " checked" : ""}>` +
    `<span>${esc(c.nombre)}</span></label>`).join("");

  $("#btn-cerrar-panel").addEventListener("click", cerrarPanel);
  $("#velo").addEventListener("click", cerrarPanel);
  $("#btn-cancelar-edicion").addEventListener("click", limpiarFormulario);
  $("#form-nota").addEventListener("submit", (e) => { e.preventDefault(); enviar(); });

  // Enter guarda; Mayús+Enter hace salto de línea
  $("#nota-texto").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
  });

  $("#panel-notas").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const id = li.dataset.id;
    const nota = notasDe(fecha).find((n) => n.id === id);
    if (!nota) return;
    if (e.target.closest(".marcar")) {
      guardarNota({ ...nota, hecha: !nota.hecha });
    } else if (e.target.closest(".borrar")) {
      borrarNota(id);
      if (editando === id) limpiarFormulario();
      avisar("Nota borrada", "Deshacer", () => guardarNota({ ...nota }));
    } else if (e.target.closest(".texto")) {
      empezarEdicion(nota);
    }
  });
}

export function abrirPanel(nuevaFecha, { enfocar = true } = {}) {
  if (fecha !== nuevaFecha) limpiarFormulario();
  fecha = nuevaFecha;
  const d = desdeClave(fecha);
  const fest = festivo(d);
  $("#panel-semana").textContent = `Semana ${numeroSemana(d)} · ${d.getFullYear()}`;
  $("#panel-fecha").textContent = fechaLarga(d);
  $("#panel-festivo").textContent = fest;
  $("#panel-festivo").hidden = !fest;
  pintarPanel();
  $("#panel").classList.add("abierto");
  $("#panel").setAttribute("aria-hidden", "false");
  $("#velo").hidden = false;
  document.body.classList.add("panel-abierto");
  // En el móvil no se enfoca el texto, para que no salte el teclado tapándolo todo
  if (enfocar && matchMedia("(hover: hover)").matches) setTimeout(() => $("#nota-texto").focus(), 60);
}

export function cerrarPanel() {
  if (!fecha) return;
  fecha = null;
  limpiarFormulario();
  $("#panel").classList.remove("abierto");
  $("#panel").setAttribute("aria-hidden", "true");
  $("#velo").hidden = true;
  document.body.classList.remove("panel-abierto");
  alCerrar();
}

export function pintarPanel() {
  if (!fecha) return;
  const notas = notasDe(fecha);
  $("#panel-vacio").hidden = notas.length > 0;
  $("#panel-notas").innerHTML = notas.map((n) => `
    <li data-id="${n.id}" class="${n.hecha ? "hecha" : ""}${n.id === editando ? " editando" : ""}" style="--c:${colorDe(n.cat)}">
      <button class="marcar" title="${n.hecha ? "Marcar como pendiente" : "Marcar como hecha"}" aria-label="Hecha">${n.hecha ? "✓" : ""}</button>
      <button class="texto" title="Editar">
        ${n.hora ? `<em>${esc(n.hora)}</em>` : ""}
        <span>${esc(n.texto)}</span>
        ${n.destacada ? `<b class="estrella" title="Destacada">★</b>` : ""}
      </button>
      <button class="borrar btn-icono" title="Borrar" aria-label="Borrar">✕</button>
    </li>`).join("");
}

function empezarEdicion(nota) {
  editando = nota.id;
  $("#nota-texto").value = nota.texto;
  $("#nota-hora").value = nota.hora || "";
  $("#nota-destacada").checked = !!nota.destacada;
  const radio = document.querySelector(`#nota-cats input[value="${nota.cat}"]`);
  if (radio) radio.checked = true;
  $("#btn-guardar-nota").textContent = "Guardar cambios";
  $("#btn-cancelar-edicion").hidden = false;
  pintarPanel();
  $("#nota-texto").focus();
}

function limpiarFormulario() {
  editando = null;
  $("#nota-texto").value = "";
  $("#nota-hora").value = "";
  $("#nota-destacada").checked = false;
  $("#btn-guardar-nota").textContent = "Añadir";
  $("#btn-cancelar-edicion").hidden = true;
  if (fecha) pintarPanel();
}

function enviar() {
  const texto = $("#nota-texto").value.trim();
  if (!texto || !fecha) return;
  const cat = document.querySelector("#nota-cats input:checked")?.value || CATEGORIAS[0].id;
  try { localStorage.setItem(CLAVE_ULTIMA_CAT, cat); } catch {}
  const anterior = editando ? notasDe(fecha).find((n) => n.id === editando) : {};
  guardarNota({
    ...anterior,
    id: editando || undefined,
    fecha,
    texto,
    cat,
    hora: $("#nota-hora").value || "",
    destacada: $("#nota-destacada").checked,
  });
  limpiarFormulario();
  $("#nota-texto").focus();
}
