// Anuncios que no son una venta normal de un coche que funciona: piezas,
// siniestros, averías graves, compraventas, traspasos de leasing… Fuera del
// histórico de precios. Copia de lib/listingQuality.ts de la web de CarScapeAI
// (solo la parte que usa el crawler); si cambia allí, se actualiza aquí.
export const JUNK_OR_DAMAGED_KEYWORDS = [
  // Alemán
  "unfallwagen", "unfallschaden", "unfallfahrzeug", "mit unfall", "unfall-",
  "beschädigt", "beschaedigt", "defekt", "motorschaden", "getriebeschaden",
  "für bastler", "fuer bastler", "bastlerfahrzeug", "bastlerauto", "bastler", "teilespender",
  "ersatzteilspender", "nur ersatzteile", "zum ausschlachten", "schlachtfest",
  "nicht fahrbereit", "kein tüv", "kein tuv", "ohne tüv", "ohne tuv",
  "exportfahrzeug", "totalschaden", "kaufe unfallwagen", "ankauf", "gesuch",
  // Traspasos de leasing/alquiler: el precio es una cuota o una prima, no una venta
  "leasingübernahme", "leasinguebernahme", "leasing übernahme", "leasing-übernahme", "mietkauf",
  // Italiano
  "incidentata", "incidentato", "per pezzi", "per ricambi", "non funzionante",
  "non marciante", "demolizione", "motore fuso", "motore rotto", "guasto grave",
  "da riparare", "rottamazione", "fermo da", "noleggio a lungo termine", "subentro leasing",
  // Español (Wallapop/Milanuncios: anuncios de particulares con texto libre)
  "para piezas", "para despiece", "despiece", "averiado", "siniestrado",
  "no arranca", "motor roto", "motor gripado", "caja de cambios rota",
  "sin itv", "solo exportacion", "compro coches", "compramos tu coche",
];

// Sin acentos, guiones → espacios
const normalizeKeyword = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
const JUNK_KEYWORDS_NORMALIZED = JUNK_OR_DAMAGED_KEYWORDS.map(normalizeKeyword);

export function isJunkOrDamagedListing(title: string): boolean {
  const t = normalizeKeyword(title);
  return JUNK_KEYWORDS_NORMALIZED.some((k) => t.includes(k));
}
