# Quickstart: SVG choropleth + oblast→municipality drill-down

**Feature**: 012-map-drilldown · **Status**: Implemented (PRs #16/#17/#21)

How to regenerate the geometry/gazetteer, run the tests that cover this feature, and verify the drill-down. All commands run from the repo root with Bun installed.

## 1. Bundled data layout

| Path | Role |
|------|------|
| `packages/geo-boundaries/data/source/lau-bg.geojson` | Source: Eurostat GISCO LAU 2021, Bulgaria-filtered (265 obshtini, Cyrillic) |
| `packages/geo-boundaries/data/municipalities.geojson` | Emitted real municipality polygons, keyed `lau-<LAU_ID>` |
| `packages/geo-boundaries/data/oblasts.geojson` | Province polygons (reused from 008, unchanged) |
| `packages/geo-boundaries/data/crosswalk.json` | gazetteer id ↔ boundary feature ↔ official code (+ `lauId`) |
| `src/enrich/gazetteer/municipalities-bg.json` | **Generated** 265-entry gazetteer (source of truth) |

## 2. Regenerate the gazetteer + geometry + crosswalk

```bash
# 1) Gazetteer + municipality GeoJSON from the LAU source (spatial parent-oblast derivation).
#    Prints "municipalities: 265 | unmatched-oblast: 0 | slugs: 265".
bun run packages/geo-boundaries/scripts/generate-municipalities.ts

# 2) Join the gazetteer to lau-bg.geojson by lauId → merge municipality rows into crosswalk.json.
bun run packages/geo-boundaries/scripts/generate-crosswalk.ts
```

Expected: exactly **265** gazetteer entries, **0** unmatched oblasts, **265** unique slugs. A re-curate/index pass then links datasets to municipalities and populates the choropleth counts (PR #16: 243/265 carry counts; geometry coverage is 265/265 regardless).

## 3. Run the tests that cover this feature

```bash
# Pure logic (100% line+branch) — projection, colour scale, region aggregation, crosswalk/schema, gazetteer.
bun test apps/explorer-web/src/lib/projection.test.ts
bun test apps/explorer-web/src/lib/map-scale.test.ts
bun test apps/explorer-api/tests/regions-aggregate.test.ts
bun test packages/geo-boundaries/tests/crosswalk.test.ts packages/geo-boundaries/tests/schema.test.ts
bun test tests/unit/enrich/extractors/bg-admin-gazetteer.test.ts

# Full suite + coverage (matches CI). After #17, expect all green (981 pass / 0 fail at merge).
bun run coverage
bun run lint
bun run typecheck
```

## 4. Verify the map renders + drills down (headless E2E)

```bash
# From apps/explorer-web — Playwright drives a headless browser (no GPU needed; that's the point of SVG).
cd apps/explorer-web && bun run e2e
```

Key assertions in `apps/explorer-web/e2e/us1-map.e2e.ts`:
- The SVG map (`Карта на България`) is attached and oblasts render headlessly (SC-003).
- Clicking an oblast drills in and shows the **"← Назад към областите"** control; clicking it returns to the country view (SC-004).
- After drilling, the oblast's municipalities show their counts on the first click — the choropleth is not re-scoped by the selection (SC-005 / #21).

## 5. Manual smoke check

```bash
cd apps/explorer-web && bun run dev   # then open the printed URL
```

- The national choropleth shades 28 oblasts by dataset volume, with a legend and labels.
- Click Пловдив → the map zooms into Пловдив and its municipalities appear as a sub-choropleth aligned inside the oblast outline, each shaded by its own count.
- The dataset list narrows to Пловдив; the oblast counts elsewhere are unchanged (selection-independent).
- Click "← Назад към областите" → back to the country view.

## Troubleshooting

- **Municipality counts empty after regenerating**: run the curate/index pass so datasets link to the new municipality ids; geometry alone does not populate counts.
- **An integration test fails on `geo:bg-municipality-sofia`**: that id no longer exists — Sofia's municipality is `geo:bg-municipality-stolichna` (labelBg "Столична") in the LAU-derived gazetteer (see #17).
- **Crosswalk validation error on load**: a municipality entry must have `iso3166_2: null` and at least one of `ekatte`/`lauId`; an oblast entry must have null `ekatte`/`lauId` and a valid `iso3166_2` (`packages/geo-boundaries/src/schema.ts`).
