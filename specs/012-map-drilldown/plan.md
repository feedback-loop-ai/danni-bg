# Implementation Plan: SVG choropleth + oblast→municipality drill-down (real 265-municipality geometry)

**Branch**: `012-map-drilldown` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/012-map-drilldown/spec.md`
**Status**: Implemented — merged via PR #16 (`feat(map): SVG choropleth + real 265-municipality geometry + oblast→municipality drill-down`), PR #17 (`fix(tests): repair 2 integration tests broken by 013 map overhaul`), PR #21 (`fix(map): don't re-scope the choropleth by its own region selection`).

## Summary

Replace the unverifiable WebGL/MapLibre map (six placeholder municipality squares, seven-entry gazetteer stub) with a **declarative SVG D3-geo choropleth** that renders headlessly, source **real geometry for all 265 Bulgarian municipalities** from Eurostat GISCO LAU 2021, and add an **oblast→municipality drill-down**.

**Technical approach**: A pure projection module (`d3-geo` `geoMercator().fitSize` + `geoPath`) turns boundary GeoJSON into SVG path `d` strings, label centroids, and bounding boxes; one projection is fitted to the country once and shared across the oblast and municipality layers so they align. `MapView.tsx` is plain SVG/DOM render glue over those pure outputs, holding only drill-down focus state and applying a `fitTransform` to zoom into a clicked oblast. A skew-aware sequential colour scale (`map-scale.ts`, pure) buckets dataset counts. A generation script reads the Bulgaria-filtered LAU GeoJSON, derives each municipality's parent oblast **spatially** (centroid-in-oblast, nearest-centroid fallback) and emits the 265-entry gazetteer (`src/enrich/gazetteer/municipalities-bg.json`), the keyed municipality GeoJSON, and the merged crosswalk (now carrying `lauId`). The region-aggregation (`regions-aggregate.ts`, pure) emits `oblastEntityId` per municipality to drive grouping and rolls municipality links up into their parent oblast for de-duplicated counts. PR #21 splits the App's data-fetch effects so the choropleth layers use a **selection-independent** filter (`geoUnitIds` stripped), keeping the map a global view; PR #17 repaired two integration tests that asserted against the now-real gazetteer ids.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x (generation scripts + API + tooling); same TS for the React SPA
**Primary Dependencies**: `d3-geo` (projection, path, centroid, contains, distance) — new; `lucide-react` (back-arrow icon). **Removed**: `maplibre-gl`. Reuses `packages/geo-boundaries` (Zod boundary/crosswalk schemas), `apps/explorer-api` region aggregation, and the existing curate/gazetteer pipeline
**Storage**: No new persistent store. Bundled static data: `packages/geo-boundaries/data/source/lau-bg.geojson` (source), `packages/geo-boundaries/data/municipalities.geojson` (keyed boundaries), `packages/geo-boundaries/data/crosswalk.json`, `src/enrich/gazetteer/municipalities-bg.json` (gazetteer source of truth). Choropleth counts read from the existing mirror store via the region endpoints
**Testing**: Vitest (+ @vitest/coverage-v8) at 100% line+branch for the pure modules — `projection.ts`, `map-scale.ts`, `regions-aggregate.ts`, geo-boundaries crosswalk/schema, and the updated gazetteer extractor; Playwright E2E (`us1-map.e2e.ts`) for the headless map render and drill-down behaviour. Two pre-existing integration tests updated to the LAU-derived ids (#17)
**Target Platform**: Self-hostable Linux service serving the static SPA; desktop-first modern browsers + headless Chromium for E2E
**Project Type**: Web application (React SPA + Bun/Hono API) plus a bundled geo-boundaries package and generation tooling, layered on the existing MCP-mirror monorepo
**Performance Goals**: Map renders and screenshot-tests headlessly (the original WebGL map could not); drill-down zoom is an instant SVG transform; colour scale and projection are pure and computed once per layer
**Constraints**: No GPU dependency (SVG, headless-renderable — FR-001); Cyrillic municipality names preserved verbatim (Constitution X); join by official LAU id, never by name (Constitution X); pure logic at 100% coverage with the SVG render glue validated by E2E (Constitution VIII); choropleth must not silently re-scope on selection (FR-014/#21)
**Scale/Scope**: 28 oblasts + **265** municipalities; 2 user stories (P1 drill-down, P2 selection-independence); 16 functional requirements

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. AI-Native / read-only, faithful | ✅ Pass | The map reads the curated mirror via existing region endpoints; it never mutates authoritative data. Municipality names are passed through verbatim from the LAU source |
| II. Spec-Driven Development | ✅ Pass | This retrospective spec → plan → tasks captures shipped work; artifacts in this dir |
| III. Contract-First | ✅ Pass | The only API-shape change — `RegionSummary.oblastEntityId` and crosswalk `lauId` — is documented in `contracts/` and `data-model.md`; the crosswalk shape is Zod-validated (`packages/geo-boundaries/src/schema.ts`) |
| IV. Operational Excellence | ➖ N/A | Pure client render + static data generation; no new server runtime behaviour or health surface |
| V. Simplicity & YAGNI | ✅ Pass | SVG over WebGL drops a heavy dep and the unverifiable render path; spatial parent derivation avoids needing an external LAU↔NUTS3 table; no new store. Each `d3-geo` use cites a concrete need (project/centroid/contains/distance/bounds) |
| VI. Fast Feedback Loops | ✅ Pass | Pure projection/scale/aggregation modules unit-test in milliseconds; the map is now E2E-verifiable headlessly, closing the inner-loop gap WebGL left open |
| VII. Type Safety & Validation | ✅ Pass | TS strict; the bundled crosswalk + boundary GeoJSON are Zod-validated at load (`schema.ts`), so a malformed bundle fails fast. LAU id codes are regex-checked |
| VIII. 100% Coverage & Parity | ✅ Pass | All decision/computation logic (`projection.ts`, `map-scale.ts`, `regions-aggregate.ts`, crosswalk/schema, gazetteer extractor) is at 100% line+branch. The SVG render glue in `apps/explorer-web/src/map/MapView.tsx` is the sanctioned render-glue exception (see Complexity Tracking), validated behaviorally by the `us1-map.e2e.ts` drill-down E2E |
| IX. Data Freshness & Sync Integrity | ✅ Pass | Choropleth aggregates derive from the mirror's freshness-bearing dataset records via the existing region endpoints; this feature adds no path that can return data without the mirror's freshness metadata |
| X. Bulgarian-Locale Awareness | ✅ Pass | Cyrillic `LAU_NAME` preserved byte-for-byte in `labelBg`; `labelEn` is a clearly-derived transliteration helper; the gazetteer↔boundary join uses official `lauId`/EKATTE/ISO codes, never names (Constitution X, FR-008) |
| XI. Respectful Crawling | ➖ N/A | No portal crawling; LAU geometry is a one-time bundled open dataset, not a crawl target |

**Gate result**: PASS (one documented, bounded deviation under Principle VIII — recorded in Complexity Tracking). Notably, replacing WebGL with SVG **removes** the prior 008 render-glue blind spot for the choropleth itself: the map is now behaviorally testable rather than excluded for lack of any headless signal.

## Project Structure

### Documentation (this feature)

```text
specs/012-map-drilldown/
├── plan.md              # This file
├── spec.md              # User stories, FRs, success criteria
├── research.md          # Phase 0 decisions (WebGL→SVG, LAU source, spatial parent, selection-independence)
├── data-model.md        # Municipality gazetteer entry, boundary feature, crosswalk entry, RegionSummary
├── quickstart.md        # Regenerate geometry, run unit + E2E tests, verify drill-down
├── contracts/
│   ├── regions-api.md    # GET /api/regions?level= response incl. oblastEntityId; crosswalk lauId addition
│   └── .gitkeep
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Implementation tasks (all [X], shipped)
```

### Source Code (repository root)

```text
packages/
└── geo-boundaries/                       # bundled admin-boundary data + crosswalk
    ├── data/
    │   ├── source/
    │   │   └── lau-bg.geojson             # Eurostat GISCO LAU 2021, BG-filtered (265 obshtini, Cyrillic)
    │   ├── municipalities.geojson         # real municipality polygons, keyed `lau-<LAU_ID>`
    │   ├── oblasts.geojson                # province polygons (reused from 008, unchanged)
    │   └── crosswalk.json                 # gazetteer id ↔ boundary feature ↔ official code (+ lauId)
    ├── scripts/
    │   ├── generate-municipalities.ts     # LAU → gazetteer (spatial parent) + municipality GeoJSON
    │   └── generate-crosswalk.ts          # joins gazetteer ↔ LAU by lauId → crosswalk entries
    ├── src/
    │   └── schema.ts                      # Zod boundary/crosswalk schemas (adds lauId)
    └── tests/
        ├── crosswalk.test.ts
        └── schema.test.ts

src/enrich/gazetteer/
├── municipalities-bg.json                 # GENERATED — 265-entry gazetteer (source of truth)
└── bg-admin.ts                            # oblast + municipality gazetteer wiring (consumes the JSON)

apps/explorer-api/src/
├── regions-aggregate.ts                   # pure RegionSummary aggregation (rollup + oblastEntityId)
└── schemas.ts                             # RegionSummary gains oblastEntityId

apps/explorer-web/src/
├── lib/
│   ├── projection.ts                      # PURE: GeoJSON → SVG path/centroid/bounds; shared projection; fitTransform
│   └── map-scale.ts                       # PURE: skew-aware sequential colour scale + legend
├── map/
│   └── MapView.tsx                        # SVG choropleth + drill-down render glue (replaces MapLibre)
└── App.tsx                                # selection-independent region-layers effect (#21)

apps/explorer-web/e2e/
└── us1-map.e2e.ts                         # headless render + drill-down (zoom in / Назад) E2E

# Test fixtures repaired by #17 (assert against the LAU-derived ids):
tests/.../enrichment-guarantees (SC-011)   # query-by-municipality now targets geo:bg-municipality-stolichna
tests/.../reachability (SC-009)            # attaches the real -stolichna id
```

**Structure Decision**: The rework stays within the web-application shape established by 008-map-data-explorer. The map's pure logic lives in `apps/explorer-web/src/lib/` (100% covered), the SVG render glue in `apps/explorer-web/src/map/`, the boundary/gazetteer data + generation in `packages/geo-boundaries`, and the gazetteer source of truth in `src/enrich/gazetteer/`. No new package or store is introduced; `maplibre-gl` is removed.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle VIII sanctioned render-glue exception: the SVG render in `apps/explorer-web/src/map/MapView.tsx` is validated by Playwright E2E (`us1-map.e2e.ts`) rather than 100% line coverage | The component is DOM/SVG render glue + drill-down focus state; its visual output (path painting, zoom transform, legend/labels) is meaningfully verified only by exercising the rendered DOM, which the E2E does. **All** decision/computation logic is extracted into pure, fully-covered modules: `lib/projection.ts` (projection, path, centroid, bounds, `fitTransform`), `lib/map-scale.ts` (bucketing, breakpoints, legend), and `apps/explorer-api/src/regions-aggregate.ts` (counts, roll-up, `oblastEntityId`) | Faking 100% via `istanbul ignore` is forbidden by the constitution. Unlike the 008 WebGL exclusion (which had *no* headless signal at all), this SVG glue is genuinely behaviorally tested headlessly — the exception here is narrower and honestly covered |

## Phase Outputs

- **Phase 0** → `research.md`: WebGL→SVG decision; LAU 2021 as the geometry source; spatial (centroid-in-polygon) parent derivation; join-by-`lauId`; skew-aware colour scale; shared-projection alignment; selection-independent choropleth (#21).
- **Phase 1** → `data-model.md` (municipality gazetteer entry, boundary feature, crosswalk entry, RegionSummary), `contracts/regions-api.md` (regions response incl. `oblastEntityId`; crosswalk `lauId`), `quickstart.md`.
- **Phase 2** → `tasks.md` (shipped, all `[X]`, real paths).

## Post-Design Constitution Re-Check

Re-evaluated against the shipped artifacts: the only contract change (`RegionSummary.oblastEntityId`, crosswalk `lauId`) is documented before/with the code and Zod-validated (III, VII); Cyrillic names are verbatim and joins are code-based (X); all logic is extracted to fully-covered pure modules with the SVG glue behaviorally tested (VIII); no new write path or store (I, V, IX). **Gate still PASS** with the single documented, narrowly-scoped Principle VIII deviation.
