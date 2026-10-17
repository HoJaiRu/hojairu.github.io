# hojairu.github.io

Código de mis webs personales, publicado con GitHub Pages.
Aquí **solo hay código**: los datos de cada persona están en su propio repositorio privado
y la web los lee con la llave (token) de esa persona.

## Vigilante de precios — https://hojairu.github.io/precios/

| Carpeta / archivo | Para qué sirve |
|---|---|
| `precios/` | La web (HTML, CSS y JavaScript) |
| `vigilante/` | El lector de precios (Python) que ejecuta GitHub Actions |
| `.github/workflows/vigilar-precios.yml` | Workflow reutilizable: lo llaman los repositorios de datos |

Repositorios de datos (privados): `WEBS` (HoJaiRu) y `precios-perfil2`.
Cada uno tiene `precios/productos.json`, `precios/datos/` y un workflow pequeño que llama al de aquí.

**Añadir otro perfil:** crear un repositorio privado con la misma estructura y añadirlo a `PERFILES` en `precios/app.js`.
