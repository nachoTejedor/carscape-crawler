// Rejilla del crawler diario: qué modelos se recorren y en qué tramos de precio.
//
// Los modelos son los del catálogo de Valor en Marcha (carmarket/config.py,
// CATALOG): se guardan con su nombre canónico (marca/modelo del catálogo), así
// el pipeline los cruza con segmento, carrocería y PVP sin tabla de
// equivalencias. `slug` es la ruta de AutoScout24 (/lst/<slug>); se comprueba
// con `pnpm crawler --probar` (un slug que redirige pierde los filtros de URL).

export interface CrawlModel {
  marca: string;   // nombre canónico (catálogo de Valor en Marcha)
  modelo: string;
  slug: string;    // ruta de AutoScout24: marca/modelo
  // Rutas de los otros portales cuando no salen solas de marca y modelo
  // (crawler/autocasion.ts y crawler/cochesnet.ts); se comprueban con --probar
  acSlug?: string;
  cnSlug?: string;
  fxSlug?: string;   // Flexicar: "marca/modelo" de su API
  opName?: string;   // OcasionPlus: "Marca_Modelo" como lo escribe su web
  ccSlug?: string;   // Coches.com: "marca-modelo" de /coches-segunda-mano/<slug>.htm
  alias?: string[];  // otros nombres del modelo en los portales ("Clase GLC", "Q4"…)
  sinPortales?: string[];   // portales donde no se busca (no lo venden o no tiene página propia)
}

export const MODELS: CrawlModel[] = [
  { marca: "Seat", modelo: "Ibiza", slug: "seat/ibiza" },
  { marca: "Seat", modelo: "León", slug: "seat/leon" },
  { marca: "Seat", modelo: "Arona", slug: "seat/arona" },
  { marca: "Seat", modelo: "Ateca", slug: "seat/ateca" },
  { marca: "Cupra", modelo: "Formentor", slug: "cupra/formentor" },
  { marca: "Cupra", modelo: "Born", slug: "cupra/born" },
  { marca: "Volkswagen", modelo: "Polo", slug: "volkswagen/polo" },
  { marca: "Volkswagen", modelo: "Golf", slug: "volkswagen/golf" },
  { marca: "Volkswagen", modelo: "T-Roc", slug: "volkswagen/t-roc" },
  { marca: "Volkswagen", modelo: "Tiguan", slug: "volkswagen/tiguan" },
  { marca: "Volkswagen", modelo: "ID.3", slug: "volkswagen/id-3", fxSlug: "volkswagen/id3", ccSlug: "volkswagen-id3", sinPortales: ["ocasionplus"] },
  { marca: "Volkswagen", modelo: "ID.4", slug: "volkswagen/id-4", fxSlug: "volkswagen/id4", ccSlug: "volkswagen-id4", sinPortales: ["cochescom"] },
  { marca: "Toyota", modelo: "Yaris", slug: "toyota/yaris" },
  { marca: "Toyota", modelo: "Corolla", slug: "toyota/corolla" },
  { marca: "Toyota", modelo: "C-HR", slug: "toyota/c-hr" },
  { marca: "Toyota", modelo: "RAV4", slug: "toyota/rav4", acSlug: "toyota-rav-4", opName: "Toyota_Rav4", ccSlug: "toyota-rav-4" },
  { marca: "Renault", modelo: "Clio", slug: "renault/clio" },
  { marca: "Renault", modelo: "Captur", slug: "renault/captur" },
  { marca: "Renault", modelo: "Mégane", slug: "renault/megane" },
  { marca: "Renault", modelo: "Mégane E-Tech", slug: "renault/megane-e-tech", sinPortales: ["ocasionplus", "cochescom"] },
  { marca: "Renault", modelo: "Zoe", slug: "renault/zoe", sinPortales: ["ocasionplus"] },
  { marca: "Dacia", modelo: "Sandero", slug: "dacia/sandero" },
  { marca: "Dacia", modelo: "Duster", slug: "dacia/duster" },
  { marca: "Dacia", modelo: "Spring", slug: "dacia/spring", sinPortales: ["ocasionplus"] },
  { marca: "Peugeot", modelo: "208", slug: "peugeot/208" },
  { marca: "Peugeot", modelo: "2008", slug: "peugeot/2008" },
  { marca: "Peugeot", modelo: "3008", slug: "peugeot/3008" },
  { marca: "Citroën", modelo: "C3", slug: "citroen/c3" },
  { marca: "Citroën", modelo: "C4", slug: "citroen/c4" },
  { marca: "Kia", modelo: "Ceed", slug: "kia/ceed", opName: "KIA_Ceed" },
  { marca: "Kia", modelo: "Sportage", slug: "kia/sportage", opName: "KIA_Sportage" },
  { marca: "Kia", modelo: "Niro", slug: "kia/niro", opName: "KIA_Niro" },
  { marca: "Hyundai", modelo: "Tucson", slug: "hyundai/tucson" },
  { marca: "Hyundai", modelo: "Kona", slug: "hyundai/kona" },
  { marca: "Hyundai", modelo: "Ioniq 5", slug: "hyundai/ioniq-5", opName: "Hyundai_IONIQ 5" },
  { marca: "MG", modelo: "ZS", slug: "mg/zs" },
  { marca: "MG", modelo: "MG4", slug: "mg/mg4", acSlug: "mg-4", ccSlug: "mg-4", alias: ["4"] },
  { marca: "MG", modelo: "HS", slug: "mg/hs" },
  { marca: "BYD", modelo: "Atto 3", slug: "byd/atto-3", sinPortales: ["ocasionplus"] },
  { marca: "BYD", modelo: "Dolphin", slug: "byd/dolphin", sinPortales: ["ocasionplus"] },
  { marca: "BYD", modelo: "Seal U", slug: "byd/seal-u", opName: "BYD_Seal U DM-i", alias: ["Seal U DM-i", "Seal U DM i"] },
  { marca: "Tesla", modelo: "Model 3", slug: "tesla/model-3" },
  { marca: "Tesla", modelo: "Model Y", slug: "tesla/model-y" },
  { marca: "BMW", modelo: "Serie 1", slug: "bmw/1-series" },
  { marca: "BMW", modelo: "Serie 3", slug: "bmw/3-series" },
  { marca: "BMW", modelo: "X1", slug: "bmw/x1" },
  { marca: "Mercedes-Benz", modelo: "Clase A", slug: "mercedes-benz/a-class", opName: "Mercedes_Clase A", ccSlug: "mercedes-clase-a" },
  { marca: "Mercedes-Benz", modelo: "GLC", slug: "mercedes-benz/glc", acSlug: "mercedes-benz-clase-glc", fxSlug: "mercedes-benz/clase-glc", opName: "Mercedes_Clase GLC", ccSlug: "mercedes-clase-glc", alias: ["Clase GLC"] },
  { marca: "Audi", modelo: "A3", slug: "audi/a3" },
  { marca: "Audi", modelo: "Q3", slug: "audi/q3" },
  { marca: "Audi", modelo: "Q4 e-tron", slug: "audi/q4-e-tron", fxSlug: "audi/q4", alias: ["Q4"] },
  { marca: "Ford", modelo: "Focus", slug: "ford/focus" },
  { marca: "Ford", modelo: "Kuga", slug: "ford/kuga" },
  { marca: "Opel", modelo: "Corsa", slug: "opel/corsa" },
  { marca: "Nissan", modelo: "Qashqai", slug: "nissan/qashqai", opName: "Nissan_QASHQAI" },
  { marca: "Nissan", modelo: "Leaf", slug: "nissan/leaf", sinPortales: ["ocasionplus"] },
  { marca: "Skoda", modelo: "Octavia", slug: "skoda/octavia" },
  { marca: "Volvo", modelo: "XC40", slug: "volvo/xc40" },
  { marca: "Fiat", modelo: "500", slug: "fiat/500" },
];

// Tramos de precio de partida (€, [desde, hasta)). Un tramo con más de
// MAX_RESULTS_PER_SEGMENT anuncios se parte por la mitad hasta caber; así cada
// segmento se recorre entero y la ausencia de un anuncio significa algo.
export const BASE_PRICE_EDGES = [500, 4000, 8000, 12000, 16000, 20000, 25000, 30000, 40000, 60000, 100000];
export const MAX_RESULTS_PER_SEGMENT = 400;  // 20 páginas de 20 anuncios
export const MIN_BAND_WIDTH_EUR = 500;       // por debajo no se parte más
export const MAX_PAGES_PER_SEGMENT = 50;     // AutoScout24 sirve hasta 50 páginas (verificado oct. 2026)
export const PAGE_SIZE = 20;

export interface PriceBand { lo: number; hi: number | null }   // hi null = sin tope

export function basePriceBands(): PriceBand[] {
  const bands: PriceBand[] = [];
  for (let i = 0; i < BASE_PRICE_EDGES.length; i++) {
    bands.push({ lo: BASE_PRICE_EDGES[i], hi: BASE_PRICE_EDGES[i + 1] ?? null });
  }
  return bands;
}

// Parte un tramo en dos (redondeando a 100 €). Un tramo sin tope se parte en
// [lo, 2·lo) y [2·lo, ∞). Devuelve null si ya es demasiado estrecho.
export function splitBand(band: PriceBand): [PriceBand, PriceBand] | null {
  if (band.hi === null) return [{ lo: band.lo, hi: band.lo * 2 }, { lo: band.lo * 2, hi: null }];
  if (band.hi - band.lo < MIN_BAND_WIDTH_EUR * 2) return null;
  const mid = Math.round((band.lo + band.hi) / 2 / 100) * 100;
  return [{ lo: band.lo, hi: mid }, { lo: mid, hi: band.hi }];
}

export function segmentKey(model: CrawlModel, band: PriceBand): string {
  return `${model.slug}|${band.lo}-${band.hi ?? "max"}`;
}
