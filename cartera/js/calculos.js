// calculos.js - Las cuentas: cuánto tienes de cada valor, cuánto te costó y cuánto vale.
// Todo en euros. Para el coste se usa el PRECIO MEDIO: al vender, el coste baja en proporción.
//
// Una operación es: { tipo: "compra"|"venta"|"dividendo", ticker, fecha, cantidad, precio, divisa, comision, importe }
//  - compra/venta: cantidad × precio (en la moneda del valor) + comisión (en euros)
//  - dividendo: importe neto cobrado, en euros

import * as almacen from "./almacen.js";
import * as cot from "./cotizaciones.js";

const hoyISO = () => new Date().toISOString().slice(0, 10);

// Euros de una compra o venta, con el cambio del día de la operación si se conoce
function eurosDe(op) {
  const fx = cot.aEuros(op.divisa, op.fecha) ?? 1;
  return op.cantidad * op.precio * fx;
}

// Recorre las operaciones (ya ordenadas por fecha) y devuelve cómo queda cada valor
function acumular(ops) {
  const pos = new Map();
  const porAnio = {};   // año -> { realizado, dividendos }
  for (const op of ops) {
    if (!pos.has(op.ticker)) pos.set(op.ticker, { cantidad: 0, coste: 0, realizado: 0, dividendos: 0, ops: [] });
    const p = pos.get(op.ticker);
    p.ops.push(op);
    const anio = op.fecha.slice(0, 4);
    porAnio[anio] ||= { realizado: 0, dividendos: 0 };
    if (op.tipo === "compra") {
      p.cantidad += op.cantidad;
      p.coste += eurosDe(op) + (op.comision || 0);
    } else if (op.tipo === "venta") {
      const vendida = Math.min(op.cantidad, p.cantidad);
      const parteCoste = p.cantidad > 0 ? p.coste * (vendida / p.cantidad) : 0;
      const resultado = eurosDe({ ...op, cantidad: vendida }) - (op.comision || 0) - parteCoste;
      p.cantidad -= vendida;
      p.coste -= parteCoste;
      if (p.cantidad < 1e-9) { p.cantidad = 0; p.coste = 0; }
      p.realizado += resultado;
      porAnio[anio].realizado += resultado;
    } else if (op.tipo === "dividendo") {
      p.dividendos += op.importe || 0;
      porAnio[anio].dividendos += op.importe || 0;
    }
  }
  return { pos, porAnio };
}

// Moneda en la que cotiza un valor
export function divisaDe(ticker) {
  return cot.de(ticker)?.divisa || almacen.activo(ticker)?.divisa || adivinarDivisa(ticker);
}
// Por el final del ticker: ".MC" Madrid, ".AS" Ámsterdam, ".DE" Alemania, ".L" Londres...
export function adivinarDivisa(ticker) {
  const t = ticker.toUpperCase();
  if (/-EUR$/.test(t)) return "EUR";
  if (/-USD$/.test(t)) return "USD";
  if (/\.L$/.test(t)) return "GBP";
  if (/\.SW$/.test(t)) return "CHF";
  if (/\.(MC|AS|DE|F|PA|MI|BR|LS|VI|HE|IR)$/.test(t) || /^0P/.test(t)) return "EUR";
  return "USD";
}

// ---------- Resumen completo de la cartera ----------
export function cartera() {
  const ops = almacen.operaciones();
  const { pos, porAnio } = acumular(ops);
  const lista = [];
  let valor = 0, coste = 0, hoy = 0, valorAyer = 0, realizado = 0, dividendos = 0;
  let sinPrecio = 0;

  for (const [ticker, p] of pos) {
    realizado += p.realizado;
    dividendos += p.dividendos;
    const a = almacen.activo(ticker) || { ticker, tipo: "otro" };
    const c = cot.de(ticker);
    const fx = c ? cot.aEuros(c.divisa) : null;
    const v = c && fx != null ? p.cantidad * c.precio * fx : null;
    const ayer = c && fx != null && c.cierreAnterior != null ? p.cantidad * c.cierreAnterior * fx : null;
    const item = {
      ticker, activo: a, cotizacion: c,
      nombre: a.nombre || c?.nombre || ticker,
      cantidad: p.cantidad, coste: p.coste,
      precioMedio: p.cantidad ? p.coste / p.cantidad : 0,
      valor: v,
      ganancia: v != null ? v - p.coste : null,
      gananciaPct: v != null && p.coste ? (v - p.coste) / p.coste : null,
      hoy: v != null && ayer != null ? v - ayer : null,
      hoyPct: c && c.cierreAnterior ? c.precio / c.cierreAnterior - 1 : null,
      realizado: p.realizado, dividendos: p.dividendos,
      ops: p.ops, error: cot.error(ticker),
    };
    lista.push(item);
    if (p.cantidad > 0) {
      coste += p.coste;
      if (v != null) { valor += v; hoy += item.hoy || 0; valorAyer += ayer ?? v; } else { sinPrecio++; valor += p.coste; }
    }
  }
  const abiertas = lista.filter((x) => x.cantidad > 0).sort((a, b) => (b.valor ?? b.coste) - (a.valor ?? a.coste));
  for (const x of abiertas) x.peso = valor ? (x.valor ?? x.coste) / valor : 0;
  const cerradas = lista.filter((x) => x.cantidad === 0);

  return {
    abiertas, cerradas, porAnio,
    valor, coste, sinPrecio,
    ganancia: valor - coste,
    gananciaPct: coste ? (valor - coste) / coste : 0,
    hoy, hoyPct: valorAyer ? hoy / valorAyer : 0,
    realizado, dividendos,
  };
}

// ---------- Evolución: valor de la cartera y dinero metido, día a día ----------
export function evolucion() {
  const ops = almacen.operaciones();
  if (!ops.length) return [];
  const tickers = [...new Set(ops.map((o) => o.ticker))];
  const historicos = Object.fromEntries(tickers.map((t) => [t, cot.historico(t)]));

  // Días: todos los días con cotización desde la primera operación hasta hoy
  const inicio = ops[0].fecha, hoy = hoyISO();
  const dias = new Set([inicio, hoy]);
  for (const h of Object.values(historicos)) if (h) for (const d of h.d) if (d >= inicio && d <= hoy) dias.add(d);
  for (const o of ops) dias.add(o.fecha);
  const ordenados = [...dias].sort();

  const cantidad = {}, coste = {}, ultimoPrecio = {};
  let i = 0;
  const serie = [];
  for (const dia of ordenados) {
    // Aplicar las operaciones hasta este día
    while (i < ops.length && ops[i].fecha <= dia) {
      const op = ops[i++];
      cantidad[op.ticker] ||= 0; coste[op.ticker] ||= 0;
      if (op.tipo === "compra") {
        cantidad[op.ticker] += op.cantidad;
        coste[op.ticker] += eurosDe(op) + (op.comision || 0);
        ultimoPrecio[op.ticker] = op.precio;
      } else if (op.tipo === "venta") {
        const parte = cantidad[op.ticker] ? Math.min(1, op.cantidad / cantidad[op.ticker]) : 0;
        coste[op.ticker] -= coste[op.ticker] * parte;
        cantidad[op.ticker] = Math.max(0, cantidad[op.ticker] - op.cantidad);
        ultimoPrecio[op.ticker] = op.precio;
      }
    }
    let valor = 0, invertido = 0;
    for (const t of tickers) {
      if (!cantidad[t]) continue;
      invertido += coste[t];
      const divisa = divisaDe(t);
      let precio = historicos[t] ? cot.valorEn(historicos[t], dia) : null;
      if (dia === hoy && cot.de(t)) precio = cot.de(t).precio;   // hoy: el precio más reciente
      precio ??= ultimoPrecio[t];
      const fx = cot.aEuros(divisa, dia) ?? 1;
      valor += cantidad[t] * precio * fx;
    }
    serie.push({ dia, valor, invertido });
  }
  return serie;
}
