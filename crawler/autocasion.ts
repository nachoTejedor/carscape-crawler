// Autocasión: páginas de resultados en HTML (servidor PHP), 25 anuncios por
// página. Cada anuncio real viene en el JSON-LD de la página (Product → Car:
// id, precio, km, año, cambio, potencia) y en su tarjeta (combustible,
// provincia, si es de concesionario). Cuando no hay resultados la página
// enseña coches "sugeridos" en tarjetas pero sin JSON-LD: por eso los
// anuncios salen del JSON-LD y el total del título (<h1>184 Seat León…</h1>).
import axios from "axios";
import * as cheerio from "cheerio";
import { isJunkOrDamagedListing } from "../lib/listingQuality.js";
import {
  MIN_PRICE_EUR, normalizeFuel, normalizeTransmission, toInt, versionDesdeTitulo, type ListingRow,
} from "./normalize.js";
import { BlockedError, slugify, type PortalAdapter, type SearchPage } from "./portal.js";
import { provinciaDesdeNombre } from "./provincias.js";
import type { CrawlModel, PriceBand } from "./segments.js";

const BASE_URL = "https://www.autocasion.com";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "Referer": "https://www.autocasion.com/",
};

export interface AutocasionItem {
  id: string;
  url: string;
  titulo: string;          // de la tarjeta: "SEAT León ST 2.0TDI CR S&S Reference 115"
  precio: number | null;
  km: number | null;
  anio: number | null;
  cambio: string | null;
  cv: number | null;
  combustible: string | null;
  provincia: string | null;
  profesional: boolean | null;
}

// "seat-leon", "volkswagen-t-roc", "bmw-serie-1" (se comprueba con --probar)
export function autocasionSlug(model: CrawlModel): string {
  return model.acSlug ?? slugify(`${model.marca} ${model.modelo}`, "-").replace(/\./g, "-");
}

// Tramo [lo, hi): precio-hasta = hi − 1. Los filtros van como tramos de ruta y
// en este orden (verificado en vivo): /precio-desde-X/precio-hasta-Y
export function searchUrl(slug: string, band: PriceBand, page: number): string {
  const precio = `/precio-desde-${band.lo}${band.hi !== null ? `/precio-hasta-${band.hi - 1}` : ""}`;
  return `${BASE_URL}/coches-segunda-mano/${slug}-ocasion${precio}${page > 1 ? `?page=${page}` : ""}`;
}

const refId = (href: string | undefined): string | null => href?.match(/-ref(\d+)(?:[/?#]|$)/)?.[1] ?? null;

// Página de resultados → total + anuncios. Lanza BlockedError si no es una
// página de resultados reconocible (bloqueo, captcha o cambio de formato).
export function parseAutocasionPage(html: string): { total: number; items: AutocasionItem[] } {
  const $ = cheerio.load(html);
  const h1 = $("h1").first().text().replace(/\s+/g, " ").trim();
  const totalMatch = h1.match(/^([\d.]+)\s/);
  if (!totalMatch) throw new BlockedError(`Página sin recuento de anuncios ("${h1.slice(0, 60)}")`);
  const total = Number(totalMatch[1].replace(/\./g, ""));

  // Datos de las tarjetas por id: combustible, provincia, concesionario
  const tarjetas = new Map<string, { titulo: string; combustible: string | null; provincia: string | null; profesional: boolean }>();
  $("article.anuncio").each((_, el) => {
    const card = $(el);
    const id = refId(card.find("a[href*='-ref']").first().attr("href")) ?? card.find("[data-ad]").first().attr("data-ad") ?? null;
    if (!id) return;
    // <li>2021</li><li>Diésel</li><li>80.058 km</li><li>Ciudad Real</li>[<li class="municipio">…</li>]
    const lis = card.find("ul.supplementary li:not(.municipio)").map((__, li) => $(li).text().trim()).get();
    const kmAt = lis.findIndex((t) => /^\d[\d.]*\s*km$/i.test(t));
    const provincia = kmAt >= 0 ? lis[kmAt + 1] ?? null : null;
    const combustible = lis.find((t) => /^(gasolina|di[eé]sel|el[eé]ctrico|h[ií]brido.*|glp|gnc|gas)$/i.test(t)) ?? null;
    tarjetas.set(id, {
      titulo: card.find("h2").first().text().replace(/\s+/g, " ").trim(),
      combustible,
      provincia: provincia || null,
      profesional: /\bcon-concesionario\b/.test(card.attr("class") ?? ""),
    });
  });

  const items: AutocasionItem[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown;
    try { data = JSON.parse($(el).html() ?? ""); } catch { return; }
    const list = Array.isArray(data) ? data : [data];
    for (const p of list) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const offer = (p as any)?.offers;
      const car = offer?.itemOffered;
      if (!car || car["@type"] !== "Car") continue;
      const url = typeof offer.url === "string" ? offer.url : "";
      const id = String(car.identifier ?? refId(url) ?? "");
      if (!id || !url) continue;
      const t = tarjetas.get(id);
      items.push({
        id,
        url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
        titulo: t?.titulo || String(car.name ?? "").replace(/-\d+€$/, "").trim(),
        precio: toInt(offer.price),
        km: toInt(car.mileageFromOdometer?.value),
        anio: toInt(car.productionDate),
        cambio: typeof car.vehicleTransmission === "string" ? car.vehicleTransmission : null,
        cv: toInt(car.vehicleEngine?.enginePower?.value),
        combustible: t?.combustible ?? null,
        provincia: t?.provincia ?? null,
        profesional: t ? t.profesional : null,
      });
    }
  });
  return { total, items };
}

export function normalizeAutocasionListing(it: AutocasionItem, model: CrawlModel, crawlSegment: string): ListingRow | null {
  if (!it?.id || !it.url || !it.precio || it.precio < MIN_PRICE_EUR) return null;
  if (isJunkOrDamagedListing(it.titulo)) return null;
  const version = versionDesdeTitulo(it.titulo, model.marca, model.modelo);
  const anio = it.anio && it.anio >= 1950 && it.anio <= new Date().getFullYear() + 1 ? it.anio : null;
  return {
    portal: "autocasion",
    portal_id: it.id,
    url: it.url,
    crawl_segment: crawlSegment,
    marca: model.marca,
    modelo: model.modelo,
    version,
    // "Gas" sin más es GLP o GNC: solo se acepta como GLP si la versión lo dice
    combustible: /^gas$/i.test(it.combustible ?? "")
      ? (/\b(lpg|glp|bi-?fuel)\b/i.test(version ?? "") ? "GLP" : null)
      : normalizeFuel(it.combustible, version ?? ""),
    anio,
    mes: null,
    km: it.km,
    potencia_cv: it.cv && it.cv > 0 && it.cv < 2000 ? it.cv : null,
    cambio: normalizeTransmission(it.cambio),
    provincia: provinciaDesdeNombre(it.provincia),
    vendedor: it.profesional === null ? null : it.profesional ? "Profesional" : "Particular",
    tipo_oferta: null,
    precio: it.precio,
  };
}

async function fetchSearchPage(slug: string, band: PriceBand, page: number): Promise<SearchPage> {
  const url = searchUrl(slug, band, page);
  // Sin seguir redirecciones: una redirección perdería los filtros de precio
  const res = await axios.get<string>(url, {
    headers: HEADERS, timeout: 20000, maxRedirects: 0, responseType: "text", validateStatus: () => true,
  });
  if (res.status === 403 || res.status === 429) throw new BlockedError(`HTTP ${res.status} en ${url}`);
  if (res.status === 404) throw new Error(`El slug no existe en Autocasión (404): ${url}`);
  if (res.status >= 300 && res.status < 400) throw new Error(`El slug redirige (${res.status} → ${res.headers.location ?? "?"})`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status} en ${url}`);
  const { total, items } = parseAutocasionPage(res.data);
  return { numberOfResults: total, listings: items };
}

export const autocasion: PortalAdapter = {
  id: "autocasion",
  pageSize: 25,
  maxPages: 40,
  maxResultsPerSegment: 400,
  minDelayMs: 1500,
  maxDelayMs: 4000,
  rotateModels: false,
  blockPauseMs: 0,
  slugFor: autocasionSlug,
  searchUrl,
  fetchSearchPage,
  listingId: (it: AutocasionItem) => it?.id ?? null,
  normalize: normalizeAutocasionListing,
};
