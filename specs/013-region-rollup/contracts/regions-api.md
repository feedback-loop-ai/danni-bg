# Contract — `/api/regions` and `/api/regions/:entityId` under hierarchical roll-up

These two explorer-API endpoints were introduced by spec 008 (see
`specs/008-map-data-explorer/contracts/http-api.md`). This contract documents the **behavioral
delta** this feature (013) imposes: counts and detail lists are now the de-duplicated union of an
oblast's direct datasets plus its municipalities' datasets, with the municipality→oblast hierarchy
sourced from the `part_of` graph. The response **shapes are unchanged** except that
`RegionSummary.oblastEntityId` is now graph-sourced (and null when no parent exists). No new
endpoint is added.

---

## GET /api/regions

Returns one `RegionSummary` per crosswalk entry at the requested level.

**Query parameters**:
- `level` — `oblast` (default) or `municipality`.
- Plus the standard `FilterState` parameters (tag, publisher, freshness, free-text, etc.), applied
  before aggregation.

**200**: `{ "regions": RegionSummary[] }`

Roll-up behavior:
- **`level=oblast`**: each oblast's `datasetCount` is the count of **distinct** datasets that link
  directly to the oblast OR to any municipality that is `part_of` it. A dataset reaching the oblast
  via multiple links (direct + municipality, or two municipalities) is counted **once**; the
  oblast's `maxConfidence` is the strongest contributing placement.
- **`level=municipality`**: unchanged from flat behavior — municipalities are leaves; a
  municipality's count is the distinct datasets linked directly to it. Oblast-direct datasets are
  **not** pushed down to municipalities.
- `oblastEntityId` is the parent oblast entity id for a municipality summary (drives map
  drill-down), sourced from `part_of`; null/absent for oblast summaries and for orphan
  municipalities (no `part_of` edge).
- Every crosswalk entry is emitted even when it has no datasets (`datasetCount: 0`,
  `hasData: false`).

Degradation: if the `part_of` graph is not materialised, municipality→oblast roll-up contributes
nothing and oblast counts fall back to direct links only (smaller, never wrong; no error).

## GET /api/regions/:entityId

Returns one region's summary plus its (paginated) dataset list.

**Path**: `:entityId` — an oblast or municipality entity id present in the crosswalk.
**Query parameters**: standard `FilterState` plus `limit` (default 50, max 200) and `offset`.

**404**: `{ error: { code: "not_found", message: "unknown or unlinked region" } }` when the
entity id has no crosswalk entry.

**200**: `{ "region": RegionSummary, "datasets": DatasetPointer[], "total": number }`

Roll-up behavior:
- Membership uses the **same** `rollupTargets` mapping as `/api/regions`, so for an oblast the list
  contains its direct datasets plus all of its municipalities' datasets, each appearing **once**.
- `region.datasetCount` and `total` equal the number of distinct rolling-up datasets and equal the
  choropleth count for the same entity at the same filter scope (list ↔ count parity).
- Each dataset is included at the strongest confidence among its links that roll up to this region;
  `region.maxConfidence` is the max of those.
- `datasets` is the page slice (`offset`..`offset+limit`); `total` is the full distinct count.

---

## Contract test traceability

| Behavior | Test |
|----------|------|
| Pure roll-up + dedup + max-confidence per target | `apps/explorer-api/tests/regions-aggregate.test.ts` |
| `/api/regions` rolls municipality datasets into the parent oblast only after the `part_of` edge exists | `apps/explorer-api/tests/app.test.ts` |
| `/api/regions/:id` list ↔ count parity under roll-up | `apps/explorer-api/tests/app.test.ts` |
| `part_of` edges read in bulk | `tests/unit/store/repos/entity-relations.test.ts` |
| Crosswalk entry schema carries no hierarchy field | `packages/geo-boundaries/tests/schema.test.ts`, `packages/geo-boundaries/tests/crosswalk.test.ts` |
