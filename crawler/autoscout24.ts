// Descarga una página de resultados de AutoScout24 España y devuelve los
// anuncios crudos del __NEXT_DATA__ (mismo formato que usa scrapeAutoScout24
// en server.ts) más el total de resultados del segmento.
import axios from "axios";
import { normalizeAs24Listing } from "./normalize.js";
import { BlockedError, type PortalAdapter, type SearchPage } from "./portal.js";
import type { PriceBand } from "./segments.js";

export { BlockedError, type SearchPage } from "./portal.js";

const BASE_URL = "https://www.autoscout24.es";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
};

export function searchUrl(slug: string, band: PriceBand, page: number): string {
  // cy=E: solo España; atype=C: turismos; ustate=N,U: nuevos y usados.
  // Tramo [lo, hi): priceto = hi − 1 para que dos tramos no compartan anuncios.
  const qp = new URLSearchParams({ atype: "C", cy: "E", ustate: "N,U", sort: "price", desc: "0", pricefrom: String(band.lo) });
  if (band.hi !== null) qp.set("priceto", String(band.hi - 1));
  if (page > 1) qp.set("page", String(page));
  return `${BASE_URL}/lst/${slug}?${qp}`;
}

export async function fetchSearchPage(slug: string, band: PriceBand, page: number): Promise<SearchPage> {
  const url = searchUrl(slug, band, page);
  // Sin seguir redirecciones: un slug que redirige pierde los filtros de la
  // URL (precio) y el segmento dejaría de ser lo que dice ser.
  const res = await axios.get<string>(url, {
    headers: HEADERS, timeout: 20000, maxRedirects: 0, responseType: "text", validateStatus: () => true,
  });
  if (res.status === 403 || res.status === 429) throw new BlockedError(`HTTP ${res.status} en ${url}`);
  if (res.status >= 300 && res.status < 400) throw new Error(`El slug redirige (${res.status} → ${res.headers.location ?? "?"})`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} en ${url}`);

  const m = res.data.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new BlockedError(`Página sin __NEXT_DATA__ (¿captcha?) en ${url}`);
  const pageProps = JSON.parse(m[1])?.props?.pageProps;
  const numberOfResults = Number(pageProps?.numberOfResults);
  if (!Number.isFinite(numberOfResults)) throw new Error(`Sin numberOfResults en ${url}`);
  return { numberOfResults, listings: Array.isArray(pageProps?.listings) ? pageProps.listings : [] };
}

export const autoscout24: PortalAdapter = {
  id: "autoscout24",
  pageSize: 20,
  maxPages: 50,                 // AutoScout24 sirve hasta 50 páginas (verificado oct. 2026)
  maxResultsPerSegment: 400,    // 20 páginas de 20 anuncios
  minDelayMs: 1500,
  maxDelayMs: 4000,
  rotateModels: false,
  blockPauseMs: 0,
  slugFor: (model) => model.slug,
  searchUrl,
  fetchSearchPage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listingId: (it: any) => (typeof it?.id === "string" ? it.id : null),
  normalize: normalizeAs24Listing,
};
