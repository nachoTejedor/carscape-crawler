// coches.net: los resultados vienen embebidos en el HTML de la búsqueda
// (lib/cochesnetPage.ts). Su anti-bot bloquea las IPs de servidores (Oracle,
// Vercel) y a quien pide páginas muy seguidas. Se rastrea en el servidor igualmente,
// como intento diario "a lo que deje": despacio (20-40 s entre páginas), y si
// sale el muro se espera y se sigue; tres muros seguidos paran ese día.
import axios from "axios";
import { isJunkOrDamagedListing } from "../lib/listingQuality.js";
import { extractAdevintaResults, isAdevintaBotWall } from "../lib/cochesnetPage.js";
import { MIN_PRICE_EUR, normalizeFuel, toInt, versionDesdeTitulo, type ListingRow } from "./normalize.js";
import { BlockedError, esElModelo, slugify, type PortalAdapter, type SearchPage } from "./portal.js";
import { provinciaDesdeNombre } from "./provincias.js";
import type { CrawlModel, PriceBand } from "./segments.js";

const BASE_URL = "https://www.coches.net";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Referer": "https://www.coches.net/",
};

// coches.net separa las palabras con guion bajo (/bmw/serie_3/, /mercedes-benz/clase_a/).
// Con un modelo mal escrito no da error: devuelve TODA la marca. Por eso
// normalize() descarta los anuncios de otro modelo y --probar lo comprueba.
export function cochesnetSlug(model: CrawlModel): string {
  return model.cnSlug ?? `${slugify(model.marca, "-")}/${slugify(model.modelo, "_")}`;
}

// Tramo [lo, hi): MaxPrice = hi − 1, como en los otros portales
export function searchUrl(slug: string, band: PriceBand, page: number): string {
  const qp = new URLSearchParams({ MinPrice: String(band.lo) });
  if (band.hi !== null) qp.set("MaxPrice", String(band.hi - 1));
  if (page > 1) qp.set("pg", String(page));
  return `${BASE_URL}/${slug}/segunda-mano/?${qp}`;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeCochesnetListing(it: any, model: CrawlModel, crawlSegment: string): ListingRow | null {
  const portalId = it?.id !== undefined && it?.id !== null ? String(it.id) : null;
  if (!portalId || !/^\d+$/.test(portalId)) return null;
  // Slug mal resuelto o anuncio colado de otro modelo: fuera
  if (!esElModelo(it.model, model)) return null;
  const precio = toInt(it.price);
  if (!precio || precio < MIN_PRICE_EUR) return null;
  const titulo = String(it.title ?? "").trim();
  if (isJunkOrDamagedListing(titulo)) return null;
  const path = typeof it.url === "string" ? it.url : "";
  if (!path) return null;
  const version = versionDesdeTitulo(titulo, String(it.make ?? model.marca), String(it.model ?? model.modelo));
  const anio = toInt(it.year);
  const hp = toInt(it.hp);
  return {
    portal: "cochesnet",
    portal_id: portalId,
    url: path.startsWith("http") ? path : `${BASE_URL}${path}`,
    crawl_segment: crawlSegment,
    marca: model.marca,
    modelo: model.modelo,
    version,
    combustible: normalizeFuel(it.fuelType, version ?? ""),
    anio: anio && anio >= 1950 && anio <= new Date().getFullYear() + 1 ? anio : null,
    mes: null,
    km: toInt(it.km),
    potencia_cv: hp && hp > 0 && hp < 2000 ? hp : null,
    cambio: null,   // el listado no lo trae
    provincia: provinciaDesdeNombre(it.location?.mainProvince),
    vendedor: it.isProfessional === true ? "Profesional" : it.isProfessional === false ? "Particular" : null,
    tipo_oferta: typeof it.offerType?.literal === "string" ? it.offerType.literal : null,
    precio,
  };
}

async function fetchSearchPage(slug: string, band: PriceBand, page: number): Promise<SearchPage> {
  const url = searchUrl(slug, band, page);
  const res = await axios.get<string>(url, {
    headers: HEADERS, timeout: 25000, maxRedirects: 0, responseType: "text", validateStatus: () => true,
  });
  if (res.status === 403 || res.status === 429) throw new BlockedError(`HTTP ${res.status} en ${url}`);
  if (res.status >= 300 && res.status < 400) throw new Error(`El slug redirige (${res.status} → ${res.headers.location ?? "?"})`);
  if (res.status === 404) throw new Error(`El slug no existe en coches.net (404): ${url}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} en ${url}`);
  if (isAdevintaBotWall(res.data)) throw new BlockedError(`Muro anti-bot de coches.net en ${url}`);
  const found = extractAdevintaResults(res.data);
  if (!found) throw new BlockedError(`Página sin resultados reconocibles en ${url}`);
  return { numberOfResults: found.totalResults, numberOfPages: found.totalPages, listings: found.items };
}

export const cochesnet: PortalAdapter = {
  id: "cochesnet",
  pageSize: 30,
  maxPages: 60,
  maxResultsPerSegment: 600,
  minDelayMs: 20_000,
  maxDelayMs: 40_000,
  rotateModels: true,
  blockPauseMs: 15 * 60_000,   // el muro de coches.net se levanta tras un rato sin pedir nada
  slugFor: cochesnetSlug,
  searchUrl,
  fetchSearchPage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listingId: (it: any) => (it?.id !== undefined && it?.id !== null ? String(it.id) : null),
  normalize: normalizeCochesnetListing,
};
