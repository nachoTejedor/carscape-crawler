// Normaliza un anuncio del __NEXT_DATA__ de AutoScout24 al contrato de
// columnas de market.listings (y, a través de la vista, al de Valor en Marcha).
// Función pura: sin red ni base de datos, se prueba en tests/unit.
import { isJunkOrDamagedListing } from "../lib/listingQuality.js";
import { provinciaDesdeCp } from "./provincias.js";
import type { CrawlModel } from "./segments.js";

export const MIN_PRICE_EUR = 500;   // por debajo: precio mal puesto o anuncio de piezas

export interface ListingRow {
  portal: string;
  portal_id: string;
  url: string;
  crawl_segment: string;
  marca: string;
  modelo: string;
  version: string | null;
  combustible: string | null;
  anio: number | null;
  mes: number | null;
  km: number | null;
  potencia_cv: number | null;
  cambio: string | null;
  provincia: string | null;
  vendedor: string | null;
  tipo_oferta: string | null;
  precio: number;
}

const AS24_BASE_URL = "https://www.autoscout24.es";
const PHEV_HINT = /plug[\s-]?in|phev|enchufable|e-?hybrid|tfsi\s?e\b|recharge|e-tense|\bhybrid4\b/i;

export const toInt = (v: unknown): number | null => {
  const n = parseInt(String(v ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

// AutoScout24 no distingue híbrido normal de enchufable en el combustible
// ("Electro/Gasolina"): se decide por la versión.
export function normalizeFuel(fuel: unknown, version: string): string | null {
  const f = String(fuel ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!f) return null;
  // Autocasión y coches.net sí lo dicen ("Híbrido enchufable")
  if (f.includes("enchufable") || f.includes("plug")) return "Híbrido enchufable";
  if (f.includes("electro/") || f.includes("hibrid") || f.includes("hybrid")) {
    return PHEV_HINT.test(version) ? "Híbrido enchufable" : "Híbrido";
  }
  if (f.includes("electric")) return "Eléctrico";
  if (f.includes("diesel")) return "Diésel";
  if (f.includes("gasolina")) return "Gasolina";
  if (f.includes("glp") || f.includes("gas licuado")) return "GLP";
  return null;   // GNC, hidrógeno, etanol…: fuera del dominio del modelo
}

export function normalizeTransmission(t: unknown): string | null {
  const s = String(t ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("manual")) return "Manual";
  if (s.includes("autom")) return "Automático";   // automático, semiautomático, automatic
  return null;
}

export function normalizeSeller(type: unknown): string | null {
  const s = String(type ?? "").toLowerCase();
  if (s === "dealer") return "Profesional";
  if (s.startsWith("private")) return "Particular";
  return null;
}

// "81 kW (110 CV)" → 110
export function parsePowerCv(details: unknown): number | null {
  if (!Array.isArray(details)) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const power = details.find((d: any) => d?.iconName === "speedometer")?.data ?? "";
  const cv = String(power).match(/\((\d+)\s*(?:CV|PS|hp)\)/i)?.[1];
  return cv ? parseInt(cv, 10) : null;
}

// "06-2018" (tracking) o "06/2018" (ficha) → { anio: 2018, mes: 6 }
export function parseRegistration(reg: unknown): { anio: number | null; mes: number | null } {
  const m = String(reg ?? "").match(/(?:(\d{1,2})[-/])?(\d{4})/);
  if (!m) return { anio: null, mes: null };
  const mes = m[1] ? parseInt(m[1], 10) : null;
  return { anio: parseInt(m[2], 10), mes: mes && mes >= 1 && mes <= 12 ? mes : null };
}

// Devuelve null si el anuncio no sirve (sin id o precio, de otro país, spam).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeAs24Listing(it: any, model: CrawlModel, crawlSegment: string): ListingRow | null {
  const portalId = typeof it?.id === "string" ? it.id : null;
  if (!portalId) return null;
  if (it.location?.countryCode && it.location.countryCode !== "ES") return null;
  const precio = Number(it.price?.priceRaw) || toInt(it.tracking?.price);
  if (!precio || precio < MIN_PRICE_EUR) return null;

  const version = String(it.vehicle?.modelVersionInput ?? "").trim();
  const title = [it.vehicle?.make, it.vehicle?.model, version].filter(Boolean).join(" ");
  if (isJunkOrDamagedListing(title)) return null;

  const { anio, mes } = parseRegistration(it.tracking?.firstRegistration);
  const km = toInt(it.tracking?.mileage ?? it.vehicle?.mileageInKm);
  const url = typeof it.url === "string" && it.url ? (it.url.startsWith("http") ? it.url : `${AS24_BASE_URL}${it.url}`) : null;
  if (!url) return null;

  return {
    portal: "autoscout24",
    portal_id: portalId,
    url,
    crawl_segment: crawlSegment,
    marca: model.marca,
    modelo: model.modelo,
    version: version || null,
    combustible: normalizeFuel(it.vehicle?.fuel, version),
    anio,
    mes,
    km,
    potencia_cv: parsePowerCv(it.vehicleDetails),
    cambio: normalizeTransmission(it.vehicle?.transmission),
    provincia: provinciaDesdeCp(it.location?.zip),
    vendedor: normalizeSeller(it.seller?.type),
    tipo_oferta: typeof it.vehicle?.offerType === "string" ? it.vehicle.offerType : null,
    precio,
  };
}

// Versión sin la marca ni el modelo delante: "SEAT León ST 2.0 TDI" → "ST 2.0 TDI"
// (como la da AutoScout24). Compara sin tildes ni mayúsculas.
export function versionDesdeTitulo(titulo: string, marca: string, modelo: string): string | null {
  const norm = (w: string) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = titulo.replace(/\s+/g, " ").trim().split(" ");
  const quitar = (prefijo: string) => {
    const p = prefijo.split(/\s+/).filter(Boolean).map(norm);
    if (p.length && p.every((w, i) => norm(words[i] ?? "") === w)) words.splice(0, p.length);
  };
  quitar(marca.replace(/-/g, " "));
  quitar(marca);
  quitar(modelo);
  const v = words.join(" ").trim();
  return v || null;
}
