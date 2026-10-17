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
export const FESTIVOS_EXTRA = [];

// ¿Es festivo el Jueves Santo donde vives? (lo es en casi toda España salvo Cataluña y Valencia)
export const JUEVES_SANTO = true;
