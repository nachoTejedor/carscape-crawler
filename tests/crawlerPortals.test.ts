// Crawler diario: lectores de Autocasión y coches.net, provincias por nombre,
// versión desde el título y selección/orden de portales. Sin red ni base de datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { autocasionSlug, normalizeAutocasionListing, parseAutocasionPage, searchUrl as acUrl } from "../crawler/autocasion";
import { cochesnetSlug, normalizeCochesnetListing, searchUrl as cnUrl } from "../crawler/cochesnet";
import { BlockedError } from "../crawler/portal";
import { normalizeFuel, versionDesdeTitulo } from "../crawler/normalize";
import { provinciaDesdeNombre } from "../crawler/provincias";
import { modelOrder, modelSlice, runDateFrom, selectPortals } from "../crawler/run";
import { MODELS } from "../crawler/segments";
import { extractAdevintaResults, isAdevintaBotWall } from "../lib/cochesnetPage";

const LEON = { marca: "Seat", modelo: "León", slug: "seat/leon" };

// ── Autocasión ──────────────────────────────────────────────────────────────
const acCard = (id: string, h2: string, lis: string[], dealer = true) => `
<article class="anuncio ${dealer ? "con-concesionario" : ""}">
  <a href="/coches-segunda-mano/seat-leon-ocasion/x-ref${id}"><div class="contenido-anuncio">
    <h2 itemprop="name"> ${h2} </h2>
    <ul class="supplementary">${lis.map((l) => (l.startsWith("@") ? `<li class="municipio">${l.slice(1)}</li>` : `<li>${l}</li>`)).join("")}</ul>
  </div></a>
</article>`;
const acLd = (id: string, price: number, km: number, year: number) => ({
  "@type": "Product",
  offers: {
    "@type": "Offer", price: String(price),
    url: `https://www.autocasion.com/coches-segunda-mano/seat-leon-ocasion/x-ref${id}`,
    itemOffered: { "@type": "Car", identifier: Number(id), productionDate: year, vehicleTransmission: "Manual",
      mileageFromOdometer: { value: km }, vehicleEngine: { enginePower: { value: 115 } }, name: "SEAT León x-10500€" },
  },
});
const acPage = (h1: string, ld: unknown[] | null, cards: string) =>
  `<html><body><h1>\n ${h1} </h1>${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ""}${cards}</body></html>`;

test("Autocasión: lee total, anuncios del JSON-LD y datos de la tarjeta", () => {
  const html = acPage("184 Seat León de segunda mano y ocasión", [acLd("21114369", 10500, 192500, 2021), acLd("2", 9000, 80000, 2019)],
    acCard("21114369", "SEAT León ST 2.0TDI CR S&amp;S Reference 115", ["2021", "Diésel", "192.500 km", "Madrid", "@Torrejón de Ardoz"]) +
    acCard("2", "SEAT León 1.0 TCE LPG", ["2019", "Gas", "80.000 km", "Vizcaya"], false));
  const { total, items } = parseAutocasionPage(html);
  assert.equal(total, 184);
  assert.equal(items.length, 2);
  const row = normalizeAutocasionListing(items[0], LEON, "seat/leon|8000-12000");
  assert.deepEqual(row, {
    portal: "autocasion", portal_id: "21114369",
    url: "https://www.autocasion.com/coches-segunda-mano/seat-leon-ocasion/x-ref21114369",
    crawl_segment: "seat/leon|8000-12000", marca: "Seat", modelo: "León",
    version: "ST 2.0TDI CR S&S Reference 115", combustible: "Diésel", anio: 2021, mes: null, km: 192500,
    potencia_cv: 115, cambio: "Manual", provincia: "Madrid", vendedor: "Profesional", tipo_oferta: null, precio: 10500,
  });
  // Sin municipio la provincia sigue saliendo; "Gas" con LPG en la versión es GLP; particular
  const row2 = normalizeAutocasionListing(items[1], LEON, "k")!;
  assert.equal(row2.provincia, "Bizkaia");
  assert.equal(row2.combustible, "GLP");
  assert.equal(row2.vendedor, "Particular");
});

test("Autocasión: sin resultados los coches sugeridos no cuentan; sin recuento es bloqueo", () => {
  const vacia = acPage("0 Tesla Model 3 baratos de segunda mano y ocasión", null,
    acCard("9", "TESLA Model 3 Long Range", ["2021", "Eléctrico", "50.000 km", "Madrid"]));
  assert.deepEqual(parseAutocasionPage(vacia), { total: 0, items: [] });
  assert.throws(() => parseAutocasionPage("<html><h1>Ups!...</h1></html>"), BlockedError);
});

test("Autocasión: slug y URL de búsqueda por tramo [desde, hasta)", () => {
  assert.equal(autocasionSlug(LEON), "seat-leon");
  assert.equal(autocasionSlug({ marca: "Volkswagen", modelo: "ID.3", slug: "x" }), "volkswagen-id-3");
  assert.equal(autocasionSlug({ marca: "BMW", modelo: "Serie 1", slug: "x" }), "bmw-serie-1");
  assert.equal(autocasionSlug(MODELS.find((m) => m.modelo === "RAV4")!), "toyota-rav-4");
  assert.equal(acUrl("seat-leon", { lo: 8000, hi: 12000 }, 1),
    "https://www.autocasion.com/coches-segunda-mano/seat-leon-ocasion/precio-desde-8000/precio-hasta-11999");
  assert.equal(acUrl("seat-leon", { lo: 100000, hi: null }, 3),
    "https://www.autocasion.com/coches-segunda-mano/seat-leon-ocasion/precio-desde-100000?page=3");
});

// ── coches.net ──────────────────────────────────────────────────────────────
const cnItem = (over: Record<string, unknown> = {}) => ({
  id: "71769445", price: 9990, km: 164864, year: 2017, hp: 110, fuelType: "Gasolina", isProfessional: true,
  make: "SEAT", model: "León", title: "SEAT León ST 1.2 TSI StSp Reference",
  url: "/seat-leon-st-12-tsi-81kw-110cv-stsp-reference-5p-gasolina-2017-en-navarra-71769445-covo.aspx",
  location: { mainProvince: "Navarra", mainProvinceId: 31 }, offerType: { id: 0, literal: "Ocasión" },
  ...over,
});
const hydration = (data: unknown) =>
  `<html><script>window.__staticRouterHydrationData = JSON.parse(${JSON.stringify(JSON.stringify(data))});</script></html>`;

test("coches.net: lee el formato nuevo (__staticRouterHydrationData) y el antiguo", () => {
  const nuevo = hydration({ loaderData: { "0-119": { initialResults: { items: [cnItem()], totalResults: 795, totalPages: 27 } } }, errors: null });
  assert.deepEqual(extractAdevintaResults(nuevo), { totalResults: 795, totalPages: 27, items: [cnItem()] });
  const antiguo = `<script>window.__INITIAL_PROPS__ = JSON.parse(${JSON.stringify(JSON.stringify({ initialResults: { items: [], totalResults: 0 } }))});</script>`;
  assert.deepEqual(extractAdevintaResults(antiguo), { totalResults: 0, totalPages: null, items: [] });
  assert.equal(extractAdevintaResults("<html>nada</html>"), null);
  assert.equal(isAdevintaBotWall("Algo en tu navegador nos hizo pensar que eres un bot"), true);
});

test("coches.net: normaliza un anuncio real y descarta los de otro modelo", () => {
  assert.deepEqual(normalizeCochesnetListing(cnItem(), LEON, "seat/leon|8000-12000"), {
    portal: "cochesnet", portal_id: "71769445",
    url: "https://www.coches.net/seat-leon-st-12-tsi-81kw-110cv-stsp-reference-5p-gasolina-2017-en-navarra-71769445-covo.aspx",
    crawl_segment: "seat/leon|8000-12000", marca: "Seat", modelo: "León", version: "ST 1.2 TSI StSp Reference",
    combustible: "Gasolina", anio: 2017, mes: null, km: 164864, potencia_cv: 110, cambio: null,
    provincia: "Navarra", vendedor: "Profesional", tipo_oferta: "Ocasión", precio: 9990,
  });
  // Slug mal resuelto: coches.net devuelve toda la marca y el Ibiza no debe entrar como León
  assert.equal(normalizeCochesnetListing(cnItem({ model: "Ibiza" }), LEON, "k"), null);
  assert.equal(normalizeCochesnetListing(cnItem({ price: 100 }), LEON, "k"), null);
  assert.equal(normalizeCochesnetListing(cnItem({ id: undefined }), LEON, "k"), null);
  assert.equal(normalizeCochesnetListing(cnItem({ isProfessional: false }), LEON, "k")!.vendedor, "Particular");
});

test("coches.net: slug con guion bajo y URL por tramo", () => {
  assert.equal(cochesnetSlug(LEON), "seat/leon");
  assert.equal(cochesnetSlug({ marca: "BMW", modelo: "Serie 1", slug: "x" }), "bmw/serie_1");
  assert.equal(cochesnetSlug({ marca: "Mercedes-Benz", modelo: "Clase A", slug: "x" }), "mercedes-benz/clase_a");
  assert.equal(cnUrl("seat/leon", { lo: 8000, hi: 12000 }, 2), "https://www.coches.net/seat/leon/segunda-mano/?MinPrice=8000&MaxPrice=11999&pg=2");
  assert.equal(cnUrl("seat/leon", { lo: 100000, hi: null }, 1), "https://www.coches.net/seat/leon/segunda-mano/?MinPrice=100000");
});

// ── Comunes ─────────────────────────────────────────────────────────────────
test("provincia por nombre: nombres oficiales, sin tildes y nombres antiguos", () => {
  assert.equal(provinciaDesdeNombre("Madrid"), "Madrid");
  assert.equal(provinciaDesdeNombre("malaga"), "Málaga");
  assert.equal(provinciaDesdeNombre("Vizcaya"), "Bizkaia");
  assert.equal(provinciaDesdeNombre("La Coruña"), "A Coruña");
  assert.equal(provinciaDesdeNombre("Islas Baleares"), "Illes Balears");
  assert.equal(provinciaDesdeNombre("Álava"), "Araba");
  assert.equal(provinciaDesdeNombre("Santa Cruz de Tenerife"), "Santa Cruz de Tenerife");
  assert.equal(provinciaDesdeNombre("Atlantis"), null);
  assert.equal(provinciaDesdeNombre(null), null);
});

test("versión desde el título y combustible enchufable", () => {
  assert.equal(versionDesdeTitulo("SEAT León ST 2.0 TDI", "Seat", "León"), "ST 2.0 TDI");
  assert.equal(versionDesdeTitulo("MERCEDES-BENZ Clase A 200d", "Mercedes-Benz", "Clase A"), "200d");
  assert.equal(versionDesdeTitulo("SEAT León", "Seat", "León"), null);
  assert.equal(normalizeFuel("Híbrido enchufable", "1.4 TSI"), "Híbrido enchufable");
  assert.equal(normalizeFuel("Electro/Gasolina", "1.4 TSI"), "Híbrido");   // AutoScout24 no cambia
});

test("portales: --portal, CRAWLER_PORTALS y por defecto AutoScout24", () => {
  assert.deepEqual(selectPortals([], undefined).map((p) => p.id), ["autoscout24"]);
  assert.deepEqual(selectPortals(["--portal=autocasion,cochesnet"], "autoscout24").map((p) => p.id), ["autocasion", "cochesnet"]);
  assert.deepEqual(selectPortals([], "autoscout24, autocasion").map((p) => p.id), ["autoscout24", "autocasion"]);
  assert.throws(() => selectPortals(["--portal=wallapop"], undefined), /Portal desconocido/);
});

test("orden de modelos: coches.net empieza cada día por uno distinto y no pierde ninguno", () => {
  const [as24] = selectPortals([], undefined);
  const [cn] = selectPortals(["--portal=cochesnet"], undefined);
  assert.deepEqual(modelOrder(as24, MODELS, "2026-11-16"), MODELS);
  const hoy = modelOrder(cn, MODELS, "2026-11-16");
  const manana = modelOrder(cn, MODELS, "2026-11-17");
  assert.notEqual(hoy[0], manana[0]);
  assert.equal(new Set(hoy).size, MODELS.length);
  assert.equal(hoy.length, MODELS.length);
});

test("partes de modelos para GitHub Actions: entre todas cubren todos, sin repetir", () => {
  assert.deepEqual(modelSlice([1, 2, 3, 4, 5], undefined), [1, 2, 3, 4, 5]);
  assert.deepEqual(modelSlice([1, 2, 3, 4, 5], ""), [1, 2, 3, 4, 5]);
  const a = modelSlice(MODELS, "1/2");
  const b = modelSlice(MODELS, "2/2");
  assert.equal(a.length + b.length, MODELS.length);
  assert.equal(new Set([...a, ...b]).size, MODELS.length);
  assert.ok(Math.abs(a.length - b.length) <= 1);
  for (const bad of ["0/2", "3/2", "1/0", "mitad", "1-2"]) assert.throws(() => modelSlice(MODELS, bad), /CRAWLER_MODEL_SLICE/);
});

test("fecha del rastreo: la misma para todos los trabajos del día", () => {
  assert.equal(runDateFrom("2026-11-16"), "2026-11-16");
  // 23:30 UTC del 16 ya es día 17 en Madrid
  assert.equal(runDateFrom(undefined, new Date("2026-11-16T23:30:00Z")), "2026-11-17");
  assert.equal(runDateFrom("", new Date("2026-11-16T10:00:00Z")), "2026-11-16");
  for (const bad of ["16/11/2026", "2026-13-45", "ayer"]) assert.throws(() => runDateFrom(bad), /CRAWLER_RUN_DATE/);
});
