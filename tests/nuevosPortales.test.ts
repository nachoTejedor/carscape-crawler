// Lectores de Flexicar, OcasionPlus y Coches.com. Formas reales de sus
// respuestas (16-11-2026), recortadas. Sin red ni base de datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { flexicarSlug, normalizeFlexicarListing, searchUrl as fxUrl } from "../crawler/flexicar";
import { normalizeOcasionplusListing, ocasionplusSlug, searchUrl as opUrl } from "../crawler/ocasionplus";
import { cochescomSlug, normalizeCochescomListing, parseCochescomPage, searchUrl as ccUrl } from "../crawler/cochescom";
import { BlockedError } from "../crawler/portal";
import { bandsFor, selectPortals } from "../crawler/run";

const LEON = { marca: "Seat", modelo: "León", slug: "seat/leon" };

// ── Flexicar ────────────────────────────────────────────────────────────────
const fx = (over: Record<string, unknown> = {}) => ({
  id: 903000000286382, brand: "SEAT", model: "Leon", version: "1.4 TSI 92kW (125CV) St&Sp FR",
  carDealership: "Móstoles - Polígono Regordoño", fuel: "Gasolina", transmission: "Manual",
  km: 109599, year: 2018, price: 11690, cashPrice: 13790,
  slug: "seat-leon-14-tsi-92kw-125cv-st-ampsp-fr-gasolina-manual-mostoles-poligono-regordono_903000000286382",
  ...over,
});

test("Flexicar: URL de su API por tramo y anuncio con el precio de contado", () => {
  assert.equal(flexicarSlug(LEON), "seat/leon");
  assert.equal(fxUrl("seat/leon", { lo: 8000, hi: 12000 }, 2),
    "https://services.flexicar.es/api/v1/vehicles?brands=seat&models=leon&priceFrom=8000&priceTo=11999&page=2&size=24");
  assert.deepEqual(normalizeFlexicarListing(fx(), LEON, "seat/leon|8000-12000"), {
    portal: "flexicar", portal_id: "903000000286382",
    url: "https://www.flexicar.es/coches-ocasion/seat-leon-14-tsi-92kw-125cv-st-ampsp-fr-gasolina-manual-mostoles-poligono-regordono_903000000286382/",
    crawl_segment: "seat/leon|8000-12000", marca: "Seat", modelo: "León", version: "1.4 TSI 92kW (125CV) St&Sp FR",
    combustible: "Gasolina", anio: 2018, mes: null, km: 109599, potencia_cv: null, cambio: "Manual",
    provincia: null, vendedor: "Profesional", tipo_oferta: null, precio: 13790,
  });
  assert.equal(normalizeFlexicarListing(fx({ carDealership: "Valencia - Campanar" }), LEON, "k")!.provincia, "Valencia");
  assert.equal(normalizeFlexicarListing(fx({ cashPrice: null }), LEON, "k")!.precio, 11690);
  assert.equal(normalizeFlexicarListing(fx({ model: "Ibiza" }), LEON, "k"), null);
  assert.equal(normalizeFlexicarListing(fx({ slug: "" }), LEON, "k"), null);
});

// ── OcasionPlus ─────────────────────────────────────────────────────────────
const op = (over: Record<string, unknown> = {}) => ({
  id: "7447LBR", type: "CAR", slug: "seat-leon-15-tsi-ss-fr-dsg-con-70107km-2019-bvfvzqaq", brand: "Seat", model: "León",
  description: { short: "Seat León 1.5 TSI S&S FR DSG (150 CV)" },
  dealer: { province: "Madrid", zip: "28942" }, price: { cash: 19390, withoutFinancing: 19390, withFinancing: 17628 },
  characteristics: { kms: 70107, engine: { cv: 150, fuel: "Gasolina", transmission: "AUTO" }, registrationDate: "2019-10-08T00:00:00.000Z" },
  condition: "USED",
  ...over,
});

test("OcasionPlus: API del modelo entero y anuncio normalizado", () => {
  assert.equal(ocasionplusSlug(LEON), "Seat_León");
  assert.equal(opUrl("Seat_León", { lo: 0, hi: null }, 2),
    "https://zeus.ocasionplus.com/vehicles/search/CAR?orderBy=morePopular&brand=Seat&model=Seat_Le%C3%B3n&searchType=organic&page=2");
  assert.deepEqual(normalizeOcasionplusListing(op(), LEON, "seat/leon|0-max"), {
    portal: "ocasionplus", portal_id: "7447LBR",
    url: "https://www.ocasionplus.com/coches-segunda-mano/seat-leon-15-tsi-ss-fr-dsg-con-70107km-2019-bvfvzqaq",
    crawl_segment: "seat/leon|0-max", marca: "Seat", modelo: "León", version: "1.5 TSI S&S FR DSG (150 CV)",
    combustible: "Gasolina", anio: 2019, mes: 10, km: 70107, potencia_cv: 150, cambio: "Automático",
    provincia: "Madrid", vendedor: "Profesional", tipo_oferta: "USED", precio: 19390,
  });
  assert.equal(normalizeOcasionplusListing(op({ dealer: { zip: "46001" } }), LEON, "k")!.provincia, "Valencia");
  assert.equal(normalizeOcasionplusListing(op({ model: "Ibiza" }), LEON, "k"), null);
  assert.equal(normalizeOcasionplusListing(op({ type: "MOTO" }), LEON, "k"), null);
});

test("OcasionPlus no filtra por precio: un único tramo por modelo, sin partir", () => {
  const [p] = selectPortals(["--portal=ocasionplus"], undefined);
  assert.deepEqual(bandsFor(p), [{ lo: 0, hi: null }]);
  assert.equal(p.maxResultsPerSegment, Number.POSITIVE_INFINITY);
  const [cc] = selectPortals(["--portal=cochescom"], undefined);
  assert.ok(bandsFor(cc).length > 1);
});

// ── Coches.com ──────────────────────────────────────────────────────────────
const ccItem = (over: Record<string, unknown> = {}) => ({
  id: "be7237f3-c4de-482c-9b89-b155c9cc7d49", visibleId: "BkaXcwakK9sQ",
  make: { name: "SEAT" }, model: { name: "León" }, version: { name: "1.6TDI CR S&S Style 105" },
  fuel: { name: "Diésel" }, mileage: { amount: 200817 }, price: { amount: 2850 }, priceOffer: { amount: 2850 },
  currentProvince: { id: "28", name: "Madrid" }, registration: { month: "7", year: "2014" },
  transmission: { name: "Manual" }, engine: { powerCv: 105 }, isKm0: false, dealerId: "d4379fc2",
  ...over,
});
const ccPage = (items: unknown[], total: number) =>
  `<html><a href="https://www.coches.com/coches-segunda-mano/ocasion-seat-leon-105-16tdi-cr-s_s-style-105.htm?id=BkaXcwakK9sQ">x</a>` +
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { classifieds: { total, classifiedList: items } } } })}</script></html>`;

test("Coches.com: lee total y anuncios con su enlace, y normaliza", () => {
  assert.equal(cochescomSlug(LEON), "seat-leon");
  assert.equal(ccUrl("seat-leon", { lo: 8000, hi: 12000 }, 3),
    "https://www.coches.com/coches-segunda-mano/seat-leon.htm?precio_desde=8000&precio_hasta=11999&page=3");
  // 1 de 20 sin enlace (5 %): se lee la página y ese anuncio no se guarda
  const relleno = Array.from({ length: 18 }, (_, i) => ccItem({ id: `r${i}`, visibleId: "BkaXcwakK9sQ" }));
  const { total, items } = parseCochescomPage(ccPage([ccItem(), ccItem({ id: "otro", visibleId: "SinEnlace1" }), ...relleno], 969));
  assert.equal(total, 969);
  assert.deepEqual(normalizeCochescomListing(items[0], LEON, "seat/leon|500-4000"), {
    portal: "cochescom", portal_id: "be7237f3-c4de-482c-9b89-b155c9cc7d49",
    url: "https://www.coches.com/coches-segunda-mano/ocasion-seat-leon-105-16tdi-cr-s_s-style-105.htm?id=BkaXcwakK9sQ",
    crawl_segment: "seat/leon|500-4000", marca: "Seat", modelo: "León", version: "1.6TDI CR S&S Style 105",
    combustible: "Diésel", anio: 2014, mes: 7, km: 200817, potencia_cv: 105, cambio: "Manual",
    provincia: "Madrid", vendedor: "Profesional", tipo_oferta: null, precio: 2850,
  });
  // Sin enlace en la página no se guarda (no se inventa la dirección)
  assert.equal(normalizeCochescomListing(items[1], LEON, "k"), null);
  assert.equal(normalizeCochescomListing({ ...items[0] as object, model: { name: "Ibiza" } }, LEON, "k"), null);
  assert.throws(() => parseCochescomPage("<html>nada</html>"), BlockedError);
  // Muchos anuncios sin enlace (la página cambió): el tramo no se da por recorrido
  assert.throws(() => parseCochescomPage(ccPage([ccItem(), ccItem({ id: "a", visibleId: "SinEnlace1" }), ccItem({ id: "b", visibleId: "SinEnlace2" })], 3)), /sin enlace/);
});

test("un tramo solo cuenta como completo si se vio y se guardó casi todo", async () => {
  const { motivoIncompleto } = await import("../crawler/run");
  assert.equal(motivoIncompleto(20, 20, 19), null);
  assert.equal(motivoIncompleto(19, 20, 19), null);
  assert.match(motivoIncompleto(17, 20, 17)!, /Solo 17 de 20/);
  // El lector descarta casi todo (campo o enlaces cambiados): no hay bajas falsas
  assert.match(motivoIncompleto(20, 20, 1)!, /Solo se guardaron 1 de 20/);
  assert.equal(motivoIncompleto(20, 20, 10), null);
  // Tramos pequeños: con algo guardado vale; sin nada guardado, nunca completo
  assert.equal(motivoIncompleto(3, 3, 1), null);
  assert.match(motivoIncompleto(3, 3, 0)!, /ninguno de 3/);
  assert.equal(motivoIncompleto(0, 0, 0), null);
});

test("modelo y alias: 'Clase GLC' es el GLC; un modelo que el portal no vende no se busca", async () => {
  const { esElModelo } = await import("../crawler/portal");
  const { MODELS } = await import("../crawler/segments");
  const { modelosDe } = await import("../crawler/run");
  const glc = MODELS.find((m) => m.modelo === "GLC")!;
  assert.equal(esElModelo("Clase GLC", glc), true);
  assert.equal(esElModelo("GLC", glc), true);
  assert.equal(esElModelo("GLC Coupé", glc), false);
  assert.equal(esElModelo("", glc), false);
  const [op] = selectPortals(["--portal=ocasionplus"], undefined);
  const [cc] = selectPortals(["--portal=cochescom"], undefined);
  assert.ok(!modelosDe(op).some((m) => m.modelo === "Leaf"));
  assert.ok(modelosDe(cc).some((m) => m.modelo === "Leaf"));
});

test("Coches.com: los Km 0 enlazan a /km0/ y también se leen", () => {
  const km0 = ccItem({ id: "k1", visibleId: "Lc4ZykU8HuVB", isKm0: true });
  const html = `<a href="https://www.coches.com/km0/seminuevo-cupra-born-231-e-boost-pack-170kw-59kwh.htm?id=Lc4ZykU8HuVB">x</a>` +
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { classifieds: { total: 1, classifiedList: [km0] } } } })}</script>`;
  const { items } = parseCochescomPage(html);
  const row = normalizeCochescomListing(items[0], LEON, "k")!;
  assert.equal(row.url, "https://www.coches.com/km0/seminuevo-cupra-born-231-e-boost-pack-170kw-59kwh.htm?id=Lc4ZykU8HuVB");
  assert.equal(row.tipo_oferta, "Km 0");
});
