// Coches.com: los resultados vienen en el __NEXT_DATA__ de la búsqueda
// (pageProps.classifieds: total y 20 anuncios por página). Filtra por precio
// con ?precio_desde=&precio_hasta= y pagina con ?page=N (verificado en vivo).
import axios from "axios";
import { isJunkOrDamagedListing } from "../lib/listingQuality.js";
import { MIN_PRICE_EUR, normalizeFuel, normalizeTransmission, toInt, versionDesdeTitulo, type ListingRow } from "./normalize.js";
import { BlockedError, esElModelo, slugify, type PortalAdapter, type SearchPage } from "./portal.js";
import { provinciaDesdeCp, provinciaDesdeNombre } from "./provincias.js";
import type { CrawlModel, PriceBand } from "./segments.js";

const BASE_URL = "https://www.coches.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
};

// "seat-leon", "bmw-serie-1" (se comprueba con --probar)
export function cochescomSlug(model: CrawlModel): string {
  return model.ccSlug ?? slugify(`${model.marca} ${model.modelo}`, "-").replace(/\./g, "-");
}

// Tramo [lo, hi): precio_hasta = hi − 1
export function searchUrl(slug: string, band: PriceBand, page: number): string {
  const qp = new URLSearchParams({ precio_desde: String(band.lo) });
  if (band.hi !== null) qp.set("precio_hasta", String(band.hi - 1));
  if (page > 1) qp.set("page", String(page));
  return `${BASE_URL}/coches-segunda-mano/${slug}.htm?${qp}`;
}

// Página → total + anuncios, cada uno con su enlace (el que pinta la propia página)
export function parseCochescomPage(html: string): { total: number; items: unknown[] } {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new BlockedError("Página sin __NEXT_DATA__");
  let classifieds: { total?: unknown; classifiedList?: unknown } | undefined;
  try {
    classifieds = JSON.parse(m[1])?.props?.pageProps?.classifieds;
  } catch {
    throw new BlockedError("__NEXT_DATA__ ilegible");
  }
  const total = Number(classifieds?.total);
  if (!Number.isFinite(total) || !Array.isArray(classifieds?.classifiedList)) throw new BlockedError("Página sin anuncios reconocibles");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (classifieds.classifiedList as any[]).map((it) => {
    const vid = typeof it?.visibleId === "string" && /^[A-Za-z0-9_-]+$/.test(it.visibleId) ? it.visibleId : null;
    const href = vid ? html.match(new RegExp(`href="(${BASE_URL}/coches-segunda-mano/[^"?]+\\.htm\\?id=${vid})"`))?.[1] : null;
    return { ...it, _url: href ?? null };
  });
  return { total, items };
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeCochescomListing(it: any, model: CrawlModel, crawlSegment: string): ListingRow | null {
  const id = typeof it?.id === "string" && it.id ? it.id : null;
  if (!id || typeof it._url !== "string" || !it._url) return null;
  if (!esElModelo(it.model?.name, model)) return null;
  const precio = toInt(it.priceOffer?.amount) || toInt(it.price?.amount);
  if (!precio || precio < MIN_PRICE_EUR) return null;
  const versionTxt = String(it.version?.name ?? "");
  const titulo = `${it.make?.name ?? ""} ${it.model?.name ?? ""} ${versionTxt}`;
  if (isJunkOrDamagedListing(titulo)) return null;
  const version = versionDesdeTitulo(versionTxt, model.marca, model.modelo);
  const anio = toInt(it.registration?.year);
  const mes = toInt(it.registration?.month);
  const cv = toInt(it.engine?.powerCv);
  const provId = String(it.currentProvince?.id ?? "");
  return {
    portal: "cochescom",
    portal_id: id,
    url: it._url,
    crawl_segment: crawlSegment,
    marca: model.marca,
    modelo: model.modelo,
    version,
    combustible: normalizeFuel(it.fuel?.name, version ?? ""),
    anio: anio && anio >= 1950 && anio <= new Date().getFullYear() + 1 ? anio : null,
    mes: mes && mes >= 1 && mes <= 12 ? mes : null,
    km: toInt(it.mileage?.amount),
    potencia_cv: cv && cv > 0 && cv < 2000 ? cv : null,
    cambio: normalizeTransmission(it.transmission?.name),
    provincia: provinciaDesdeNombre(it.currentProvince?.name) ?? (/^\d{1,2}$/.test(provId) ? provinciaDesdeCp(`${provId.padStart(2, "0")}000`) : null),
    vendedor: it.dealerId ? "Profesional" : "Particular",
    tipo_oferta: it.isKm0 ? "Km 0" : null,
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
  if (res.status === 404) throw new Error(`El slug no existe en Coches.com (404): ${url}`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} en ${url}`);
  const { total, items } = parseCochescomPage(res.data);
  return { numberOfResults: total, listings: items };
}

export const cochescom: PortalAdapter = {
  id: "cochescom",
  pageSize: 20,
  maxPages: 50,
  maxResultsPerSegment: 400,
  minDelayMs: 1500,
  maxDelayMs: 4000,
  rotateModels: false,
  blockPauseMs: 0,
  slugFor: cochescomSlug,
  searchUrl,
  fetchSearchPage,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listingId: (it: any) => (typeof it?.id === "string" ? it.id : null),
  normalize: normalizeCochescomListing,
};
