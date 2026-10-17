// config.js - Ajustes del calendario. Es el archivo pensado para tocarlo a mano.

export const CONFIG = {
  // Tu nombre para el saludo de la tarjeta "Hoy" (vacío = sin nombre)
  nombre: "",

  // Dónde se guardan tus notas en GitHub (repositorio PRIVADO)
  github: {
    owner: "HoJaiRu",
    repo: "WEBS",
    rama: "main",
    ruta: "calendario/notas.json",
  },

  // Días hacia delante en los que buscar notas destacadas para la cuenta atrás
  diasCuentaAtras: 90,
};

// Categorías: el color de cada nota. Puedes cambiar nombres y colores, o añadir más.
// El "id" no lo cambies una vez usado (es lo que se guarda en cada nota).
export const CATEGORIAS = [
  { id: "clase",      nombre: "Clase",      color: "#6c8cff" },
  { id: "trabajo",    nombre: "Trabajo",    color: "#f5a524" },
  { id: "personal",   nombre: "Personal",   color: "#34c77b" },
  { id: "importante", nombre: "Importante", color: "#ff5c6c" },
  { id: "otro",       nombre: "Otro",       color: "#b07cff" },
];

// Festivos extra de tu comunidad o tu ciudad (los nacionales ya salen solos).
// Formato: "MM-DD" para los que caen cada año en el mismo día,
// o "AAAA-MM-DD" para uno concreto. Ejemplo:
//   { fecha: "05-02", nombre: "Día de la Comunidad de Madrid" },
//   { fecha: "2026-05-15", nombre: "San Isidro" },
export const FESTIVOS_EXTRA = [
  // Castilla y León
  { fecha: "04-23", nombre: "Fiesta de Castilla y León" },
  // Cuando un festivo nacional cae en domingo, la Junta lo pasa al lunes (cambia cada año)
  { fecha: "2026-11-02", nombre: "Todos los Santos (trasladado)" },
  { fecha: "2026-12-07", nombre: "Día de la Constitución (trasladado)" },
];

// ¿Es festivo el Jueves Santo donde vives? (en Castilla y León, sí)
export const JUEVES_SANTO = true;
