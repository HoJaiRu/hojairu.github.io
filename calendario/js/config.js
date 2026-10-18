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
  // Días antes de un cumpleaños en los que aparece en la cuenta atrás
  diasCumpleCuentaAtras: 10,
};

// Categorías: el color de cada nota. Puedes cambiar nombres y colores, o añadir más.
// El "id" no lo cambies una vez usado (es lo que se guarda en cada nota).
export const CATEGORIAS = [
  { id: "clase",      nombre: "Clase",      color: "#6c8cff" },
  { id: "trabajo",    nombre: "Trabajo",    color: "#f5a524" },
  { id: "personal",   nombre: "Personal",   color: "#34c77b" },
  { id: "importante", nombre: "Importante", color: "#ff5c6c" },
  { id: "cumple",     nombre: "Cumpleaños", color: "#ff7ac6" },   // se repite cada año
  { id: "otro",       nombre: "Otro",       color: "#b07cff" },
];

// Festivos extra de tu comunidad o tu ciudad (los nacionales ya salen solos).
// Formato: "MM-DD" para los que caen cada año en el mismo día,
// o "AAAA-MM-DD" para uno concreto.
export const FESTIVOS_EXTRA = [
  { fecha: "04-23", nombre: "Fiesta de Castilla y León" },
  // Cuando un festivo nacional cae en domingo, la Junta lo pasa al lunes (cambia cada año)
  { fecha: "2026-11-02", nombre: "Todos los Santos (trasladado)" },
  { fecha: "2026-12-07", nombre: "Día de la Constitución (trasladado)" },
];

// ¿Es festivo el Jueves Santo donde vives? (en Castilla y León, sí)
export const JUEVES_SANTO = true;

// Calendario escolar de Educacyl (Junta de Castilla y León), curso 2026-2027.
// Fuente: https://www.educa.jcyl.es/es/informacion/calendario-escolar-2026-2027
// Para el curso siguiente: cambia las fechas por las del nuevo calendario.
export const CURSO = {
  nombre: "2º ASIR",
  inicio: "2026-09-09",   // 2º de grado superior de FP presencial
  fin: "2027-06-17",      // fin de clases de ciclos formativos de FP
  noLectivos: [
    { desde: "2026-10-30", nombre: "Día del Docente" },
    { desde: "2026-11-02", nombre: "Todos los Santos (trasladado)" },
    { desde: "2026-12-07", nombre: "Día de la Constitución (trasladado)" },
    { desde: "2026-12-23", hasta: "2027-01-10", nombre: "Vacaciones de Navidad" },
    { desde: "2027-02-08", hasta: "2027-02-09", nombre: "Carnaval" },
    { desde: "2027-03-20", hasta: "2027-03-30", nombre: "Vacaciones de Semana Santa" },
  ],
};
