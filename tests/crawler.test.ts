// Crawler diario (crawler/): normalización de anuncios de AutoScout24 y
// partición de tramos de precio. Sin red ni base de datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAs24Listing, normalizeFuel, normalizeTransmission, normalizeSeller, parsePowerCv, parseRegistration,
} from "../crawler/normalize";
import { provinciaDesdeCp } from "../crawler/provincias";
import { basePriceBands, splitBand, segmentKey, MIN_BAND_WIDTH_EUR } from "../crawler/segments";
import { searchUrl } from "../crawler/autoscout24";
import { isJunkOrDamagedListing } from "../lib/listingQuality";

const LEON = { marca: "Seat", modelo: "León", slug: "seat/leon" };

// Forma real de un anuncio del __NEXT_DATA__ de autoscout24.es (oct. 2026), recortada
const anuncio = (over: Record<string, unknown> = {}) => ({
  id: "8b7bac5d-4013-481c-8991-1cc210f0a040",
  price: { priceRaw: 11945, priceFormatted: "€ 11.945" },
  url: "/anuncios/seat-leon-1-2-tsi-ss-style-110-gasolina-blanco-cat_ma64mo15869-8b7bac5d",
  vehicle: { make: "SEAT", model: "Leon", modelVersionInput: "1.2 TSI S&S Style 110", offerType: "U",
    transmission: "manual", fuel: "Gasolina", mileageInKm: "112.021 km" },
  location: { countryCode: "ES", zip: "08020", city: "SANT ANDREU" },
  seller: { type: "Dealer" },
  tracking: { firstRegistration: "06-2018", mileage: "112021", price: "11945" },
  vehicleDetails: [{ data: "81 kW (110 CV)", iconName: "speedometer" }],
  ...over,
});

test("normaliza un anuncio real al contrato de market.listings", () => {
  const row = normalizeAs24Listing(anuncio(), LEON, "seat/leon|8000-12000");
  assert.deepEqual(row, {
    portal: "autoscout24",
    portal_id: "8b7bac5d-4013-481c-8991-1cc210f0a040",
    url: "https://www.autoscout24.es/anuncios/seat-leon-1-2-tsi-ss-style-110-gasolina-blanco-cat_ma64mo15869-8b7bac5d",
    crawl_segment: "seat/leon|8000-12000",
    marca: "Seat", modelo: "León",          // nombre canónico del catálogo, no el del portal
    version: "1.2 TSI S&S Style 110",
    combustible: "Gasolina", anio: 2018, mes: 6, km: 112021, potencia_cv: 110,
    cambio: "Manual", provincia: "Barcelona", vendedor: "Profesional", tipo_oferta: "U", precio: 11945,
  });
});

test("descarta anuncios sin id, de otro país, baratos o de piezas", () => {
  assert.equal(normalizeAs24Listing(anuncio({ id: undefined }), LEON, "k"), null);
  assert.equal(normalizeAs24Listing(anuncio({ location: { countryCode: "PT", zip: "1000" } }), LEON, "k"), null);
  assert.equal(normalizeAs24Listing(anuncio({ price: { priceRaw: 450 }, tracking: { price: "450" } }), LEON, "k"), null);
  const piezas = anuncio({ vehicle: { make: "SEAT", model: "Leon", modelVersionInput: "1.6 TDI para piezas", fuel: "Diésel" } });
  assert.equal(normalizeAs24Listing(piezas, LEON, "k"), null);
});

test("combustible: híbrido enchufable por la versión, GNC fuera del dominio", () => {
  assert.equal(normalizeFuel("Electro/Gasolina", "1.4 e-Hybrid DSG"), "Híbrido enchufable");
  assert.equal(normalizeFuel("Electro/Gasolina", "2.0 Hybrid Active Tech"), "Híbrido");
  assert.equal(normalizeFuel("Eléctrico", "58 kWh"), "Eléctrico");
  assert.equal(normalizeFuel("Diésel", ""), "Diésel");
  assert.equal(normalizeFuel("Gas licuado (GLP)", ""), "GLP");
  assert.equal(normalizeFuel("Gas natural (CNG)", ""), null);
  assert.equal(normalizeFuel(undefined, ""), null);
});

test("cambio, vendedor, potencia y matriculación", () => {
  assert.equal(normalizeTransmission("Automático"), "Automático");
  assert.equal(normalizeTransmission("manual"), "Manual");
  assert.equal(normalizeSeller("Dealer"), "Profesional");
  assert.equal(normalizeSeller("Private"), "Particular");
  assert.equal(parsePowerCv([{ iconName: "speedometer", data: "110 kW (150 CV)" }]), 150);
  assert.equal(parsePowerCv([]), null);
  assert.deepEqual(parseRegistration("09-2022"), { anio: 2022, mes: 9 });
  assert.deepEqual(parseRegistration("2019"), { anio: 2019, mes: null });
  assert.deepEqual(parseRegistration(undefined), { anio: null, mes: null });
});

test("provincia desde el código postal, también sin el cero inicial", () => {
  assert.equal(provinciaDesdeCp("28850"), "Madrid");
  assert.equal(provinciaDesdeCp("2870"), "Albacete");
  assert.equal(provinciaDesdeCp("48001"), "Bizkaia");
  assert.equal(provinciaDesdeCp("99999"), null);
  assert.equal(provinciaDesdeCp(""), null);
});

test("tramos de precio: cubren todo sin huecos y se parten en dos", () => {
  const bands = basePriceBands();
  for (let i = 1; i < bands.length; i++) assert.equal(bands[i].lo, bands[i - 1].hi);
  assert.equal(bands.at(-1)?.hi, null);
  assert.deepEqual(splitBand({ lo: 8000, hi: 12000 }), [{ lo: 8000, hi: 10000 }, { lo: 10000, hi: 12000 }]);
  assert.deepEqual(splitBand({ lo: 100000, hi: null }), [{ lo: 100000, hi: 200000 }, { lo: 200000, hi: null }]);
  assert.equal(splitBand({ lo: 10000, hi: 10000 + MIN_BAND_WIDTH_EUR }), null);
  assert.equal(segmentKey(LEON, { lo: 100000, hi: null }), "seat/leon|100000-max");
});

test("URL de búsqueda: tramo [desde, hasta) sin solapes y solo España", () => {
  const u = new URL(searchUrl("seat/leon", { lo: 8000, hi: 12000 }, 3));
  assert.equal(u.pathname, "/lst/seat/leon");
  assert.equal(u.searchParams.get("pricefrom"), "8000");
  assert.equal(u.searchParams.get("priceto"), "11999");
  assert.equal(u.searchParams.get("cy"), "E");
  assert.equal(u.searchParams.get("page"), "3");
  assert.equal(new URL(searchUrl("seat/leon", { lo: 100000, hi: null }, 1)).searchParams.has("priceto"), false);
});

test("el filtro de piezas compartido sigue funcionando", () => {
  assert.equal(isJunkOrDamagedListing("BMW 320d Unfallwagen"), true);
  assert.equal(isJunkOrDamagedListing("Seat León para despiece"), true);
  assert.equal(isJunkOrDamagedListing("Seat León 1.5 TSI FR"), false);
});
