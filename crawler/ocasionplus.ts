// OcasionPlus: concesionario con su propio stock. Su web pide los coches a una
// API JSON (zeus.ocasionplus.com/vehicles/search/CAR), 20 por página, con el
// total. No hemos encontrado filtro de precio en esa API, así que cada modelo
// es un único segmento (pocos cientos de coches por modelo).
import axios from "axios";
import { isJunkOrDamagedListing } from "../lib/listingQuality.js";
import { MIN_PRICE_EUR, normalizeFuel, normalizeTransmission, parseRegistration, toInt, versionDesdeTitulo, type ListingRow } from "./normalize.js";
import { BlockedError, esElModelo, type PortalAdapter, type SearchPage } from "./portal.js";
import { provinciaDesdeCp, provinciaDesdeNombre } from "./provincias.js";
import type { CrawlModel, PriceBand } from "./segments.js";

const API_URL = "https://zeus.ocasionplus.com/vehicles/search/CAR";
const BASE_URL = "https://www.ocasionplus.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Origin": BASE_URL,
  "Referer": `${BASE_URL}/`,
};

// "Seat/León": marca y modelo como los escribe su web (la API los pide así,
// unidos por "_": model=Seat_León). Se comprueba con --probar.
export function ocasionplusSlug(model: CrawlModel): string {
  return model.opName ?? `${model.marca}_${model.modelo}`;
}

// El tramo de precio no se usa (singleBand): siempre el modelo entero
export function searchUrl(slug: string, _band: PriceBand, page: number): string {
  const brand = slug.split("_")[0];
  const qp = new URLSearchParams({ orderBy: "morePopular", brand, model: slug, searchType: "organic", page: String(page) });
  return `${API_URL}?${qp}`;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeOcasionplusListing(it: any, model: CrawlModel, crawlSegment: string): ListingRow | null {
  const id = typeof it?.id === "string" && it.id ? it.id : null;
  if (!id) return null;
  if (!esElModelo(it.model, model)) return null;
  if (it.type && it.type !== "CAR") return null;
  const precio = toInt(it.price?.cash) || toInt(it.price?.withoutFinancing);
  if (!precio || precio < MIN_PRICE_EUR) return null;
  const titulo = String(it.description?.short ?? `${it.brand ?? ""} ${it.model ?? ""}`);
  if (isJunkOrDamagedListing(titulo)) return null;
  if (typeof it.slug !== "string" || !it.slug) return null;
  const version = versionDesdeTitulo(titulo, String(it.brand ?? model.marca), String(it.model ?? model.modelo));
  const { anio, mes } = parseRegistration(String(it.characteristics?.registrationDate ?? "").slice(0, 7).split("-").reverse().join("-"));
  const engine = it.characteristics?.engine ?? {};
  const cv = toInt(engine.cv);
  const cambio = /^auto/i.test(String(engine.transmission ?? "")) ? "Automático" : normalizeTransmission(engine.transmission);
  return {
    portal: "ocasionplus",
    portal_id: id,
    url: `${BASE_URL}/coches-segunda-mano/${it.slug}`,
    crawl_segment: crawlSegment,
    marca: model.marca,
    modelo: model.modelo,
    version,
    combustible: normalizeFuel(engine.fuel, version ?? ""),
    anio: anio && anio >= 1950 && anio <= new Date().getFullYear() + 1 ? anio : null,
    mes,
    km: toInt(it.characteristics?.kms),
    potencia_cv: cv && cv > 0 && cv < 2000 ? cv : null,
    cambio,
    provincia: provinciaDesdeNombre(it.dealer?.province) ?? provinciaDesdeCp(it.dealer?.zip),
    vendedor: "Profesional",
    tipo_oferta: typeof it.condition === "string" ? it.condition : null,
    precio,
  };
}

async function fetchSearchPage(slug: string, band: PriceBand, page: number): Promise<SearchPage> {
  const url = searchUrl(slug, band, page);
  const res = await axios.get(url, { headers: HEADERS, timeout: 20000, maxRedirects: 0, validateStatus: () => true });
  if (res.status === 403 || res.status === 429) throw new BlockedError(`HTTP ${res.status} en ${url}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} en ${url}`);
  const data = res.data as { data?: unknown; page?: { total?: unknown; totalSize?: unknown } };
  const total = Number(data?.page?.totalSize);
  if (!Array.isArray(data?.data) || !Number.isFinite(total)) throw new BlockedError(`Respuesta sin resultados reconocibles en ${url}`);
  const pages = Number(data.page?.total);
  return { numberOfResults: total, numberOfPages: Number.isFinite(pages) && pages > 0 ? pages : null, listings: data.data };
}

export const ocasionplus: PortalAdapter = {
  id: "ocasionplus",
  pageSize: 20,
  maxPages: 150,
  maxResultsPerSegment: Number.POSITIVE_INFINITY,   // sin filtro de precio: no se parte
  minDelayMs: 1500,
  maxDelayMs: 4000,
  rotateModels: false,
  blockPauseMs: 0,
  singleBand: true,
  slugFor: ocasionplusSlug,
  searchUrl,
  fetchSearchPage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listingId: (it: any) => (typeof it?.id === "string" ? it.id : null),
  normalize: normalizeOcasionplusListing,
};
