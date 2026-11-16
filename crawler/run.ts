// Crawler diario del mercado de ocasión → esquema market.
// Portales: AutoScout24, Autocasión y coches.net (crawler/<portal>.ts).
//
// Distinto de las búsquedas de los usuarios: recorre el mercado de forma
// sistemática, segmento a segmento (modelo × tramo de precio), para construir
// el histórico que usa Valor en Marcha. Un único proceso con pausas aleatorias:
// mejor rastrear menos que provocar un bloqueo.
//
// Uso:
//   pnpm crawler                                  AutoScout24 (por defecto)
//   pnpm crawler --portal=autocasion              un portal
//   pnpm crawler --portal=autoscout24,autocasion  varios, uno detrás de otro
//   pnpm crawler --portal=cochesnet --probar      solo comprueba los slugs (1 petición por modelo, sin base de datos)
//   pnpm crawler --solo-bajas                     solo marca las bajas del día (al final de todos los trabajos)
//
// En producción lo lanza GitHub Actions cada día (.github/workflows/crawler.yml):
// varios trabajos en paralelo (cada uno < 6 h, el máximo de GitHub) y al final
// uno que marca las bajas. coches.net bloquea las IPs de servidores: su rastreo
// es "a lo que deje".
//
// Variables: SUPABASE_DB_URL (obligatoria salvo --probar), CRAWLER_PORTALS (si
// no se pasa --portal), CRAWLER_MAX_MODELS, CRAWLER_MAX_MINUTES (420, por portal),
// CRAWLER_MIN_DELAY_MS / CRAWLER_MAX_DELAY_MS (cambian las pausas de cada portal),
// CRAWLER_MODEL_SLICE ("1/2": la primera de dos partes de los modelos),
// CRAWLER_RUN_DATE (fecha del rastreo, la misma para todos los trabajos del día),
// CRAWLER_SKIP_BAJAS=1 (no marcar bajas al terminar: lo hace el trabajo final).
import pg from "pg";
import { autocasion } from "./autocasion.js";
import { autoscout24 } from "./autoscout24.js";
import { cochesnet } from "./cochesnet.js";
import type { ListingRow } from "./normalize.js";
import { BlockedError, type PortalAdapter } from "./portal.js";
import { MODELS, basePriceBands, segmentKey, splitBand, type CrawlModel, type PriceBand } from "./segments.js";

const PORTALS: Record<string, PortalAdapter> = { autoscout24, autocasion, cochesnet };
const MAX_MINUTES = Number(process.env.CRAWLER_MAX_MINUTES ?? 420);
const MAX_CONSECUTIVE_BLOCKS = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const envMs = (name: string): number | null => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? n : null;
};
function pauseFor(portal: PortalAdapter): Promise<void> {
  const min = envMs("CRAWLER_MIN_DELAY_MS") ?? portal.minDelayMs;
  const max = Math.max(min, envMs("CRAWLER_MAX_DELAY_MS") ?? portal.maxDelayMs);
  return sleep(min + Math.random() * (max - min));
}

// Fecha del rastreo en hora de España: todas las filas del día llevan la misma.
export function madridDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(d);
}

// Fecha del rastreo: CRAWLER_RUN_DATE (AAAA-MM-DD) si viene, si no hoy en Madrid
export function runDateFrom(env: string | undefined, now = new Date()): string {
  if (env === undefined || env === "") return madridDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env) || Number.isNaN(Date.parse(`${env}T00:00:00Z`))) {
    throw new Error(`CRAWLER_RUN_DATE no válida: "${env}" (formato AAAA-MM-DD)`);
  }
  return env;
}

// Parte k de n de los modelos ("1/2", "2/2"), repartidos de forma alterna para
// que las partes tarden parecido. Sin parte: todos.
export function modelSlice<T>(models: T[], spec: string | undefined): T[] {
  if (spec === undefined || spec === "") return models;
  const m = spec.match(/^(\d+)\/(\d+)$/);
  const k = m ? Number(m[1]) : NaN;
  const n = m ? Number(m[2]) : NaN;
  if (!m || n < 1 || k < 1 || k > n) throw new Error(`CRAWLER_MODEL_SLICE no válida: "${spec}" (formato k/n, p. ej. 1/2)`);
  return models.filter((_, i) => i % n === k - 1);
}

// Portales pedidos: --portal=a,b o CRAWLER_PORTALS; por defecto AutoScout24
export function selectPortals(argv: string[], env: string | undefined): PortalAdapter[] {
  const arg = argv.find((a) => a.startsWith("--portal="))?.slice("--portal=".length);
  const names = (arg ?? env ?? "autoscout24").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const unknown = names.filter((n) => !PORTALS[n]);
  if (unknown.length) throw new Error(`Portal desconocido: ${unknown.join(", ")} (válidos: ${Object.keys(PORTALS).join(", ")})`);
  return [...new Set(names)].map((n) => PORTALS[n]);
}

// Orden de los modelos: los portales lentos empiezan cada día por uno distinto,
// así lo que no da tiempo a recorrer un día se recorre otro.
export function modelOrder(portal: PortalAdapter, models: CrawlModel[], runDate: string): CrawlModel[] {
  if (!portal.rotateModels || models.length === 0) return models;
  const day = Math.floor(Date.parse(`${runDate}T00:00:00Z`) / 86_400_000);
  const start = ((day % models.length) + models.length) % models.length;
  return [...models.slice(start), ...models.slice(0, start)];
}

const UPSERT_LISTING = `
insert into market.listings (portal, portal_id, url, crawl_segment, marca, modelo, version, combustible,
  anio, mes, km, potencia_cv, cambio, provincia, vendedor, tipo_oferta, first_seen, last_seen)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $17)
on conflict (portal, portal_id) do update
  set last_seen = excluded.last_seen, km = excluded.km, url = excluded.url,
      crawl_segment = excluded.crawl_segment, baja_date = null
returning id, (xmax = 0) as nuevo`;

const UPSERT_SNAPSHOT = `
insert into market.listing_snapshots (listing_id, snapshot_date, precio) values ($1, $2, $3)
on conflict (listing_id, snapshot_date) do update set precio = excluded.precio`;

const INSERT_RUN = `
insert into market.crawl_runs (run_date, portal, crawl_segment, completo, n_anuncios, error)
values ($1, $2, $3, $4, $5, $6)
on conflict (run_date, portal, crawl_segment) do update
  set completo = excluded.completo, n_anuncios = excluded.n_anuncios, error = excluded.error`;

interface RunState {
  db: pg.Client;
  portal: PortalAdapter;
  runDate: string;
  seen: Set<string>;          // ids ya guardados hoy en este portal (dos tramos pueden compartir anuncio)
  deadline: number;
  consecutiveBlocks: number;
  stats: { segmentos: number; completos: number; anuncios: number; nuevos: number; errores: number };
}

async function saveListing(state: RunState, row: ListingRow): Promise<void> {
  if (state.seen.has(row.portal_id)) return;
  state.seen.add(row.portal_id);
  const { rows } = await state.db.query(UPSERT_LISTING, [
    row.portal, row.portal_id, row.url, row.crawl_segment, row.marca, row.modelo, row.version, row.combustible,
    row.anio, row.mes, row.km, row.potencia_cv, row.cambio, row.provincia, row.vendedor, row.tipo_oferta, state.runDate,
  ]);
  await state.db.query(UPSERT_SNAPSHOT, [rows[0].id, state.runDate, row.precio]);
  state.stats.anuncios++;
  if (rows[0].nuevo) state.stats.nuevos++;
}

async function recordRun(state: RunState, key: string, completo: boolean, n: number, error: string | null) {
  await state.db.query(INSERT_RUN, [state.runDate, state.portal.id, key, completo, n, error?.slice(0, 500) ?? null]);
  state.stats.segmentos++;
  if (completo) state.stats.completos++; else state.stats.errores++;
}

// Recorre un tramo. Si tiene demasiados anuncios lo parte en dos y recurre.
async function crawlBand(state: RunState, model: CrawlModel, band: PriceBand): Promise<void> {
  if (Date.now() > state.deadline || state.consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) return;
  const { portal } = state;
  const slug = portal.slugFor(model);
  const key = segmentKey(model, band);
  let n = 0;
  try {
    await pauseFor(portal);
    const first = await portal.fetchSearchPage(slug, band, 1);
    state.consecutiveBlocks = 0;
    const halves = first.numberOfResults > portal.maxResultsPerSegment ? splitBand(band) : null;
    if (halves) {
      for (const half of halves) await crawlBand(state, model, half);
      return;
    }
    const pages = first.numberOfPages ?? Math.ceil(first.numberOfResults / portal.pageSize);
    if (pages > portal.maxPages) throw new Error(`${first.numberOfResults} anuncios: más de ${portal.maxPages} páginas`);
    // 0 resultados puede ser un bloqueo "suave" (página válida sin anuncios): si
    // el tramo tenía anuncios activos no cuenta como completo, así su ausencia no
    // genera bajas. Un tramo que ya estaba vacío (p. ej. Tesla < 4.000 €) sí.
    if (first.numberOfResults === 0) {
      const { rows } = await state.db.query(
        "select count(*)::int as n from market.listings where portal = $1 and crawl_segment = $2 and baja_date is null",
        [portal.id, key]);
      if (rows[0].n > 0) throw new Error(`0 resultados con ${rows[0].n} anuncios activos (¿bloqueo?)`);
      await recordRun(state, key, true, 0, null);
      return;
    }
    let listings = first.listings;
    const vistos = new Set<string>();   // anuncios distintos que entregó el portal (antes de filtros)
    for (let page = 1; page <= pages; page++) {
      if (page > 1) {
        await pauseFor(portal);
        listings = (await portal.fetchSearchPage(slug, band, page)).listings;
      }
      if (listings.length === 0) throw new Error(`Página ${page}/${pages} vacía`);
      for (const it of listings) {
        const id = portal.listingId(it);
        if (id) vistos.add(id);
        const row = portal.normalize(it, model, key);
        if (row) { await saveListing(state, row); n++; }
      }
    }
    // Completo solo si el portal entregó casi todo lo que dice tener (deja
    // margen para anuncios que entran o salen durante el recorrido). Se cuentan
    // anuncios distintos: los destacados que se repiten en cada página no suman.
    if (vistos.size < first.numberOfResults * 0.9) throw new Error(`Solo ${vistos.size} de ${first.numberOfResults} anuncios`);
    await recordRun(state, key, true, n, null);
  } catch (e) {
    if (e instanceof BlockedError) {
      state.consecutiveBlocks++;
      if (portal.blockPauseMs > 0 && state.consecutiveBlocks < MAX_CONSECUTIVE_BLOCKS) {
        console.warn(`[crawler:${portal.id}] Bloqueo: pausa de ${Math.round(portal.blockPauseMs / 60_000)} min`);
        await sleep(portal.blockPauseMs);
      }
    }
    console.error(`[crawler:${portal.id}] ${key}: ${(e as Error).message}`);
    await recordRun(state, key, false, n, (e as Error).message);   // un segmento caído no para el resto
  }
}

async function crawlPortal(db: pg.Client, portal: PortalAdapter, runDate: string): Promise<RunState["stats"]> {
  const maxModels = Number(process.env.CRAWLER_MAX_MODELS ?? MODELS.length);
  const state: RunState = {
    db, portal, runDate, seen: new Set(), deadline: Date.now() + MAX_MINUTES * 60_000, consecutiveBlocks: 0,
    stats: { segmentos: 0, completos: 0, anuncios: 0, nuevos: 0, errores: 0 },
  };
  const t0 = Date.now();
  const models = modelSlice(modelOrder(portal, MODELS, runDate), process.env.CRAWLER_MODEL_SLICE).slice(0, maxModels);
  for (const model of models) {
    for (const band of basePriceBands()) await crawlBand(state, model, band);
    console.log(`[crawler:${portal.id}] ${model.marca} ${model.modelo}: ${state.stats.anuncios} anuncios acumulados`);
    if (state.consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
      console.error(`[crawler:${portal.id}] Bloqueo del portal: se para el rastreo de hoy en este portal`);
      break;
    }
    if (Date.now() > state.deadline) {
      console.warn(`[crawler:${portal.id}] Tiempo máximo (${MAX_MINUTES} min) alcanzado`);
      break;
    }
  }
  const s = state.stats;
  const pct = s.segmentos ? Math.round((s.completos / s.segmentos) * 100) : 0;
  console.log(`[crawler:${portal.id}] ${runDate}: ${s.anuncios} anuncios (${s.nuevos} nuevos), ` +
    `${s.completos}/${s.segmentos} segmentos completos (${pct} %), ${Math.round((Date.now() - t0) / 60000)} min`);
  return s;
}

async function connect(): Promise<pg.Client> {
  const dsn = process.env.SUPABASE_DB_URL;
  if (!dsn) throw new Error("Falta SUPABASE_DB_URL (conexión directa a Postgres de Supabase)");
  const ca = process.env.SUPABASE_DB_CA_CERT;
  if (!ca) console.warn("[crawler] Sin SUPABASE_DB_CA_CERT: la conexión va cifrada pero sin verificar el certificado del servidor");
  const db = new pg.Client({ connectionString: dsn, ssl: ca ? { ca } : { rejectUnauthorized: false } });
  await db.connect();
  return db;
}

async function marcarBajas(db: pg.Client, runDate: string): Promise<void> {
  const { rows } = await db.query("select market.marcar_bajas($1::date) as bajas", [runDate]);
  console.log(`[crawler] ${runDate}: ${rows[0].bajas} bajas`);
}

async function crawl(portals: PortalAdapter[]): Promise<void> {
  const runDate = runDateFrom(process.env.CRAWLER_RUN_DATE);
  const db = await connect();
  const vacios: string[] = [];
  try {
    for (const portal of portals) {
      const stats = await crawlPortal(db, portal, runDate);
      if (stats.anuncios === 0) vacios.push(portal.id);
    }
    // Con varios trabajos en paralelo las bajas se marcan una vez, al final de todos
    if (process.env.CRAWLER_SKIP_BAJAS === "1") console.log("[crawler] Bajas: las marca el trabajo final");
    else await marcarBajas(db, runDate);
    if (vacios.length) throw new Error(`Ningún anuncio guardado en ${vacios.join(", ")}: probable bloqueo o cambio del portal`);
  } finally {
    await db.end();
  }
}

// --solo-bajas: el trabajo final del día, cuando ya han terminado todos los portales
async function soloBajas(): Promise<void> {
  const runDate = runDateFrom(process.env.CRAWLER_RUN_DATE);
  const db = await connect();
  try {
    await marcarBajas(db, runDate);
  } finally {
    await db.end();
  }
}

// --probar: una petición por modelo (tramo completo) para validar slugs y formato.
// Cuenta como error un slug que no da anuncios del modelo (p. ej. coches.net,
// que con un modelo mal escrito devuelve toda la marca).
async function probe(portals: PortalAdapter[]): Promise<void> {
  const maxModels = Number(process.env.CRAWLER_MAX_MODELS ?? MODELS.length);
  let bad = 0;
  for (const portal of portals) {
    for (const model of MODELS.slice(0, maxModels)) {
      const slug = portal.slugFor(model);
      await pauseFor(portal);
      try {
        const page = await portal.fetchSearchPage(slug, { lo: 500, hi: null }, 1);
        const rows = page.listings.map((it) => portal.normalize(it, model, "probe")).filter(Boolean) as ListingRow[];
        const sample = rows[0];
        const ok = page.numberOfResults > 0 && rows.length > 0;
        console.log(`${ok ? "OK " : "ERR"} ${portal.id.padEnd(11)} ${slug.padEnd(28)} ${String(page.numberOfResults).padStart(6)} anuncios, ` +
          `${rows.length}/${page.listings.length} válidos` +
          (sample ? `  ej.: ${sample.version ?? ""} · ${sample.combustible} · ${sample.anio} · ${sample.km} km · ${sample.provincia} · ${sample.vendedor} · ${sample.precio} €` : ""));
        if (!ok) bad++;
      } catch (e) {
        bad++;
        console.log(`ERR ${portal.id.padEnd(11)} ${slug.padEnd(28)} ${(e as Error).message}`);
        if (e instanceof BlockedError && portal.blockPauseMs > 0) break;   // no insistir con el muro delante
      }
    }
  }
  if (bad) throw new Error(`${bad} slugs sin resultados o con error`);
}

// Solo al ejecutarlo (pnpm crawler), no al importarlo desde los tests
const isMain = process.argv[1] && /crawler[\\/]run\.(ts|js|cjs|mjs)$/.test(process.argv[1]);
if (isMain) {
  let portals: PortalAdapter[];
  try {
    portals = selectPortals(process.argv, process.env.CRAWLER_PORTALS);
  } catch (e) {
    console.error(`[crawler] ${(e as Error).message}`);
    process.exit(1);
  }
  const main = process.argv.includes("--solo-bajas") ? soloBajas
    : process.argv.includes("--probar") ? probe : crawl;
  main(portals).catch((e) => {
    console.error(`[crawler] ${(e as Error).message}`);
    process.exit(1);
  });
}
