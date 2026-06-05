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

## ⚠️ Placeholder geometry

The polygons in the `.geojson` files are **deterministic placeholder squares**,
not authoritative shapes — they exist so the crosswalk/join logic is exercisable
offline. The **official codes** (`iso3166_2`, `ekatte`) ARE authoritative and
drive the real join. Bundling real GISCO NUTS3/LAU geometry and extending
municipality coverage to all ~265 obshtinas is the tracked R5 gap (task T062).

Regenerate the data from the gazetteer (single source of truth,
`src/enrich/gazetteer/bg-admin.ts`):

```bash
bun run explorer:gen-geo
```
