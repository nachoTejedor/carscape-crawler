// Flexicar: concesionario con su propio stock. Su web pide los coches a una
// API JSON (services.flexicar.es/api/v1/vehicles) con los mismos filtros que la
// búsqueda: marca, modelo y precio, paginada de 24 en 24 y con el total.
// El filtro de precio va sobre su precio financiado ("price"); el precio que se
// guarda es el de contado ("cashPrice"), el comparable con los demás portales.
import axios from "axios";
import { isJunkOrDamagedListing } from "../lib/listingQuality.js";
import { MIN_PRICE_EUR, normalizeFuel, normalizeTransmission, toInt, versionDesdeTitulo, type ListingRow } from "./normalize.js";
import { BlockedError, esElModelo, slugify, type PortalAdapter, type SearchPage } from "./portal.js";
import { provinciaDesdeNombre } from "./provincias.js";
import type { CrawlModel, PriceBand } from "./segments.js";

const API_URL = "https://services.flexicar.es/api/v1/vehicles";
const PAGE_SIZE = 24;   // la API rechaza más de 24
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Origin": "https://www.flexicar.es",
  "Referer": "https://www.flexicar.es/",
};

// "seat/leon", "bmw/serie-1" (se comprueba con --probar)
export function flexicarSlug(model: CrawlModel): string {
  return model.fxSlug ?? `${slugify(model.marca, "-")}/${slugify(model.modelo, "-").replace(/\./g, "-")}`;
}

export function searchUrl(slug: string, band: PriceBand, page: number): string {
  const [brand, model] = slug.split("/");
  const qp = new URLSearchParams({ brands: brand, models: model, priceFrom: String(band.lo) });
  if (band.hi !== null) qp.set("priceTo", String(band.hi - 1));
  qp.set("page", String(page));
  qp.set("size", String(PAGE_SIZE));
  return `${API_URL}?${qp}`;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeFlexicarListing(it: any, model: CrawlModel, crawlSegment: string): ListingRow | null {
  const id = it?.id !== undefined && it?.id !== null ? String(it.id) : null;
  if (!id || !/^\d+$/.test(id)) return null;
  // Un slug mal resuelto puede traer otros modelos de la marca
  if (!esElModelo(it.model, model)) return null;
  const precio = toInt(it.cashPrice) || toInt(it.price);
  if (!precio || precio < MIN_PRICE_EUR) return null;
  const titulo = [it.brand, it.model, it.version].filter(Boolean).join(" ");
  if (isJunkOrDamagedListing(titulo)) return null;
  if (typeof it.slug !== "string" || !it.slug) return null;
  const version = versionDesdeTitulo(String(it.version ?? ""), model.marca, model.modelo);
  const anio = toInt(it.year);
  // El concesionario viene como "Ciudad - Zona": vale si la ciudad es capital de provincia
  const ciudad = String(it.carDealership ?? "").split(" - ")[0];
  return {
    portal: "flexicar",
    portal_id: id,
    url: `https://www.flexicar.es/coches-ocasion/${it.slug}/`,
    crawl_segment: crawlSegment,
    marca: model.marca,
    modelo: model.modelo,
    version,
    combustible: normalizeFuel(it.fuel, version ?? ""),
    anio: anio && anio >= 1950 && anio <= new Date().getFullYear() + 1 ? anio : null,
    mes: null,
    km: toInt(it.km),
    potencia_cv: null,
    cambio: normalizeTransmission(it.transmission),
    provincia: provinciaDesdeNombre(ciudad),
    vendedor: "Profesional",
    tipo_oferta: null,
    precio,
  };
}

async function fetchSearchPage(slug: string, band: PriceBand, page: number): Promise<SearchPage> {
  const url = searchUrl(slug, band, page);
  const res = await axios.get(url, { headers: HEADERS, timeout: 20000, maxRedirects: 0, validateStatus: () => true });
  if (res.status === 403 || res.status === 429) throw new BlockedError(`HTTP ${res.status} en ${url}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} en ${url}`);
  const data = res.data as { results?: unknown; total?: unknown; pages?: unknown };
  const total = Number(data?.total);
  if (!Array.isArray(data?.results) || !Number.isFinite(total)) throw new BlockedError(`Respuesta sin resultados reconocibles en ${url}`);
  const pages = Number(data.pages);
  return { numberOfResults: total, numberOfPages: Number.isFinite(pages) && pages > 0 ? pages : null, listings: data.results };
}

export const flexicar: PortalAdapter = {
  id: "flexicar",
  pageSize: PAGE_SIZE,
  maxPages: 100,
  maxResultsPerSegment: 400,
  minDelayMs: 1500,
  maxDelayMs: 4000,
  rotateModels: false,
  blockPauseMs: 0,
  slugFor: flexicarSlug,
  searchUrl,
  fetchSearchPage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listingId: (it: any) => (it?.id !== undefined && it?.id !== null ? String(it.id) : null),
  normalize: normalizeFlexicarListing,
};
