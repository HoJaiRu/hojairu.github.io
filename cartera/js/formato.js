// formato.js - Cómo se escriben los números, las fechas y los colores de ganancia/pérdida.

const fmtEuros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
const fmtEurosCorto = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });
const fmtPct = new Intl.NumberFormat("es-ES", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 8, useGrouping: "always" });
const fmtFecha = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" });
const fmtFechaCorta = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" });

// Modo "ojo cerrado": esconde los importes (los porcentajes se siguen viendo)
let oculto = false;
try { oculto = localStorage.getItem("cartera.oculto") === "1"; } catch {}
export const estaOculto = () => oculto;
export function alternarOculto() {
  oculto = !oculto;
  try { localStorage.setItem("cartera.oculto", oculto ? "1" : "0"); } catch {}
  return oculto;
}

const TAPADO = "•••• €";
export const euros = (x) => (x == null ? "—" : oculto ? TAPADO : fmtEuros.format(x));
export const eurosCorto = (x) => (oculto ? "••" : fmtEurosCorto.format(x));
// Con signo delante: +12,30 € / −4,10 €
export const eurosSigno = (x) => (x == null ? "—" : oculto ? TAPADO : (x > 0 ? "+" : x < 0 ? "−" : "") + fmtEuros.format(Math.abs(x)));
export const pct = (x) => (x == null || !isFinite(x) ? "—" : (x > 0 ? "+" : x < 0 ? "−" : "") + fmtPct.format(Math.abs(x)));
export const pctSimple = (x) => fmtPct.format(x).replace(/,00\s/, " ");
export const num = (x) => fmtNum.format(x);
// Precio en la moneda del valor (USD, EUR...)
export const precio = (x, divisa = "EUR") => {
  if (x == null) return "—";
  try { return new Intl.NumberFormat("es-ES", { style: "currency", currency: divisa, maximumFractionDigits: x < 1 ? 6 : 2, useGrouping: "always" }).format(x); }
  catch { return `${fmtNum.format(x)} ${divisa}`; }
};

export const fecha = (iso) => fmtFecha.format(new Date(iso + "T12:00:00"));
export const fechaCorta = (iso) => fmtFechaCorta.format(new Date(iso + "T12:00:00"));

// "hace 3 min", "hace 2 h", "ayer"...
export function haceCuanto(iso) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

// Clase CSS según el signo: verde si sube, rojo si baja
export const clase = (x) => (x > 0 ? "sube" : x < 0 ? "baja" : "");

// Para meter texto en el HTML sin riesgo (nombres de valores, notas...)
export const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
