// Provincia a partir del código postal (las dos primeras cifras, INE).
// Nombres como los usa Valor en Marcha (carmarket/config.py, PROVINCES).
const PROVINCIA_POR_CP: Record<string, string> = {
  "01": "Araba", "02": "Albacete", "03": "Alicante", "04": "Almería", "05": "Ávila",
  "06": "Badajoz", "07": "Illes Balears", "08": "Barcelona", "09": "Burgos", "10": "Cáceres",
  "11": "Cádiz", "12": "Castellón", "13": "Ciudad Real", "14": "Córdoba", "15": "A Coruña",
  "16": "Cuenca", "17": "Girona", "18": "Granada", "19": "Guadalajara", "20": "Gipuzkoa",
  "21": "Huelva", "22": "Huesca", "23": "Jaén", "24": "León", "25": "Lleida",
  "26": "La Rioja", "27": "Lugo", "28": "Madrid", "29": "Málaga", "30": "Murcia",
  "31": "Navarra", "32": "Ourense", "33": "Asturias", "34": "Palencia", "35": "Las Palmas",
  "36": "Pontevedra", "37": "Salamanca", "38": "Santa Cruz de Tenerife", "39": "Cantabria", "40": "Segovia",
  "41": "Sevilla", "42": "Soria", "43": "Tarragona", "44": "Teruel", "45": "Toledo",
  "46": "Valencia", "47": "Valladolid", "48": "Bizkaia", "49": "Zamora", "50": "Zaragoza",
  "51": "Ceuta", "52": "Melilla",
};

// AutoScout24 a veces quita el cero inicial ("2870" en vez de "02870").
export function provinciaDesdeCp(zip: unknown): string | null {
  const digits = String(zip ?? "").replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 5) return null;
  return PROVINCIA_POR_CP[digits.padStart(5, "0").slice(0, 2)] ?? null;
}

// Provincia a partir del nombre que escribe el portal ("Madrid", "Vizcaya",
// "La Coruña", "Islas Baleares"…), con los nombres de Valor en Marcha.
const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

const ALIAS_PROVINCIA: Record<string, string> = {
  "alava": "Araba", "araba alava": "Araba", "alava araba": "Araba",
  "baleares": "Illes Balears", "islas baleares": "Illes Balears", "balears": "Illes Balears", "illes balears": "Illes Balears",
  "la coruna": "A Coruña", "coruna": "A Coruña", "coruna a": "A Coruña", "coruna la": "A Coruña",
  "guipuzcoa": "Gipuzkoa", "vizcaya": "Bizkaia", "gerona": "Girona", "lerida": "Lleida", "orense": "Ourense",
  "castello": "Castellón", "castellon de la plana": "Castellón", "alacant": "Alicante",
  "rioja": "La Rioja", "rioja la": "La Rioja", "palmas las": "Las Palmas", "palmas": "Las Palmas", "gran canaria": "Las Palmas",
  "tenerife": "Santa Cruz de Tenerife", "sta c tenerife": "Santa Cruz de Tenerife", "s c tenerife": "Santa Cruz de Tenerife",
};

const POR_NOMBRE: Record<string, string> = Object.fromEntries(
  Object.values(PROVINCIA_POR_CP).map((p) => [sinTildes(p), p]),
);

export function provinciaDesdeNombre(nombre: unknown): string | null {
  const key = sinTildes(String(nombre ?? ""));
  if (!key) return null;
  return POR_NOMBRE[key] ?? ALIAS_PROVINCIA[key] ?? null;
}
