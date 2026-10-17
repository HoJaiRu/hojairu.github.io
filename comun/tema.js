// tema.js - Modo oscuro / claro, compartido por todas las webs.
// Se carga en el <head> (antes de pintar la página) para que no haya "parpadeo" de color.
// La elección se guarda en este navegador y vale para todas las webs de hojairu.github.io.
(function () {
  const CLAVE = "webs.tema";
  const POR_DEFECTO = "oscuro";

  function leer() {
    try { return localStorage.getItem(CLAVE) || POR_DEFECTO; } catch { return POR_DEFECTO; }
  }

  function aplicar(tema) {
    document.documentElement.dataset.tema = tema;
  }

  aplicar(leer());

  // Las webs llaman a window.tema.cambiar() desde su botón de sol/luna
  window.tema = {
    actual: leer,
    cambiar() {
      const nuevo = leer() === "oscuro" ? "claro" : "oscuro";
      try { localStorage.setItem(CLAVE, nuevo); } catch {}
      aplicar(nuevo);
      return nuevo;
    },
  };
})();
