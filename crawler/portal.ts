// Contrato de cada portal del crawler diario. run.ts recorre los segmentos
// (modelo × tramo de precio) igual para todos; cada portal pone cómo se pide
// una página de resultados, cómo se lee y cómo se pasa a market.listings.
import type { ListingRow } from "./normalize.js";
import type { CrawlModel, PriceBand } from "./segments.js";

export interface SearchPage {
  numberOfResults: number;
  // Páginas que dice tener el portal (si lo dice); si no, se calculan con pageSize
  numberOfPages?: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listings: any[];
}

// Bloqueo o límite del portal: el crawler para ese portal en vez de insistir.
export class BlockedError extends Error {}

export interface PortalAdapter {
  id: "autoscout24" | "autocasion" | "cochesnet" | "flexicar" | "ocasionplus" | "cochescom";
  pageSize: number;
  maxPages: number;
  maxResultsPerSegment: number;
  // Pausa entre peticiones (ms). Se puede cambiar con CRAWLER_MIN_DELAY_MS / CRAWLER_MAX_DELAY_MS.
  minDelayMs: number;
  maxDelayMs: number;
  // Si un día no da tiempo a todos los modelos, empezar cada día por uno distinto
  rotateModels: boolean;
  // Tras un bloqueo, esperar esto antes de seguir (0 = seguir sin esperar)
  blockPauseMs: number;
  // El portal no filtra por precio: cada modelo es un único segmento (0 € - sin tope)
  singleBand?: boolean;
  slugFor(model: CrawlModel): string;
  searchUrl(slug: string, band: PriceBand, page: number): string;
  fetchSearchPage(slug: string, band: PriceBand, page: number): Promise<SearchPage>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listingId(item: any): string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  normalize(item: any, model: CrawlModel, crawlSegment: string): ListingRow | null;
}

// Minúsculas, sin tildes ni signos, palabras separadas por `sep`
export function slugify(s: string, sep: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, " ").trim().replace(/\s+/g, sep);
}

const soloLetrasYNumeros = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// ¿El anuncio es de este modelo? Compara sin tildes, mayúsculas ni signos con
// el nombre del modelo y sus alias ("Clase GLC" para el GLC, "Q4" para el Q4
// e-tron…). Evita que un slug mal resuelto meta otros modelos de la marca.
export function esElModelo(nombre: unknown, model: CrawlModel): boolean {
  const n = soloLetrasYNumeros(nombre);
  return !!n && [model.modelo, ...(model.alias ?? [])].some((m) => soloLetrasYNumeros(m) === n);
}
