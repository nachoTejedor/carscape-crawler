// Sondeo de portales candidatos para el crawler: una sola petición por portal
// (búsqueda de Seat León) y su robots.txt. Dice si responde, si sale un muro
// anti-bot, si los anuncios vienen en datos estructurados (fáciles de leer) y
// si robots.txt permite esa ruta. No guarda nada.
//
//   pnpm sondeo
import axios from "axios";

interface Candidato { portal: string; url: string }

const CANDIDATOS: Candidato[] = [
  { portal: "Wallapop (API)", url: "https://api.wallapop.com/api/v3/search?category_ids=100&keywords=seat%20leon&source=search_box" },
  { portal: "Milanuncios", url: "https://www.milanuncios.com/coches-de-segunda-mano/?s=seat%20leon" },
  { portal: "Flexicar", url: "https://www.flexicar.es/seat/leon/segunda-mano/" },
  { portal: "Clicars", url: "https://www.clicars.com/coches-segunda-mano-ocasion/seat-leon" },
  { portal: "OcasionPlus", url: "https://www.ocasionplus.com/coches-segunda-mano/seat/leon" },
  { portal: "Autohero", url: "https://www.autohero.com/es/search/?brand=SEAT&model=Leon" },
  { portal: "Coches.com", url: "https://www.coches.com/coches-segunda-mano/seat-leon.htm" },
  { portal: "Motor.es", url: "https://www.motor.es/coches-segunda-mano/seat/leon/" },
  { portal: "Trovit", url: "https://coches.trovit.es/index.php/cod.search_cars/what_d.seat%20leon" },
  { portal: "Spoticar (Stellantis)", url: "https://www.spoticar.es/coches-segunda-mano/peugeot/208" },
  { portal: "Das WeltAuto (VW)", url: "https://www.dasweltauto.es/es/coches-de-segunda-mano/seat/leon" },
  { portal: "Carwow", url: "https://www.carwow.es/coches-segunda-mano/seat/leon" },
  { portal: "Autocasión", url: "https://www.autocasion.com/coches-segunda-mano/seat-leon-ocasion" },
  { portal: "AutoScout24", url: "https://www.autoscout24.es/lst/seat/leon?cy=E&atype=C" },
  { portal: "coches.net", url: "https://www.coches.net/seat/leon/segunda-mano/" },
];

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9",
};

const MUROS: Array<[RegExp, string]> = [
  [/eres un bot/i, "muro Adevinta"],
  [/pardon our interruption|incapsula|imperva/i, "Imperva"],
  [/just a moment|cf-chl|challenge-platform|attention required/i, "Cloudflare"],
  [/datadome|captcha-delivery/i, "DataDome"],
  [/px-captcha|perimeterx|press & hold/i, "PerimeterX"],
  [/access denied|request blocked/i, "bloqueo genérico"],
  [/captcha/i, "captcha"],
];

function datos(body: string): string[] {
  const d: string[] = [];
  if (body.trim().startsWith("{") || body.trim().startsWith("[")) d.push("JSON (API)");
  if (/__NEXT_DATA__/.test(body)) d.push("__NEXT_DATA__");
  if (/__staticRouterHydrationData|__INITIAL_PROPS__|__INITIAL_STATE__|__NUXT__|__APOLLO_STATE__/.test(body)) d.push("estado embebido");
  if (/application\/ld\+json/.test(body)) d.push("JSON-LD");
  return d;
}

// robots.txt: reglas de "User-agent: *" (simplificado: prefijos Disallow/Allow, el más largo gana)
async function robotsPermite(url: string): Promise<string> {
  const u = new URL(url);
  try {
    const r = await axios.get<string>(`${u.origin}/robots.txt`, { headers: HEADERS, timeout: 15000, responseType: "text", validateStatus: () => true });
    if (r.status >= 400) return `sin robots.txt (${r.status})`;
    const ruta = u.pathname + u.search;
    let enGrupo = false;
    let mejor: { len: number; allow: boolean } | null = null;
    for (const raw of String(r.data).split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (/^user-agent$/i.test(k)) { enGrupo = v.trim() === "*"; continue; }
      if (!enGrupo || !v) continue;
      if (!/^(dis)?allow$/i.test(k)) continue;
      const patron = new RegExp("^" + v.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      if (patron.test(ruta) && (!mejor || v.length >= mejor.len)) mejor = { len: v.length, allow: /^allow$/i.test(k) };
    }
    return !mejor || mejor.allow ? "permite" : "PROHÍBE";
  } catch (e) {
    return `robots.txt sin respuesta (${(e as Error).message.slice(0, 40)})`;
  }
}

async function main() {
  console.log(`Sondeo desde ${process.env.GITHUB_ACTIONS ? "GitHub Actions" : "esta máquina"} — ${new Date().toISOString()}`);
  for (const c of CANDIDATOS) {
    let linea = "";
    try {
      const r = await axios.get<string>(c.url, { headers: HEADERS, timeout: 25000, maxRedirects: 3, responseType: "text", validateStatus: () => true, transformResponse: (x) => x });
      const body = String(r.data ?? "");
      const muro = r.status === 200 && body.length > 20000 ? null : MUROS.find(([re]) => re.test(body.slice(0, 20000)))?.[1] ?? null;
      const precios = (body.match(/\d{1,3}(?:\.\d{3})+\s?€|€\s?\d{1,3}(?:\.\d{3})+|"price"\s*:\s*\d{3,}/g) ?? []).length;
      linea = `HTTP ${r.status} · ${Math.round(body.length / 1024)} KB · ${muro ? `MURO: ${muro}` : "sin muro"} · datos: ${datos(body).join(", ") || "—"} · precios: ${precios}`;
    } catch (e) {
      linea = `ERROR ${(e as Error).message.slice(0, 80)}`;
    }
    console.log(`${c.portal.padEnd(22)} ${linea} · robots: ${await robotsPermite(c.url)}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
