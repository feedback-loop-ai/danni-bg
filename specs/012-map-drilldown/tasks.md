---
description: "Task list for 012-map-drilldown (retrospective — shipped)"
---

# Tasks: SVG choropleth + oblast→municipality drill-down (real 265-municipality geometry)

**Input**: Design documents from `/specs/012-map-drilldown/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/regions-api.md
**Status**: Implemented — all tasks shipped via PR #16, with #17 and #21 folded in. Tasks are marked `[X]` with the real paths they touched.

**Tests**: This feature was test-driven for the pure modules (100% line+branch) and behaviorally via Playwright E2E for the SVG render glue (Constitution VIII). Test tasks are included.

**Organization**: Grouped by user story (US1 drill-down P1, US2 selection-independence P2) after shared foundational data/geometry work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (drill-down) or US2 (selection-independence); FOUND = shared foundation

---

## Phase 1: Foundational — real geometry, gazetteer, crosswalk (blocks both stories)

**Purpose**: Replace the placeholder municipality data with real 265-municipality geometry, the generated gazetteer, and the validated crosswalk — everything the choropleth and drill-down read from.

- [X] T001 [FOUND] Add the Eurostat GISCO LAU 2021 source, Bulgaria-filtered (265 obshtini, Cyrillic names + LAU ids) at `packages/geo-boundaries/data/source/lau-bg.geojson`
- [X] T002 [FOUND] Write the generation script `packages/geo-boundaries/scripts/generate-municipalities.ts`: derive each municipality's parent oblast **spatially** (centroid-in-oblast via `geoContains`, nearest-centroid fallback via `geoDistance`), de-dupe slugs, and emit the 265-entry gazetteer + keyed municipality GeoJSON (FR-005, FR-006, FR-007, FR-009)
- [X] T003 [FOUND] Generate `src/enrich/gazetteer/municipalities-bg.json` (265 entries: `id`, `labelBg`, `labelEn`, `oblastId`, `aliases`, `lauId`) — 0 unmatched oblasts (SC-002)
- [X] T004 [FOUND] Generate `packages/geo-boundaries/data/municipalities.geojson` (real polygons keyed `lau-<LAU_ID>`) (SC-001)
- [X] T005 [FOUND] Extend the crosswalk schema with `lauId` in `packages/geo-boundaries/src/schema.ts`; require municipality entries to have `iso3166_2: null` + at least one of `ekatte`/`lauId`, and oblast entries to have null `ekatte`/`lauId` + a valid `iso3166_2` (FR-008, Constitution VII)
- [X] T006 [FOUND] Join the gazetteer to `lau-bg.geojson` by `lauId` and merge the 265 municipality rows into `packages/geo-boundaries/data/crosswalk.json` via `packages/geo-boundaries/scripts/generate-crosswalk.ts` (FR-008)
- [X] T007 [P] [FOUND] Wire the generated gazetteer into `src/enrich/gazetteer/bg-admin.ts` so curate/index consume the 265-municipality set
- [X] T008 [P] [FOUND] Unit tests: `packages/geo-boundaries/tests/schema.test.ts` (lauId rules) + `packages/geo-boundaries/tests/crosswalk.test.ts` (no orphan rows; crosswalk↔gazetteer↔GeoJSON integrity) (SC-006)
- [X] T009 [P] [FOUND] Update `tests/unit/enrich/extractors/bg-admin-gazetteer.test.ts` for the 265-municipality set

**Checkpoint**: Real geometry + gazetteer + validated crosswalk in place; choropleth layers and drill-down can be built.

---

## Phase 2: Foundational — pure SVG projection + colour scale (blocks US1)

**Purpose**: Extract all map decision/computation logic into pure, fully-covered modules so the SVG component is logic-free render glue (Constitution VIII).

- [X] T010 [FOUND] Implement the pure projection module `apps/explorer-web/src/lib/projection.ts`: `makeProjection` (one `geoMercator().fitSize` for the country), `projectWith`/`projectBoundaries` (feature → SVG `d`, centroid, bounds), and `fitTransform` (bounds → `{k,x,y}` drill-down zoom) (FR-001, FR-002, FR-003)
- [X] T011 [FOUND] Implement the pure colour scale `apps/explorer-web/src/lib/map-scale.ts`: skew-aware `rampBreakpoints`, `bucketForCount` (bucket 0 = no data), `colorForCount`, `legendStops`, light/dark ramps (FR-004)
- [X] T012 [P] [FOUND] Unit tests `apps/explorer-web/src/lib/projection.test.ts` and `apps/explorer-web/src/lib/map-scale.test.ts` at 100% line+branch

**Checkpoint**: Pure map logic complete and fully covered; the SVG component can render declaratively over it.

---

## Phase 3: User Story 1 — Drill from an oblast into its municipalities (Priority: P1) 🎯 MVP

**Goal**: A headless-renderable SVG choropleth where clicking an oblast zooms into it and reveals its real municipalities, with a way back.

**Independent Test**: Load the explorer headlessly, confirm the SVG map + oblasts render, click an oblast → "Назад към областите" appears, click it → control disappears (`us1-map.e2e.ts`).

- [X] T013 [US1] Emit `oblastEntityId` per municipality in `apps/explorer-api/src/regions-aggregate.ts` (via `parentOf` over the `part_of` graph) and add it to `RegionSummary` in `apps/explorer-api/src/schemas.ts` (FR-013)
- [X] T014 [US1] Roll municipality links up into their parent oblast in `aggregateRegions` so an oblast's count is the de-duplicated union of direct + municipality datasets, counted once (FR-016)
- [X] T015 [US1] Replace the WebGL/MapLibre map with the SVG choropleth in `apps/explorer-web/src/map/MapView.tsx`: one shared projection across oblast + municipality layers; legend, labels, hover tooltips, distinct selected/hover/chat-highlight outlines, keyboard-operable regions (FR-001, FR-002, FR-003, FR-017; keyboard operability is manually/visually verified, not in the E2E)
- [X] T016 [US1] Implement drill-down in `MapView.tsx`: clicking an oblast sets focus + applies `fitTransform` to zoom in and render that oblast's municipalities (filtered by `oblastEntityId === focus`); a "← Назад към областите" control clears focus; clicking a municipality toggle-selects it (FR-010, FR-011, FR-012)
- [X] T017 [US1] Wire `MapView` into `apps/explorer-web/src/App.tsx` (oblast + municipality layers, selected/highlight ids, `selectRegion`) and update `apps/explorer-web/src/types.ts` (`oblastEntityId` on the client `RegionSummary`)
- [X] T018 [US1] Remove `maplibre-gl` and the generic pan/zoom; drop the dependency from `package.json` / `bun.lock`
- [X] T019 [P] [US1] Unit test the region aggregation `apps/explorer-api/tests/regions-aggregate.test.ts` (`oblastEntityId`, roll-up de-duplication) (SC-007)
- [X] T020 [US1] E2E `apps/explorer-web/e2e/us1-map.e2e.ts`: map renders headlessly; clicking an oblast drills in (offers "Назад"); "Назад" returns to country view (SC-003, SC-004)

**Checkpoint**: The SVG drill-down map is fully functional and headlessly verified — MVP complete.

---

## Phase 4: User Story 2 — Selecting a region does not re-scope the choropleth (Priority: P2)

**Goal**: The choropleth stays a global "datasets per region" view; selecting/drilling a region scopes only the dataset list + chat. (PR #21)

**Independent Test**: Drill into an oblast and confirm its municipalities show counts on the first click; confirm country-view oblast counts are unchanged by having a region selected.

- [X] T021 [US2] In `apps/explorer-web/src/App.tsx`, fetch the region (choropleth) layers with a **selection-independent** filter (`geoUnitIds: []`), memoized on the non-geo filter fields (`tags`, `publisherIds`, `freshness`, `query`, `includeWithdrawn`) so selecting a region leaves `regionFilters` identity unchanged (FR-014, FR-015)
- [X] T022 [US2] Split the single data-fetch effect into a region-layers effect (`regionFilters`) and a dataset-list effect (full `filters`, which keeps the selection) in `App.tsx`
- [X] T023 [US2] Confirm drill-down E2E `apps/explorer-web/e2e/us1-map.e2e.ts` passes 3/3 with the fix (municipalities populate on the first click) (SC-005)

**Checkpoint**: Drill-down is correct on the first click; the map no longer collapses on selection.

---

## Phase 5: Stabilization — repair integration tests broken by the real gazetteer (PR #17)

**Purpose**: PR #16 merged with red CI (no branch protection). Two integration tests asserted against the gazetteer/crosswalk by meaning and broke when ids became LAU-derived.

- [X] T024 Update enrichment-guarantees SC-011 (query-by-municipality) to target `geo:bg-municipality-stolichna` (labelBg "Столична"), replacing the removed `geo:bg-municipality-sofia` (repairs feature-008 integration test SC-011; not a 012 success criterion)
- [X] T025 Update reachability SC-009 to attach the real `-stolichna` id so `geo2` resolves to a crosswalk unit (repairs feature-008 integration test SC-009; not a 012 success criterion)
- [X] T026 Confirm the full suite is green: `bun run coverage` (full suite green), `bun run lint`, `bun run typecheck` clean

**Checkpoint**: `main` green; all consumed shapes and the parity matrix consistent with the real gazetteer.

---

## Dependencies & Execution Order

- **Phase 1 (geometry/gazetteer/crosswalk)**: foundational — blocks everything. T001→T002→T003/T004→T005→T006; T007–T009 follow.
- **Phase 2 (pure projection/scale)**: foundational for US1; can run in parallel with Phase 1's test tasks.
- **US1 (Phase 3)**: depends on Phases 1 + 2 (geometry + pure logic). T013/T014 (API) parallel to T015–T018 (web); T020 last.
- **US2 (Phase 4)**: depends on US1 (drill-down must exist to be re-scoped correctly).
- **Phase 5 (#17)**: depends on the gazetteer change (Phase 1) landing.

### Parallel Opportunities

- T008, T009 (Phase 1 tests) run in parallel once data is generated.
- T012 (pure-logic tests) parallel with Phase 1.
- T013/T014 (API) parallel with T015–T018 (web) within US1.

---

## Implementation Strategy

1. **Foundation first**: real LAU geometry → 265-entry gazetteer (spatial parent) → `lauId` crosswalk, all validated (Phase 1), plus pure projection + colour scale at 100% coverage (Phase 2).
2. **MVP (US1)**: SVG choropleth + oblast→municipality drill-down, headlessly E2E-verified.
3. **Refine (US2)**: make the choropleth selection-independent so drill-down is correct on the first click (#21).
4. **Stabilize (#17)**: repair the two integration tests that asserted against the now-real gazetteer ids; confirm green CI.

## Notes

- All tasks shipped; `[X]` reflects merged work in PRs #16/#17/#21.
- The SVG component (`MapView.tsx`) is the sanctioned render-glue exception (plan Complexity Tracking); every decision/computation path is in the pure `lib/` + `regions-aggregate.ts` modules at 100% coverage.
- Cyrillic municipality names are preserved verbatim; the gazetteer↔boundary join is by official `lauId`, never by name (Constitution X).
