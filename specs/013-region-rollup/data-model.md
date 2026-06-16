# Phase 1 Data Model — 013-region-rollup

**Date**: 2026-06-16
**Status**: Implemented. Describes the shapes the roll-up reads and emits. No new persisted
table or migration — the feature reads the existing `entity_relations` table (owned by spec 016)
and the bundled geo crosswalk, and changes how already-extracted placements are *bucketed*.

---

## Entities & shapes

### `part_of` edge (read; owned by spec 016)

A row in the `entity_relations` table whose `predicate` is `part_of`. Read in bulk via
`EntityRelationsRepo.byPredicate(ENTITY_PREDICATES.PART_OF)` (`src/store/repos/entity-relations.ts`)
and projected by `ReadBridge.partOfParents()` into a `Map<municipalityId, oblastId>`.

| Field | Type | Meaning |
|-------|------|---------|
| `subject_id` | entity id (`geo:bg-municipality-*`) | the municipality |
| `predicate` | `'part_of'` | the administrative-containment relation |
| `object_id` | entity id (`geo:bg-oblast-*`) | the parent oblast |
| `confidence` | number | edge confidence (not used by the roll-up; level is structural) |

`partOfParents()` collapses these to `subject_id → object_id`. **Empty until a curate pass
materialises the graph** — in which case the oblast roll-up degrades to direct links only (no
municipality contributions), never crashing.

### `DatasetGeoLink` (input to the aggregator)

One dataset's geo placements, sourced from the bulk lite projection (`ReadBridge.listLite()`),
filtered to the active `FilterState` before aggregation.

| Field | Type | Meaning |
|-------|------|---------|
| `datasetId` | string | the dataset |
| `geoLinks` | `{ entityId: string; confidence: number }[]` | each placement onto a region entity, with confidence |

### `GeoCrosswalkEntry` (input; pure join, post-#25)

A bundled join row from `packages/geo-boundaries/data/crosswalk.json`, validated by
`packages/geo-boundaries/src/schema.ts`. **After #25 it carries no hierarchy field** — only
entity↔boundary/code joins:

| Field | Type | Meaning |
|-------|------|---------|
| `entityId` | entity id | the region entity |
| `level` | `'oblast' \| 'municipality'` | administrative level |
| `boundaryFeatureId` | string (non-empty) | join to the map boundary feature |
| `ekatte` | string \| null | EKATTE code (municipality) |
| `lauId` | string \| null | LAU code (municipality; null for oblasts) |
| `iso3166_2` | string \| null | ISO-3166-2 code (oblast; null for municipalities) |

Schema invariants (`superRefine`): an oblast entry has null `lauId` and a non-null `iso3166_2`; a
municipality entry has null `iso3166_2` and at least one of `ekatte`/`lauId`. The two
`oblastEntityId` invariants that previously enforced "every municipality names its parent oblast"
were **removed** in #25 — that responsibility moved to the `part_of` graph.

### `RegionSummary` (output; `apps/explorer-api/src/schemas.ts`)

The per-region projection returned to the map and the region detail view.

| Field | Type | Meaning |
|-------|------|---------|
| `entityId` | entity id \| null | the region entity (null only for synthetic groupings) |
| `level` | `'oblast' \| 'municipality'` | administrative level |
| `labelBg` | string | authoritative Bulgarian label (passed through, untouched) |
| `labelEn` | string \| null | English label if available |
| `boundaryFeatureId` | string | join to the boundary feature |
| `datasetCount` | number | **de-duplicated** count: distinct datasets that roll up to this region |
| `hasData` | boolean | `datasetCount > 0` (emitted even when 0 so the map renders the region) |
| `maxConfidence` | number | the strongest placement confidence among contributing links |
| `oblastEntityId?` | string \| null | parent oblast id (drives map drill-down); graph-sourced via `parentOf`, null when no parent |
| `flagged?` | `'unlinked'` | optional flag for an entity with no crosswalk join |

---

## How the roll-up buckets datasets

`aggregateRegions(input)` (`apps/explorer-api/src/regions-aggregate.ts`) is a pure function over
`{ entries, labelOf, datasets, rollup?, parentOf? }`:

1. **Resolve the mapping.** `rollup = input.rollup ?? ((id) => [id])`. The route supplies
   `rollupTargets(level, parentOf)`:
   - **oblast level**: oblast link → `[itself]`; municipality link → `[parentOblast]` (from the
     graph map), or `[]` if the municipality has no `part_of` parent; non-geo link → `[]`.
   - **municipality level**: municipality link → `[itself]`; oblast link → `[]` (leaves never
     inherit oblast-direct data); non-geo link → `[]`.
2. **Collapse per dataset to max confidence per target.** For each dataset, build
   `perTarget: Map<targetRegionId, maxConfidence>` over all `rollup(link.entityId)` targets, taking
   the strongest confidence whenever several links reach the same target. This is the dedup step.
3. **Bucket.** For each `(target, confidence)` in `perTarget`, add `datasetId` to that target's
   `Set<datasetId>` and raise the target's running `maxConfidence`.
4. **Emit one summary per crosswalk entry.** `datasetCount = bucket.datasetIds.size`,
   `maxConfidence = bucket.maxConfidence` (0 when no bucket), `oblastEntityId = parentOf?.(entityId) ?? null`,
   `hasData = datasetCount > 0`.

**Worked example.** Dataset `d1` linked to `geo:bg-oblast-varna` @0.6 and
`geo:bg-municipality-aksakovo` @0.9 (parent = Varna). At oblast level both links roll up to
`geo:bg-oblast-varna`; `perTarget` = `{ varna: 0.9 }`; the Varna bucket gains `d1` once at
confidence 0.9. A second dataset `d2` on `geo:bg-municipality-beloslav` (also part of Varna) adds
`d2` to the same bucket → Varna `datasetCount = 2`.

**Detail-list parity.** `GET /api/regions/:entityId` (`apps/explorer-api/src/app.ts`) recomputes
membership with the same `rollupTargets`: `belongsConfidence(lite)` returns the strongest confidence
among the lite's links whose roll-up targets include this region, or `-1` when none. The detail list
keeps lites with `belongsConfidence >= 0` (once each), so the list length, the reported
`datasetCount`, and the choropleth count for that region all agree (FR-007).

---

## Invariants

- **Parts ≤ whole**: for every municipality `m` with parent oblast `o`,
  `count(m) <= count(o)` — every dataset counted at `m` rolls up into `o` (verified 243/243 on the
  live mirror, 0 violations: SC-001).
- **Counted once**: a dataset rolling up to a region via N links contributes exactly 1 to that
  region's count (the `Set<datasetId>` guarantees it; SC-002).
- **Strongest evidence**: a region's `maxConfidence` is the max over contributing links, never an
  average or first-seen value.
- **Single hierarchy source**: `oblastEntityId` and the roll-up parent both come from the
  `part_of` graph; the crosswalk holds no hierarchy field (FR-012, SC-006).
- **Every region emitted**: a region with 0 datasets is still returned (`hasData=false`) so the map
  has a feature to render (FR-011).
