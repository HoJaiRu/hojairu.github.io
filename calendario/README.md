# Calendario

https://hojairu.github.io/calendario/

Calendario minimalista con notas por día y una tarjeta "Hoy" (resumen matinal).

## Privacidad

- La web es pública, pero **vacía**: quien la abra solo ve un calendario sin notas.
- Tus notas se guardan **en tu navegador** y, si conectas tu llave de GitHub,
  también en el repositorio **privado** `WEBS/calendario/notas.json` (para tenerlas en el PC y el móvil).
- La llave es la misma que usa el Vigilante de precios. Si ya la pegaste ahí en este navegador,
  el calendario la usa sola. Nunca sale de tu navegador salvo para hablar con GitHub.

## Qué hace cada archivo

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La estructura de la página (barra, tarjeta Hoy, calendario, panel del día) |
| `estilos.css` | El aspecto. Los colores generales están en `../comun/base.css` |
| `js/config.js` | **Ajustes que puedes tocar a mano:** tu nombre, categorías y colores, festivos de tu comunidad |
| `js/fechas.js` | Cálculos de fechas y festivos nacionales (incluida Semana Santa) |
| `js/almacen.js` | Guarda las notas: navegador + GitHub, y mezcla cambios de varios dispositivos |
| `js/vistas.js` | Dibuja las vistas Mes, 3 meses y Año |
| `js/panel.js` | El panel lateral de un día: añadir, editar, marcar y borrar notas |
| `js/hoy.js` | La tarjeta "Hoy": hoy, mañana y cuenta atrás |
| `js/app.js` | Une todo: botones, menú, atajos de teclado, deslizar en el móvil y el QR para el móvil |
| `js/lib/qrcode.mjs` | Librería para dibujar el código QR (qrcode-generator 2.0.4, licencia MIT) |
| `manifest.webmanifest`, `icono-*.png` | Para instalar la web como app en el móvil o el PC |
| `avisos/avisos.py` | Manda los recordatorios al móvil (ntfy). Lo lanza cada tarde `WEBS/.github/workflows/calendario-avisos.yml` |

## Probarlo en tu ordenador

Los archivos `js/` son "módulos" y el navegador no los carga con doble clic (`file://`).
Desde la carpeta del repositorio:

```
python -m http.server 8000
```

y abre http://localhost:8000/calendario/

## Avisos al móvil

Cada tarde (19:00 en invierno, 20:00 en verano) GitHub Actions mira tus notas y te manda a la app
**ntfy** del móvil lo que tengas al día siguiente. Los cumpleaños y lo importante (categoría Importante
o ★) te los recuerda además 10 días antes. Usa el mismo canal (`NTFY_TOPIC`) que el Vigilante de precios.
Los días de antelación se cambian arriba del todo en `avisos/avisos.py`.

## Ideas para siguientes versiones

Eventos de varios días, eventos que se repiten, arrastrar notas, buscador, tiempo de tu ciudad,
instalar como app (PWA), importar Google Calendar. Lista completa en las ideas del proyecto.
