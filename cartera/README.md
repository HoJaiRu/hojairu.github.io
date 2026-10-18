# Cartera

Seguimiento de mi cartera de bolsa: cuánto vale, cuánto gano o pierdo y cómo está repartida.
Web: https://hojairu.github.io/cartera/ · Datos (privados): `WEBS/cartera/`

Solo muestra mis datos; no da consejos de inversión.

## Qué hace

- **Resumen**: valor total, ganancia total (€ y %) y lo que ha cambiado hoy.
- **Gráfico**: evolución del valor frente al dinero invertido (1M, 3M, 1A, Todo).
- **Posiciones**: cada valor con su minigráfico; al pulsarlo, el detalle (precio medio, ganancia, peso...).
- **Desplegables**: reparto (por tipo o por valor), resultados por año (ventas y dividendos) y todas las operaciones.
- **Ojo** (tecla H): esconde los importes para enseñar la web sin enseñar cifras.

## De dónde salen los precios

| Valores | Fuente | Cada cuánto | ¿Servicio externo? |
|---|---|---|---|
| Acciones, ETF, fondos | Robot en GitHub Actions que lee Yahoo Finance | Cada 30 min con la bolsa abierta, y al momento con ↻ (tarda ~30-60 s) | Sí: Yahoo, solo lectura, sin cuenta |
| Criptomonedas | Binance, directamente desde el navegador | Cada 10 s | Sí: Binance, solo lectura, sin cuenta |
| Lo que no encuentre el robot | Precio a mano en la ficha del valor | Cuando tú lo cambies | No |

A Yahoo y a Binance solo se les pide el **símbolo** del valor; nunca ven cantidades ni nada tuyo.

**Coste:** el repositorio de datos es privado, así que cada vez que corre el robot gasta ~1 minuto
de los 2.000 gratis al mes de GitHub Actions (unos 660 al mes con el horario actual, más el Vigilante).
Para gastar menos, cambia el `cron` en `WEBS/.github/workflows/cartera-cotizar.yml`.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `estilos.css` | La página y su aspecto |
| `js/config.js` | **Ajustes** (repositorio, cada cuánto se miran los precios, colores) |
| `js/app.js` | Une todo: pinta la pantalla y responde a los botones |
| `js/almacen.js` | Guarda tus operaciones en el navegador y en `WEBS/cartera/cartera.json` |
| `js/cotizaciones.js` | Lee los precios del robot y los de cripto en directo |
| `js/calculos.js` | Las cuentas: posiciones, ganancias, evolución |
| `js/graficos.js` | Los gráficos (SVG hecho a mano, sin librerías) |
| `js/formato.js` | Cómo se escriben euros, porcentajes y fechas |
| `js/github.js` | Habla con la API de GitHub con tu llave |
| `robot/cotizar.py` | El robot: trae los precios de Yahoo (Python sin librerías externas) |
| `../.github/workflows/cotizar-cartera.yml` | Workflow reutilizable que ejecuta el robot (lo llama `WEBS`) |

## Cómo se usa

1. Abre la web y pulsa **+** para apuntar una compra. El valor se escribe con su símbolo de Yahoo
   Finance: `AAPL` (Apple), `SAN.MC` (Santander, Madrid), `IWDA.AS` (ETF MSCI World, Ámsterdam), `BTC-EUR`.
2. Conecta GitHub (⋯ → Sincronizar) con la misma llave del Vigilante. La llave necesita
   permiso **Contents** y **Actions** (Read and write) sobre `WEBS`.
3. El robot trae el precio en menos de un minuto. Si no lo encuentra, sale "⚠ sin precio":
   revisa el símbolo o pon el precio a mano en la ficha del valor.

**Probar el robot sin tocar nada:** en GitHub → WEBS → Actions → "Cartera - cotizaciones" →
Run workflow, y escribe símbolos en "prueba" (por ejemplo `AAPL,SAN.MC`). Muestra los precios en el registro.
