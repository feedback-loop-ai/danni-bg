# @danni/geo-boundaries

Bundled administrative-boundary data + gazetteer crosswalk for the map explorer
(feature `008-map-data-explorer`). Joins the mirror's geographic entities to map
polygons by **official code** (ISO-3166-2 for oblasts, EKATTE for
municipalities), never by name — per Constitution X and research R5.

## Contents

- `data/oblasts.geojson` — 28 province features (`properties.iso3166_2`)
- `data/municipalities.geojson` — all 265 municipality features (`properties.lau_id`)
- `data/crosswalk.json` — `entityId ↔ boundaryFeatureId ↔ official code`,
  validated against `specs/008-map-data-explorer/contracts/geo-crosswalk.schema.json`
- `src/` — Zod loaders (`load.ts`), lookup class (`crosswalk.ts`), schemas (`schema.ts`)

## Geometry

- **Oblasts** — **real** geometry from Eurostat GISCO NUTS3 (1:20M, EPSG:4326),
  filtered to Bulgaria and committed under `data/source/nuts3-bg.geojson`, joined
  to the gazetteer by the authoritative Cyrillic oblast name.
- **Municipalities** — **real** geometry for all 265 obshtinas from Eurostat GISCO
  LAU 2021, committed under `data/source/lau-bg.geojson`, joined to the gazetteer by
  the official `lauId` (see `scripts/generate-municipalities.ts`). Each gazetteer
  municipality carries its parent oblast (derived spatially); the resulting
  `municipality --part_of--> oblast` hierarchy is materialised into the
  `entity_relations` knowledge graph at curate time.

The **official codes** (`iso3166_2` for oblasts, `lauId`/`ekatte` for municipalities)
are authoritative and drive the join regardless of geometry source.

Regenerate the data from the gazetteer (single source of truth,
`src/enrich/gazetteer/bg-admin.ts`):

```bash
bun run explorer:gen-geo
```
