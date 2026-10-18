// graficos.js - Los dos gráficos, dibujados a mano en SVG (sin librerías, carga al instante).
//  - lineas(): evolución del valor de la cartera y del dinero metido, con cruceta al pasar el ratón
//  - quesito(): reparto de la cartera (donut), con detalle al pasar el ratón
// Los colores salen del CSS (var(--acento), etc.), así funcionan en modo oscuro y claro.

import * as f from "./formato.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

// ---------- Gráfico de líneas ----------
export function lineas(contenedor, serie) {
  contenedor.replaceChildren();
  if (serie.length < 2) {
    contenedor.innerHTML = `<p class="grafico-vacio">El gráfico aparece cuando haya precios de más de un día.</p>`;
    return;
  }
  const W = Math.max(280, contenedor.clientWidth), H = contenedor.clientHeight || 220;
  const m = { arriba: 12, abajo: 24, izq: 8, der: 54 };   // la escala va a la derecha
  const ancho = W - m.izq - m.der, alto = H - m.arriba - m.abajo;

  const valores = serie.flatMap((p) => [p.valor, p.invertido]);
  let min = Math.min(...valores), max = Math.max(...valores);
  const holgura = (max - min) * 0.08 || max * 0.05 || 1;
  min = Math.max(0, min - holgura); max += holgura;
  const x = (i) => m.izq + (i / (serie.length - 1)) * ancho;
  const y = (v) => m.arriba + alto - ((v - min) / (max - min)) * alto;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "svg-lineas", role: "img",
    "aria-label": "Evolución del valor de la cartera" });

  // Rejilla y escala (4 líneas suaves)
  for (let k = 0; k <= 3; k++) {
    const v = min + ((max - min) * k) / 3;
    svg.append(el("line", { x1: m.izq, x2: m.izq + ancho, y1: y(v), y2: y(v), class: "rejilla" }));
    const t = el("text", { x: W - 4, y: y(v) + 4, class: "eje", "text-anchor": "end" });
    t.textContent = f.eurosCorto(v);
    svg.append(t);
  }
  // Fechas de inicio y fin
  for (const [i, ancla] of [[0, "start"], [serie.length - 1, "end"]]) {
    const t = el("text", { x: ancla === "start" ? m.izq : m.izq + ancho, y: H - 6, class: "eje", "text-anchor": ancla });
    t.textContent = f.fecha(serie[i].dia);
    svg.append(t);
  }

  const camino = (clave) => serie.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[clave]).toFixed(1)}`).join("");
  const sube = serie.at(-1).valor >= serie.at(-1).invertido;

  // Relleno suave bajo la línea del valor
  const id = "deg" + Math.random().toString(36).slice(2, 7);
  const defs = el("defs");
  const deg = el("linearGradient", { id, x1: 0, x2: 0, y1: 0, y2: 1 });
  deg.append(el("stop", { offset: "0%", class: "deg-ini" }), el("stop", { offset: "100%", class: "deg-fin" }));
  defs.append(deg);
  svg.append(defs);
  svg.append(el("path", { d: `${camino("valor")}L${x(serie.length - 1)},${m.arriba + alto}L${x(0)},${m.arriba + alto}Z`, fill: `url(#${id})` }));
  svg.append(el("path", { d: camino("invertido"), class: "linea-invertido" }));
  svg.append(el("path", { d: camino("valor"), class: "linea-valor" + (sube ? "" : " baja") }));

  // Cruceta y burbuja al pasar el ratón / el dedo
  const guia = el("line", { y1: m.arriba, y2: m.arriba + alto, class: "guia", visibility: "hidden" });
  const punto = el("circle", { r: 4.5, class: "punto-valor", visibility: "hidden" });
  const punto2 = el("circle", { r: 3.5, class: "punto-invertido", visibility: "hidden" });
  svg.append(guia, punto2, punto);
  const zona = el("rect", { x: m.izq, y: 0, width: ancho, height: H, fill: "transparent" });
  svg.append(zona);
  contenedor.append(svg);

  const burbuja = document.createElement("div");
  burbuja.className = "burbuja";
  burbuja.hidden = true;
  contenedor.append(burbuja);

  const mover = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(serie.length - 1, Math.round(((px - m.izq) / ancho) * (serie.length - 1))));
    const p = serie[i];
    for (const e of [guia, punto, punto2]) e.setAttribute("visibility", "visible");
    guia.setAttribute("x1", x(i)); guia.setAttribute("x2", x(i));
    punto.setAttribute("cx", x(i)); punto.setAttribute("cy", y(p.valor));
    punto2.setAttribute("cx", x(i)); punto2.setAttribute("cy", y(p.invertido));
    const dif = p.valor - p.invertido;
    burbuja.innerHTML = `<b>${f.fecha(p.dia)}</b>
      <span><i class="marca-valor"></i>Valor <b>${f.euros(p.valor)}</b></span>
      <span><i class="marca-invertido"></i>Invertido <b>${f.euros(p.invertido)}</b></span>
      <span class="${f.clase(dif)}">${f.eurosSigno(dif)} · ${f.pct(p.invertido ? dif / p.invertido : 0)}</span>`;
    burbuja.hidden = false;
    const izquierda = (x(i) / W) * r.width;
    burbuja.style.left = Math.min(r.width - burbuja.offsetWidth - 4, Math.max(4, izquierda - burbuja.offsetWidth / 2)) + "px";
  };
  const salir = () => { for (const e of [guia, punto, punto2]) e.setAttribute("visibility", "hidden"); burbuja.hidden = true; };
  zona.addEventListener("pointermove", mover);
  zona.addEventListener("pointerdown", mover);
  zona.addEventListener("pointerleave", salir);
}

// ---------- Quesito (donut) ----------
// partes: [{ nombre, valor, color }]
export function quesito(contenedor, partes) {
  contenedor.replaceChildren();
  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (!total) return;
  const R = 70, r = 48, C = 80;
  const svg = el("svg", { viewBox: "0 0 160 160", class: "svg-quesito", role: "img", "aria-label": "Reparto de la cartera" });
  const centro1 = el("text", { x: C, y: C - 2, class: "quesito-num", "text-anchor": "middle" });
  const centro2 = el("text", { x: C, y: C + 16, class: "quesito-txt", "text-anchor": "middle" });
  const poner = (p) => {
    centro1.textContent = p ? f.pctSimple(p.valor / total) : partes.length;
    centro2.textContent = p ? recortar(p.nombre, 14) : partes.length === 1 ? "valor" : "partes";
  };

  const leyenda = document.createElement("ul");
  leyenda.className = "leyenda-quesito";
  let ang = -Math.PI / 2;
  const segmentos = [];
  for (const p of partes) {
    const a = (p.valor / total) * Math.PI * 2;
    const seg = el("path", { d: arco(C, R, r, ang, ang + a), fill: p.color, class: "segmento" });
    ang += a;
    svg.append(seg);
    const li = document.createElement("li");
    li.innerHTML = `<i style="background:${p.color}"></i><span>${f.esc(p.nombre)}</span><b>${f.pctSimple(p.valor / total)}</b><small>${f.euros(p.valor)}</small>`;
    leyenda.append(li);
    const resaltar = (si) => {
      for (const s of segmentos) s.seg.classList.toggle("apagado", si && s.seg !== seg);
      li.classList.toggle("activo", si);
      poner(si ? p : null);
    };
    for (const e of [seg, li]) {
      e.addEventListener("pointerenter", () => resaltar(true));
      e.addEventListener("pointerleave", () => resaltar(false));
    }
    segmentos.push({ seg, li });
  }
  svg.append(centro1, centro2);
  poner(null);
  contenedor.append(svg, leyenda);
}

const recortar = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

// Trozo de anillo entre dos ángulos (con un huequito entre trozos)
function arco(c, R, r, a0, a1) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {   // un solo trozo = anillo completo
    return `M${c - R},${c}a${R},${R} 0 1,0 ${2 * R},0a${R},${R} 0 1,0 ${-2 * R},0Z M${c - r},${c}a${r},${r} 0 1,1 ${2 * r},0a${r},${r} 0 1,1 ${-2 * r},0Z`;
  }
  const hueco = Math.min(0.02, (a1 - a0) / 4);
  a0 += hueco; a1 -= hueco;
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`;
  return `M${p(R, a0)}A${R},${R} 0 ${grande},1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${grande},0 ${p(r, a0)}Z`;
}

// ---------- Minigráfico de una fila (últimos días de un valor) ----------
// Devuelve el SVG como texto; sin ejes, solo la forma. Verde si ha subido en el periodo, rojo si ha bajado.
export function mini(h, dias = 30) {
  if (!h || h.c.length < 3) return "";
  const c = h.c.slice(-dias);
  const min = Math.min(...c), max = Math.max(...c), W = 64, H = 24;
  const pts = c.map((v, i) => `${((i / (c.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - min) / (max - min || 1)) * (H - 4)).toFixed(1)}`);
  return `<svg class="mini ${c.at(-1) >= c[0] ? "sube" : "baja"}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts.join(" ")}"/></svg>`;
}
