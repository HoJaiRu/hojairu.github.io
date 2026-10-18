// config.js - Ajustes de la cartera. Es el archivo pensado para tocarlo a mano.

export const CONFIG = {
  // Dónde se guardan tus operaciones y de dónde salen las cotizaciones (repositorio PRIVADO)
  github: {
    owner: "HoJaiRu",
    repo: "WEBS",
    rama: "main",
    ruta: "cartera/cartera.json",               // tus operaciones
    ramaCotizaciones: "cotizaciones",            // el robot guarda aquí los precios (rama aparte, sin historial)
    rutaCotizaciones: "cartera/cotizaciones.json",
    workflow: "cartera-cotizar.yml",             // el robot (GitHub Actions) que trae los precios
  },

  // Cada cuántos segundos se mira si el robot ha traído precios nuevos (no gasta nada)
  segundosLeerCotizaciones: 30,
  // Cada cuántos segundos se actualizan las criptos en directo (Binance, sin cuenta)
  segundosCripto: 10,
  // Al abrir la web, si los precios tienen más de estos minutos y hay bolsa abierta,
  // se le pide al robot que los traiga (cada vez gasta ~1 minuto de GitHub Actions)
  minutosRefrescoAlAbrir: 15,
};

// Tipos de activo: nombre y color en el gráfico de reparto (colores probados para daltonismo)
export const TIPOS = {
  accion: { nombre: "Acciones", color: "#3987e5" },
  etf: { nombre: "ETF", color: "#d95926" },
  fondo: { nombre: "Fondos", color: "#199e70" },
  cripto: { nombre: "Cripto", color: "#c98500" },
  otro: { nombre: "Otros", color: "#9085e9" },
};

// Colores para el reparto "por valor" (en este orden, nunca al azar)
export const COLORES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
