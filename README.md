# hojairu.github.io

Código de mis webs personales, publicado con GitHub Pages en https://hojairu.github.io/

Aquí **solo hay código** (este repositorio es público). Los datos de cada persona están en su
propio repositorio **privado** y la web los lee con la llave (token) de esa persona.

## Cómo está organizado

```
hojairu.github.io/
├── index.html            Portada: enlaces a todas las webs
├── comun/                Lo que comparten todas las webs
│   ├── base.css          Colores (oscuro / claro), letra y botones
│   ├── tema.js           Botón de modo oscuro / claro
│   └── portada.*         Estilo y botón de la portada
├── calendario/           Calendario y resumen matinal
├── precios/              Vigilante de precios
│   └── vigilante/        El lector de precios (Python) que ejecuta GitHub Actions
└── .github/workflows/    Tareas automáticas (GitHub obliga a que estén aquí)
```

**Regla:** cada web vive entera en su carpeta, con su propio `README.md`.
Para una web nueva: crear su carpeta, enlazarla en `index.html` y, si guarda datos,
crear la misma carpeta en el repositorio privado `WEBS`.

## Webs

| Web | Dirección | Datos (privados) |
|---|---|---|
| Calendario | https://hojairu.github.io/calendario/ | `WEBS/calendario/` — ver [calendario/README.md](calendario/README.md) |
| Vigilante de precios | https://hojairu.github.io/precios/ | `WEBS/precios/` y `precios-perfil2` |
| Cartera | — | Pendiente |

## Vigilante de precios

| Archivo | Para qué sirve |
|---|---|
| `precios/` (index.html, app.js, style.css) | La web |
| `precios/vigilante/` | El lector de precios (Python) |
| `.github/workflows/vigilar-precios.yml` | Workflow reutilizable: lo llaman los repositorios de datos |

Repositorios de datos (privados): `WEBS` (HoJaiRu) y `precios-perfil2`.
Cada uno tiene `precios/productos.json`, `precios/datos/` y un workflow pequeño que llama al de aquí.

**IA (Gemini):** `precios/vigilante/ia.py`. Busca tiendas a partir del nombre del producto, averigua los
gastos de envío a España y clasifica si cada enlace es el mismo producto. Los precios los lee el lector
(`scraper.py`); la IA solo lee un precio como último recurso, y ese fallo del lector se sigue viendo en la zona de errores. Necesita el secreto `GEMINI_API_KEY` en cada repositorio de datos; sin él todo funciona igual, pero sin IA.
El precio que se compara es el **total en euros** (precio convertido con el cambio del BCE + envío).

**Añadir otro perfil:** crear un repositorio privado con la misma estructura y añadirlo a `PERFILES` en `precios/app.js`.
