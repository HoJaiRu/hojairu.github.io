// github.js - Hablar con tu repositorio privado (WEBS) usando tu llave de GitHub.
// La llave es la misma que usan el Vigilante de precios y el Calendario (mismo sitio web),
// así que si ya la pegaste allí, aquí ya funciona.

import { CONFIG } from "./config.js";

const CLAVE_LLAVE = "vigilante-precios.token";
const { owner, repo } = CONFIG.github;
export const API_REPO = `https://api.github.com/repos/${owner}/${repo}`;

let llave = leerLlave();

function leerLlave() { try { return localStorage.getItem(CLAVE_LLAVE) || ""; } catch { return ""; } }
export const tieneLlave = () => !!llave;
export const llaveActual = () => llave;
export function ponerLlave(nueva) {
  llave = nueva;
  try { nueva ? localStorage.setItem(CLAVE_LLAVE, nueva) : localStorage.removeItem(CLAVE_LLAVE); } catch {}
}

export class ErrorGitHub extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

// Petición a la API. Devuelve { datos, etag, status }. status 304 = "no ha cambiado nada".
export async function gh(metodo, url, { cuerpo, aceptar, etag } = {}) {
  let r;
  try {
    r = await fetch(url, {
      method: metodo,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${llave}`,
        Accept: aceptar || "application/vnd.github+json",
        ...(etag ? { "If-None-Match": etag } : {}),
        ...(cuerpo ? { "Content-Type": "application/json" } : {}),
      },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorGitHub("Sin conexión con GitHub", 0);
  }
  if (r.status === 304) return { datos: null, etag, status: 304 };
  const texto = await r.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
  if (!r.ok) {
    const msg = {
      401: "La llave no es válida o ha caducado",
      403: "La llave no tiene permiso para esto (revisa Contents y Actions: Read and write)",
      404: `No encuentro el archivo, o la llave no tiene acceso al repositorio ${repo}`,
    }[r.status] || `GitHub respondió con un error (${r.status})`;
    throw new ErrorGitHub(msg, r.status);
  }
  return { datos, etag: r.headers.get("ETag"), status: r.status };
}

export const deB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
export function aB64(texto) {
  let binario = "";
  for (const b of new TextEncoder().encode(texto)) binario += String.fromCharCode(b);
  return btoa(binario);
}
