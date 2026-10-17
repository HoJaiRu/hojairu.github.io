// portada.js - Botón de sol/luna de la página de inicio
const boton = document.getElementById("btn-tema");
const pintar = () => { boton.textContent = window.tema.actual() === "oscuro" ? "☀" : "☾"; };
boton.addEventListener("click", () => { window.tema.cambiar(); pintar(); });
pintar();
