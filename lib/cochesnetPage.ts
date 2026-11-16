// Lee los resultados de una página de búsqueda de coches.net (y de Milanuncios,
// que es de la misma casa, Adevinta). Función pura: sin red. La usan el
// buscador (server.ts) y el crawler diario (crawler/cochesnet.ts).
//
// coches.net ha cambiado de formato: antes los resultados venían en
// window.__INITIAL_PROPS__ (initialResults); desde nov. 2026 vienen en
// window.__staticRouterHydrationData, dentro de loaderData["<ruta>"].initialResults.
// Se aceptan los dos.

export interface PortalSearchResults {
  totalResults: number;
  totalPages: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[];
}

const MARKERS = ["window.__staticRouterHydrationData = JSON.parse(", "window.__INITIAL_PROPS__ = JSON.parse("];
const MAX_DEPTH = 6;

export const isAdevintaBotWall = (html: string): boolean =>
  html.includes("nos hizo pensar que eres un bot") || html.includes("Ups! Parece que algo no va bien");

// window.X = JSON.parse("…"): el argumento es una cadena JS con el JSON escapado
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseEmbeddedJson(html: string, marker: string): any | null {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const after = html.substring(at + marker.length);
  const start = after.indexOf('"');
  if (start < 0) return null;
  let pos = start + 1;
  let escaped = false;
  while (pos < after.length) {
    const c = after[pos];
    if (escaped) escaped = false;
    else if (c === "\\") escaped = true;
    else if (c === '"') break;
    pos++;
  }
  try {
    return JSON.parse(JSON.parse(after.substring(start, pos + 1)));
  } catch {
    return null;
  }
}

// Busca el primer objeto { items: [...], totalResults } a poca profundidad
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findResults(node: any, depth: number): PortalSearchResults | null {
  if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
  if (Array.isArray(node.items) && Number.isFinite(Number(node.totalResults))) {
    const pages = Number(node.totalPages);
    return { totalResults: Number(node.totalResults), totalPages: Number.isFinite(pages) && pages > 0 ? pages : null, items: node.items };
  }
  if (node.initialResults) return findResults(node.initialResults, depth + 1);
  for (const value of Object.values(node)) {
    const found = findResults(value, depth + 1);
    if (found) return found;
  }
  return null;
}

// null: la página no trae resultados reconocibles (muro anti-bot o cambio de formato)
export function extractAdevintaResults(html: string): PortalSearchResults | null {
  for (const marker of MARKERS) {
    const data = parseEmbeddedJson(html, marker);
    if (!data) continue;
    const found = findResults(data.loaderData ?? data, 0);
    if (found) return found;
  }
  return null;
}
