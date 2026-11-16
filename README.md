# CarScapeAI · crawler diario

Recorre cada día el mercado de coches de ocasión en España y guarda en
Supabase (esquema `market`) un anuncio por coche y portal y una foto de su
precio. Con ese histórico trabaja **Valor en Marcha**, el modelo de tasación
de CarScapeAI.

| Portal | Archivo | Notas |
|---|---|---|
| AutoScout24 | `crawler/autoscout24.ts` | Funciona desde servidores |
| Autocasión | `crawler/autocasion.ts` | **No se rastrea en GitHub Actions**: responde 403 a sus IPs. El lector está listo por si cambia |
| coches.net | `crawler/cochesnet.ts` | Desde GitHub Actions sí deja leer (probado). Va despacio, 20-40 s por página: no da tiempo a todo en un día, así que cada día empieza por un modelo distinto |

Recorre 59 modelos (`crawler/segments.ts`) por tramos de precio. Si un tramo
tiene demasiados anuncios, lo parte en dos. Solo marca un anuncio como
vendido (*baja*) si su tramo se recorrió entero hoy y ayer. Un día con un
portal bloqueado nunca da coches por vendidos.

## Cómo se ejecuta

**GitHub Actions**, gratis por ser un repositorio público
(`.github/workflows/crawler.yml`):

- Todos los días a las 01:17 UTC. Corren a la vez seis trabajos (AutoScout24
  en dos mitades y coches.net en cuatro), cada uno de menos de 6 horas, el
  límite de GitHub. Al final, uno marca las bajas del día.
- **Secreto necesario:** `SUPABASE_DB_URL`, la cadena del *Session pooler* de
  Supabase (usuario `postgres`). Se pone en *Settings → Secrets and variables →
  Actions → New repository secret*.
- **Lanzarlo a mano:** *Actions → Crawler diario → Run workflow*. El modo
  `probar` pide 3 modelos por portal y no toca la base de datos.

Este repositorio solo tiene el código del crawler. No hay datos ni claves: la
conexión a la base va en el secreto, y GitHub la tapa en los registros.

## En local

```bash
pnpm install
pnpm test
pnpm crawler --portal=autocasion --probar   # sin base de datos
SUPABASE_DB_URL=... pnpm crawler --portal=autoscout24
```

Variables: `CRAWLER_PORTALS`, `CRAWLER_MAX_MODELS`, `CRAWLER_MAX_MINUTES`,
`CRAWLER_MODEL_SLICE` (`1/2`), `CRAWLER_RUN_DATE`, `CRAWLER_SKIP_BAJAS`,
`CRAWLER_MIN_DELAY_MS` / `CRAWLER_MAX_DELAY_MS`. Están explicadas en la
cabecera de `crawler/run.ts`.

El esquema de la base de datos (`market.listings`, `listing_snapshots`,
`crawl_runs` y la función `marcar_bajas`) está en el repositorio de la web de
CarScapeAI: `supabase/sql/market_schema.sql`.
