# Phase 0 Research: SVG choropleth + oblast→municipality drill-down

**Feature**: 012-map-drilldown
**Date**: 2026-06-16
**Status**: Retrospective — decisions recovered from the shipped code and PRs #16/#17/#21.

This records the decisions behind replacing the WebGL/MapLibre map with an SVG choropleth, sourcing real 265-municipality geometry, and adding the drill-down — plus the follow-up fixes (#17, #21).

## R1 — Rendering technology: SVG (D3-geo) over WebGL/MapLibre

**Decision**: Render the choropleth as declarative SVG paths produced by a `d3-geo` `geoMercator` projection (`geoPath`), not WebGL via MapLibre. Drop the `maplibre-gl` dependency.

**Rationale**:
- The 008 WebGL map could not render in a headless environment — no GPU → shader-compile failure — so the map could never be screenshot- or E2E-verified. Under Constitution VIII it had to be excluded as render glue with *no* headless coverage signal at all.
- MapLibre is heavy for a single-country choropleth: tile/style machinery the explorer does not use.
- SVG renders + screenshot-tests headlessly (closing the verification gap), is lighter, trivially styleable (legend, labels, hover tooltips, distinct selected/hover/chat-highlight outlines), and keyboard-operable.

**Alternatives considered**: keep MapLibre (rejected — unverifiable headless, heavy); canvas 2D (rejected — still imperative pixel glue with weak DOM-level test signal, where SVG paths are inspectable DOM).

**Evidence**: `apps/explorer-web/src/lib/projection.ts`, `apps/explorer-web/src/map/MapView.tsx`, removal of `maplibre-gl` from `package.json`/`bun.lock` (PR #16).

## R2 — Shared, country-fitted projection across layers

**Decision**: Fit one `geoMercator` projection to the whole country once (`makeProjection`) and reuse it to project both the oblast layer and the municipality layer (`projectWith`). Each feature yields an SVG path `d`, a label centroid (`cx`/`cy`), and a bounding box.

**Rationale**: A shared projection guarantees the municipality sub-choropleth sits exactly inside the oblast outline when drilled in; re-fitting per layer would misalign them. Keeping projection logic pure (out of the component) makes it unit-testable and keeps the render declarative.

**Evidence**: `makeProjection`/`projectWith`/`projectBoundaries` in `apps/explorer-web/src/lib/projection.ts`; `projection.test.ts`. `MapView` calls `makeProjection(boundaries, W, H)` once and `projectWith` for both layers.

## R3 — Drill-down zoom via a pure `fitTransform`

**Decision**: Clicking an oblast sets a focus state and applies a pure `fitTransform(bounds, W, H, pad)` that computes a `{k, x, y}` translate+scale fitting the oblast's bounding box (with padding) into the viewBox. "← Назад към областите" clears the focus.

**Rationale**: A pure bounds→transform function is fully unit-testable and avoids MapLibre's imperative camera; the SVG just applies the transform. The earlier generic pan/zoom is removed in favour of this purposeful drill-down.

**Evidence**: `fitTransform` in `projection.ts` (+ test); focus state, `back()`, and the `Назад към областите` control in `MapView.tsx`.

## R4 — Real geometry source: Eurostat GISCO LAU 2021

**Decision**: Source municipality geometry from Eurostat GISCO LAU 2021 (1:1M, EPSG:4326), filtered to Bulgaria → `packages/geo-boundaries/data/source/lau-bg.geojson` (265 *obshtini* with Cyrillic `LAU_NAME` + `LAU_ID`).

**Rationale**: Closes the T062 placeholder gap (six squares + a 7-entry stub) with authoritative, openly-licensed boundaries that already carry Cyrillic names and official LAU ids. 1:1M resolution is adequate for a national choropleth and keeps the bundle small.

**Evidence**: `packages/geo-boundaries/data/source/lau-bg.geojson`; the script header in `generate-municipalities.ts`. The shipped gazetteer has exactly 265 entries.

## R5 — Spatial parent-oblast derivation (no LAU↔NUTS table)

**Decision**: Assign each municipality's parent oblast by testing which real oblast polygon contains the municipality centroid (`geoCentroid` + `geoContains`), with a nearest-oblast-centroid fallback (`geoDistance`) for any centroid that lands outside every polygon due to simplification.

**Rationale**: Avoids needing an external LAU↔NUTS3 crosswalk table and keeps the derivation self-contained against geometry already bundled. The fallback guarantees **zero unmatched** municipalities even with coastline/border simplification.

**Alternatives considered**: bundle an official LAU↔NUTS3 lookup (rejected — extra data dependency to maintain when geometry already encodes containment).

**Evidence**: `parentOblastBoundary()` in `generate-municipalities.ts`; the script prints `unmatched-oblast` (0 in the shipped run, per PR #16 "0 unmatched").

## R6 — Join by official LAU id; gazetteer + crosswalk shape

**Decision**: The gazetteer (`src/enrich/gazetteer/municipalities-bg.json`) is the source of truth (`id`, `labelBg`, `labelEn`, `oblastId`, `aliases`, `lauId`). `generate-crosswalk.ts` joins it to `lau-bg.geojson` **by `lauId`** to emit municipality crosswalk entries keyed `lau-<LAU_ID>`; the crosswalk schema gains a `lauId` field, validated by Zod at load. Slugs are de-duplicated so ids are unique; English labels are derived via transliteration and clearly separate from the authoritative Bulgarian name.

**Rationale**: Joining by an official code (not name) satisfies Constitution X and survives name variants/duplicates. Keeping the gazetteer authoritative and emitting geometry+crosswalk from it keeps a single source of truth.

**Evidence**: gazetteer JSON shape; `lauId` in `crosswalkEntrySchema` (`packages/geo-boundaries/src/schema.ts`) with the municipality superRefine requiring an `ekatte` or `lauId`; `aliases: ["Община <name>"]` so the curate extractor matches both phrasings.

## R7 — Skew-aware sequential colour scale

**Decision**: Bucket counts into five non-empty buckets plus a reserved "no data" bucket, with breakpoints at `[1, 10%, 25%, 50%, 75%]` of the max (monotonic, deduped, clamped so small maxima still yield a valid scale). Light and dark ramps; a legend lists each bucket's starting count.

**Rationale**: Dataset counts are heavily skewed (a few oblasts hold hundreds, most a handful); a linear ramp washes everything into one shade. Emphasising the low end keeps differences visible. Pure and fully unit-tested.

**Evidence**: `rampBreakpoints`/`bucketForCount`/`colorForCount`/`legendStops` in `apps/explorer-web/src/lib/map-scale.ts` (+ `map-scale.test.ts`).

## R8 — `oblastEntityId` on RegionSummary + hierarchical roll-up

**Decision**: `aggregateRegions` emits each municipality's parent `oblastEntityId` (via a `parentOf` resolver over the `part_of` graph) so the client groups municipalities under their oblast and drives the drill-down; an optional `rollup` maps a municipality link to its parent oblast so an oblast's count is the de-duplicated union of datasets linked to it directly and to any of its municipalities (counted once even when reached by multiple links).

**Rationale**: The drill-down needs to know which oblast each municipality belongs to (P1, FR-013); oblast counts must not double-count datasets that touch both the oblast and its municipalities (FR-016).

**Evidence**: `aggregateRegions` in `apps/explorer-api/src/regions-aggregate.ts`; `oblastEntityId` in `RegionSummary` (`schemas.ts`); `regions-aggregate.test.ts`.

## R9 — Choropleth must be selection-independent (PR #21)

**Decision**: Fetch the region (choropleth) layers with a **selection-independent** filter — `geoUnitIds` stripped — memoized on the non-geo filter fields, and split the single data effect into a region-layers effect (`regionFilters`) and a dataset-list effect (full `filters`, which keeps the selection).

**Rationale**: `selectRegion` writes the clicked entity into `filters.geoUnitIds`, and both choropleth layers had been fetched with `filters`. So selecting a region re-scoped the map itself: the municipality layer refetched scoped to "datasets directly tagged with that oblast" — a subset after the municipality→oblast roll-up — so drilled-in municipalities lost their counts on the first click and only settled after another interaction. The choropleth is a global "datasets per region" view; selection must scope only the dataset list + chat.

**Evidence**: `regionFilters` memo + split effects in `apps/explorer-web/src/App.tsx` (PR #21 diff); E2E `us1-map.e2e.ts` passes 3/3.

## R10 — Repair integration tests broken by the real gazetteer (PR #17)

**Decision**: Update the two full-suite integration tests that asserted against the gazetteer/crosswalk by meaning (not as opaque tokens): Sofia's municipality is now `geo:bg-municipality-stolichna` (labelBg "Столична"), not the old `geo:bg-municipality-sofia`.

**Rationale**: PR #16 merged with red CI (no branch protection, `--auto`). The enrichment-guarantees SC-011 query-by-municipality recovered nothing (old id gone) and reachability SC-009's `geo2` mapped to no crosswalk unit. Both now target the real `-stolichna` id; other `-sofia` references are opaque FTS/link tokens and intentionally unchanged.

**Evidence**: PR #17 body; full suite 981 pass / 0 fail after the fix.

## Resolved unknowns

- No remaining `NEEDS CLARIFICATION`. All decisions are backed by shipped code.
- Tracked carry-over: a re-curate/index pass over the new gazetteer populates dataset→municipality counts; PR #16 reports 243/265 municipalities carry counts after that pass (geometry coverage is full at 265/265 regardless).
