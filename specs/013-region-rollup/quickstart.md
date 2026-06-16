# Quickstart — 013-region-rollup

Verify the hierarchical, de-duplicated oblast roll-up locally. The roll-up reads the `part_of`
knowledge graph (spec 016) for the municipality→oblast hierarchy and re-buckets already-extracted
geo placements; it changes no upstream data.

## Prerequisites

- Bun 1.x, repo dependencies installed (`bun install`).
- A populated local mirror with the `part_of` graph **materialised** (a curate pass that emits
  `entity_relations` rows with predicate `part_of`). Without it, the oblast roll-up degrades to
  direct links only (smaller but never wrong counts).

## 1. Run the roll-up unit + route tests

```bash
# Pure aggregation: hierarchy roll-up + dedup + max-confidence.
bun test apps/explorer-api/tests/regions-aggregate.test.ts

# Graph-sourced roll-up through the route (rolls up ONLY after the part_of edge exists).
bun test apps/explorer-api/tests/app.test.ts

# part_of edge read + crosswalk schema (no oblastEntityId field).
bun test tests/unit/store/repos/entity-relations.test.ts \
  packages/geo-boundaries/tests/schema.test.ts \
  packages/geo-boundaries/tests/crosswalk.test.ts
```

Expect all green. The app test is the migration pin: it asserts a municipality dataset rolls into
its oblast **only after** the `part_of` edge is present — it fails against the old crosswalk path.

## 2. Inspect oblast counts on the live mirror

Start the explorer API against the mirror, then:

```bash
# Oblast-level choropleth counts (de-duplicated union of direct + municipality datasets).
curl -s 'http://localhost:$EXPLORER_API_PORT/api/regions?level=oblast' | jq '.regions[] | {entityId, datasetCount, oblastEntityId}'

# Municipality-level counts (leaves; unchanged by the roll-up).
curl -s 'http://localhost:$EXPLORER_API_PORT/api/regions?level=municipality' | jq '.regions[] | {entityId, datasetCount, oblastEntityId}'
```

`oblastEntityId` is null for oblast rows and the parent oblast id for municipality rows
(drives map drill-down).

## 3. Confirm the "parts ≤ whole" invariant

For every municipality, its count must be ≤ its parent oblast's count. On the live mirror this is
**243/243 municipalities-with-data (of 265 total), 0 violations** (SC-001). A scratch check:

```bash
# Join municipality counts to their parent (oblastEntityId) and flag any muni > parent.
curl -s 'http://localhost:$EXPLORER_API_PORT/api/regions?level=municipality' \
  | jq '[.regions[] | {muni: .entityId, parent: .oblastEntityId, count: .datasetCount}]' > /tmp/munis.json
curl -s 'http://localhost:$EXPLORER_API_PORT/api/regions?level=oblast' \
  | jq 'INDEX(.regions[]; .entityId) | map_values(.datasetCount)' > /tmp/oblasts.json
jq --slurpfile o /tmp/oblasts.json '[.[] | select(.count > ($o[0][.parent] // 1e9))]' /tmp/munis.json
# Expect: []  (no municipality exceeds its parent oblast)
```

## 4. Confirm list ↔ count parity for an oblast

`total` is the full distinct rolling-up count regardless of pagination (`limit` default 50 / max
200, `offset`); parity (FR-007/FR-013, SC-003) is asserted on `total`, not the returned page slice.

```bash
# The detail list length must equal the reported count and the choropleth count.
curl -s 'http://localhost:$EXPLORER_API_PORT/api/regions/geo:bg-oblast-varna' \
  | jq '{count: .region.datasetCount, total: .total, listLen: (.datasets | length)}'
# Expect count == total; on the current live mirror Varna is ~516 (111 direct-only → 243 right
# after #18 → 516 once publisher-derived recall populated more of its municipalities; SC-004).
```

## 5. Full suite (matches CI)

```bash
bun run test       # full suite green
bun run lint && bun run typecheck   # clean
```
