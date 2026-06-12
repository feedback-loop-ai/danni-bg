# @danni/geo-boundaries

Bundled administrative-boundary data + gazetteer crosswalk for the map explorer
(feature `008-map-data-explorer`). Joins the mirror's geographic entities to map
polygons by **official code** (ISO-3166-2 for oblasts, EKATTE for
municipalities), never by name — per Constitution X and research R5.

## Contents

- `data/oblasts.geojson` — 28 province features (`properties.iso3166_2`)
- `data/municipalities.geojson` — sample municipality features (`properties.ekatte`)
- `data/crosswalk.json` — `entityId ↔ boundaryFeatureId ↔ official code`,
  validated against `specs/008-map-data-explorer/contracts/geo-crosswalk.schema.json`
- `src/` — Zod loaders (`load.ts`), lookup class (`crosswalk.ts`), schemas (`schema.ts`)

## Geometry

- **Oblasts** — **real** geometry from Eurostat GISCO NUTS3 (1:20M, EPSG:4326),
  filtered to Bulgaria and committed under `data/source/nuts3-bg.geojson`, joined
  to the gazetteer by the authoritative Cyrillic oblast name.
- **Municipalities** — still **deterministic placeholder squares**. Real GISCO LAU
  geometry + extending coverage to all ~265 obshtinas is the tracked R5 gap (T062).

The **official codes** (`iso3166_2`, `ekatte`) are authoritative and drive the
join regardless of geometry source.

Regenerate the data from the gazetteer (single source of truth,
`src/enrich/gazetteer/bg-admin.ts`):

```bash
bun run explorer:gen-geo
```
