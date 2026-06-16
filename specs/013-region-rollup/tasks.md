---
description: "Task list for Hierarchical region roll-up (municipality → oblast, via the part_of graph)"
---

# Tasks: Hierarchical region roll-up (municipality → oblast, via the part_of graph)

**Input**: Design documents from `/specs/013-region-rollup/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/regions-api.md, quickstart.md

**Tests**: INCLUDED — Constitution VIII mandates 100% line+branch on changed logic and a contract
test per affected endpoint. All changed logic (aggregation, roll-up mapping, graph read, schema) is
covered. Each test was written/strengthened alongside its implementation; the migration pin
(T011) fails against the pre-#24 path.

**Organization**: Tasks grouped by user story (US1–US4). All tasks are **shipped** (`[X]`) via
PRs #18 (US1/US2 roll-up + dedup), #24 (US4 graph-sourced hierarchy + US3 drill-down id), #25
(US4 crosswalk cleanup). Paths are repository-root-relative and exact.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependency on an incomplete task
- **[Story]**: US1–US4 (cross-cutting tasks carry no story label)

## Path Conventions

Multi-package monorepo (spec 008): backend in `apps/explorer-api/`, shared store repos in
`src/store/repos/`, bundled boundaries/crosswalk in `packages/geo-boundaries/`. The `part_of`
graph and `ENTITY_PREDICATES` (`src/enrich/relations/vocabulary.ts`) are owned by spec 016 and
reused unchanged.

---

## Phase 1: Setup (Shared Infrastructure)

No new setup — this feature extends the existing explorer-API backend and store repos established
by spec 008 and the knowledge-graph layer of spec 016. Toolchain (Bun + `bun:test` + Biome) and the
`apps/explorer-api` / `packages/geo-boundaries` packages already exist.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The hierarchy read path the oblast roll-up depends on.

**⚠️ CRITICAL**: US1's oblast roll-up cannot bucket municipalities without the parent map.

- [X] T001 Add `EntityRelationsRepo.byPredicate(predicate)` returning every `entity_relations` row for a predicate (ordered), in `src/store/repos/entity-relations.ts` (used to read the whole `part_of` hierarchy). *(PR #24)*
- [X] T002 Add `ReadBridge.partOfParents(): Map<municipalityId, oblastId>` reading `byPredicate(ENTITY_PREDICATES.PART_OF)` in `apps/explorer-api/src/read-bridge.ts`. *(PR #24)*
- [X] T003 [P] Unit test the `part_of` bulk read in `tests/unit/store/repos/entity-relations.test.ts`. *(PR #24)*

**Checkpoint**: The municipality→oblast hierarchy is queryable from the graph; roll-up can begin.

---

## Phase 3: User Story 1 — An oblast's count includes its municipalities (Priority: P1) 🎯 MVP

**Goal**: An oblast's `datasetCount` is the de-duplicated union of its direct datasets plus all of
its municipalities' datasets.

**Independent Test**: For every municipality on the live mirror, `count(muni) <= count(parent oblast)`
(243/243 municipalities-with-data of 265 total, 0 violations).

- [X] T004 [US1] Add the optional `rollup(linkEntityId) => regionIds[]` parameter to `aggregateRegions` (default identity → flat behavior preserved) and bucket targets accordingly, in `apps/explorer-api/src/regions-aggregate.ts`. *(PR #18)*
- [X] T005 [US1] Implement `rollupTargets(level, parentOf)` in `apps/explorer-api/src/app.ts`: oblast→self, municipality→parent oblast (from the graph map), classified by entity-id namespace; municipality level is identity for municipalities and drops oblast-direct links. *(PR #18, rewired to the graph map in #24)*
- [X] T006 [US1] Wire `GET /api/regions` to pass `rollup: rollupTargets(level, partOfParents())` in `apps/explorer-api/src/app.ts` (the route-wiring half of T005's `rollupTargets`). *(PR #18 / #24)*
- [X] T007 [US1] Unit cases: municipalities roll up into the parent oblast at oblast level; municipality level unchanged; non-geo links ignored — in `apps/explorer-api/tests/regions-aggregate.test.ts`. *(PR #18)*

**Checkpoint**: Oblast counts include their municipalities; the parts-≤-whole invariant holds.

---

## Phase 4: User Story 2 — A dataset on both oblast and municipality is counted once (Priority: P1)

**Goal**: De-duplicate overlapping placements; record the strongest confidence.

**Independent Test**: A dataset linked to an oblast and one of its municipalities adds exactly 1 to
the oblast count, at the higher confidence.

- [X] T008 [US2] Collapse each dataset's links to **max confidence per target** (`perTarget`) before bucketing, and accumulate distinct dataset ids in a `Set` per region, in `apps/explorer-api/src/regions-aggregate.ts`. *(PR #18)*
- [X] T009 [US2] Unit case: a dataset tagged to both an oblast and its municipality (differing confidences) is counted once, at the stronger confidence, in `apps/explorer-api/tests/regions-aggregate.test.ts`. *(PR #18)*

**Checkpoint**: No double-counting; `maxConfidence` reflects the strongest contributing link.

---

## Phase 5: User Story 3 — The oblast detail list matches its count and drills down (Priority: P2)

**Goal**: The oblast detail list equals the choropleth count, each dataset once; municipality
summaries carry their parent oblast id.

**Independent Test**: `GET /api/regions/:id` returns `datasetCount == total == list length`, each
municipality dataset once; a municipality summary carries `oblastEntityId`.

- [X] T010 [US3] Make `GET /api/regions/:entityId` membership roll-up-aware via `belongsConfidence` (strongest confidence among links whose `rollupTargets` include this region, else −1), so list + count match the aggregate, in `apps/explorer-api/src/app.ts`. *(PR #18)*
- [X] T011 [US3] Add the optional `parentOf(entityId)` resolver to `aggregateRegions` so the emitted `RegionSummary.oblastEntityId` (drill-down) is graph-sourced; pass `parentOf: (id) => partOfParents().get(id)` from `/api/regions`. Document the field in `apps/explorer-api/src/schemas.ts`. *(PR #24)*
- [X] T012 [US3] App test: a municipality dataset appears under its parent oblast's detail list **only after** the `part_of` edge exists (pins the graph as the source; fails against the pre-#24 crosswalk path), in `apps/explorer-api/tests/app.test.ts`. *(PR #24)*
- [X] T019 [US3] Paginate `GET /api/regions/:entityId` (`limit` default 50 / max 200, `offset`) while reporting `total` as the full distinct rolling-up count independent of the page slice, and assert list↔count parity (FR-007/FR-013, SC-003) against `total` (not the page length), in `apps/explorer-api/src/app.ts` and `apps/explorer-api/tests/app.test.ts`. *(PR #18)*

**Checkpoint**: Counts are auditable via the list; drill-down ids are graph-sourced.

---

## Phase 6: User Story 4 — The hierarchy source of truth is the part_of graph (Priority: P3)

**Goal**: Consolidate the municipality→oblast hierarchy onto the `part_of` graph and remove the
redundant crosswalk copy.

**Independent Test**: Roll-up resolves parents from the graph (T012 pins this); the crosswalk schema
no longer has an `oblastEntityId` field and all 293 entries load clean.

- [X] T013 [US4] Drop the dead crosswalk `oblastEntityId` fallback in `aggregateRegions` so `oblastEntityId` is solely the graph-backed `parentOf` (null when not supplied), in `apps/explorer-api/src/regions-aggregate.ts`. *(PR #25)*
- [X] T014 [US4] Remove the `oblastEntityId` field and its two `superRefine` invariants from the crosswalk entry schema in `packages/geo-boundaries/src/schema.ts`. *(PR #25)*
- [X] T015 [US4] Stop emitting `oblastEntityId` in `packages/geo-boundaries/scripts/generate-crosswalk.ts` and regenerate `packages/geo-boundaries/data/crosswalk.json` (293 entries, hierarchy field removed). *(PR #25)*
- [X] T016 [P] [US4] Update crosswalk tests/fixtures to the field-free schema in `packages/geo-boundaries/tests/schema.test.ts` and `packages/geo-boundaries/tests/crosswalk.test.ts`. *(PR #25)*

**Checkpoint**: Single hierarchy source (the graph); crosswalk is pure entity↔boundary/code joins.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T017 Run the full backend + shared-logic suite (full suite green) with lint + typecheck clean (Constitution VIII gate). *(PRs #18, #24, #25)*
- [X] T018 Verify the live-mirror invariant: 243/243 municipalities-with-data (of 265 total) satisfy `count(muni) <= count(parent oblast)`, 0 violations; `Варна` oblast 111 (direct-only) → 243 right after #18 → 516 on the current mirror once publisher-derived recall populated more of its municipalities (per `quickstart.md`). *(PR #18)*

---

## Dependencies & Execution Order

- **Foundational (Phase 2)** depends on spec 016's `part_of` graph existing; it builds the read
  path (T001→T002) the oblast roll-up consumes. T003 is parallel to the route work.
- **US1 (P1)** and **US2 (P1)** were shipped together in PR #18 (the roll-up and its dedup are one
  change to `aggregateRegions`); US2's dedup (T008) is what makes US1's union correct.
- **US3 (P2)** builds on US1/US2 (same `rollupTargets`); the `parentOf` resolver (T011) and the
  migration pin (T012) landed in #24.
- **US4 (P3)** is the cleanup that depends on US3's graph-sourced `parentOf` being in place; it
  removes the redundant crosswalk field (#25).

## Implementation Strategy

Shipped incrementally and in priority order: #18 delivered the P1 MVP (hierarchical, deduped
counts) end-to-end; #24 moved the hierarchy source to the `part_of` graph and added the drill-down
id (P2/P3); #25 removed the now-redundant crosswalk field (P3 cleanup). Each PR kept the full suite
green.

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- The `part_of` graph and `ENTITY_PREDICATES.PART_OF` are owned by spec 016 — depended on, not
  re-specified here.
- No new migration or persisted table; the feature re-buckets already-extracted placements.
- T006 is the route-wiring half of T005 (T005 defines `rollupTargets`; T006 passes it into `/api/regions`).
- The empty-graph degraded path (un-materialised `part_of` → oblast roll-up falls back to direct
  links only, no crash) is exercised by the default-identity unit case in T004: with no `rollup`
  supplied the aggregator is identity, which is the same flat behavior the empty-graph fallback yields.
