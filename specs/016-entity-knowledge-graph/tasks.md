---
description: "Task list for entity knowledge graph (typed entity↔entity relations)"
---

# Tasks: Entity knowledge graph (typed entity↔entity relations)

**Input**: Design documents from `/specs/016-entity-knowledge-graph/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Status**: Implemented (PR #23). All tasks below are complete (`[X]`) and reference the real shipped paths.

**Tests**: Included — the feature shipped with repo, materialiser, and endpoint tests (full suite 993 pass, 0 fail).

**Organization**: Grouped by user story (US1–US3 from spec.md) so each slice is independently verifiable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3

---

## Phase 1: Setup

- [X] T001 Create the relation layer directory `src/enrich/relations/` alongside the existing enrichment modules.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Storage substrate + controlled vocabulary that every story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Add migration `migrations/007_entity_relations.sql` — `entity_relations(subject_id, predicate, object_id, confidence, evidence_json, created_at)` with PK on the triple, FKs on both endpoints into `entities`, `CHECK (confidence > 0 AND confidence <= 1)`, and indexes `idx_entity_relations_object(object_id, predicate)` + `idx_entity_relations_predicate(predicate)`.
- [X] T003 [P] Define the closed predicate vocabulary in `src/enrich/relations/vocabulary.ts` — `ENTITY_PREDICATES` (`part_of`), `EntityPredicate` union, `ALL_ENTITY_PREDICATES`, `isEntityPredicate` type guard; document that dataset→entity predicates stay in `dataset_entities`.

**Checkpoint**: Schema + vocabulary in place — story work can begin.

---

## Phase 3: User Story 2 - A formal, typed, provenanced relation store (Priority: P1)

**Goal**: Persist and query directed typed triples between canonical entities.

**Independent Test**: Assert two `part_of` triples; read back by subject (one edge) and by object (both children); re-assert with a new confidence and confirm the count is unchanged and confidence refreshed.

> US2 is the load-bearing substrate for US1, so it is implemented first.

- [X] T004 [US2] Implement `EntityRelationsRepo` in `src/store/repos/entity-relations.ts` — `upsert` (INSERT OR REPLACE, idempotent on the triple PK; typed `predicate: EntityPredicate`; `evidence` defaults to `{}`, `createdAt` to `nowIso()`), `bySubject` / `byObject` (optional predicate filter), `count`; define `EntityRelationRow` + `UpsertRelationInput`.
- [X] T005 [US2] Repo unit test `tests/unit/store/repos/entity-relations.test.ts` — assert triples; read by subject and by object (reverse traversal returns both children sorted); `evidence_json` preserved; idempotent re-assert refreshes confidence, count stays 1.

**Checkpoint**: The triple store is queryable in both directions and idempotent.

---

## Phase 4: User Story 3 - Hierarchy materialised automatically at curate time (Priority: P2)

**Goal**: Build the `part_of` graph from the gazetteer over present entities, at curate time, idempotently.

**Independent Test**: Seed one municipality entity; run `registerEntityRelations`; assert one edge created + parent oblast upserted as a node; second run leaves count unchanged; no entities → zero edges.

- [X] T006 [US3] Implement `registerEntityRelations` in `src/enrich/relations/register-relations.ts` — for each gazetteer `MUNICIPALITY` present in `entities`, look up its parent `OBLAST`, upsert the oblast node (with `iso3166_2` attribute), upsert the `part_of` edge (`confidence: 1`, `evidence: { source: 'gazetteer' }`); return `{ created }`.
- [X] T007 [US3] Wire `registerEntityRelations` into `src/curate/run-curate.ts` at the end of the run; add `relationsCreated` to `RunCurateResult` and the `curate.completed` log.
- [X] T008 [US3] Materialiser unit test `tests/unit/enrich/relations/register-relations.test.ts` — present-municipality creates one edge + upserts parent oblast node; absent municipalities create zero; idempotent across re-runs (count stays 1).

**Checkpoint**: Curate fills the graph; re-runs are no-ops.

---

## Phase 5: User Story 1 - Traverse the administrative hierarchy as a graph (Priority: P1) 🎯 MVP

**Goal**: Expose one entity's graph node (labels, in/out typed relations, direct dataset count) over HTTP.

**Independent Test**: Seed a municipality + a `part_of` edge + a dataset link; `GET /api/entities/:id` returns the outgoing edge with the resolved oblast and `datasetCount: 1`; the oblast shows the reverse edge as `in`; unknown id → 404.

- [X] T009 [US1] Add API view types to `apps/explorer-api/src/schemas.ts` — `EntityNode`, `EntityRelationEdge`, `EntityGraphView`.
- [X] T010 [US1] Implement `ReadBridge.entityGraph(entityId)` in `apps/explorer-api/src/read-bridge.ts` — resolve self (return `null` if unknown), map outgoing (`bySubject`) and incoming (`byObject`) edges with far-end nodes resolved via `EntitiesRepo.get` (placeholder `kind: 'unknown'` fallback), and `datasetCount` from `datasetsForEntity`.
- [X] T011 [US1] Add the route `GET /api/entities/:entityId` in `apps/explorer-api/src/app.ts` — return the graph, or the shared `not_found` (404) envelope when `entityGraph` returns `null`.
- [X] T012 [US1] Endpoint test in `apps/explorer-api/tests/app.test.ts` — typed relations in both directions (`out` on the municipality, `in` on the oblast), `datasetCount`, and 404 for an unknown id.
- [X] T013 [US1] Register the `GET /api/entities/:id` contract test in `tests/parity-matrix.json` (Constitution VIII endpoint parity).

**Checkpoint**: The knowledge graph is queryable over HTTP — MVP complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T014 [P] Confirm the layer-separation rationale is documented inline (migration header + vocabulary module) — dataset→entity edges stay in `dataset_entities`; `entity_relations` is entity↔entity only.
- [X] T015 Run lint + typecheck + full test suite (993 pass, 0 fail; lint + typecheck clean).
- [X] T016 Materialise on the live mirror via `danni curate --entities-only` and verify the edge count (249 `part_of` edges).

---

## Dependencies & Execution Order

- **Setup (Phase 1)** → no dependencies.
- **Foundational (Phase 2: T002 migration, T003 vocabulary)** → blocks all stories.
- **US2 (Phase 3)** → depends on the migration + vocabulary; substrate for US1.
- **US3 (Phase 4)** → depends on US2's repo (it upserts edges) + the gazetteer.
- **US1 (Phase 5)** → depends on US2's repo (reads edges); independently testable with seeded data even without US3.
- **Polish (Phase 6)** → after all stories.

### Parallel Opportunities

- T002 (migration) and T003 (vocabulary) are independent files — parallelizable.
- T009 (schema types) is independent of T006/T007 — parallelizable with the US3 work.

---

## Implementation Strategy

US2 (store) → US3 (materialise) → US1 (endpoint) was the natural order: the typed triple store underpins both the materialiser and the read surface. US1 is the user-facing MVP; once the seeded-data endpoint test passes, the graph is demonstrably queryable, and US3 keeps it populated on the live mirror.

## Notes

- All tasks shipped in PR #23; paths are the real merged paths.
- Tests are co-located with the existing suites (`tests/unit/…`, `apps/explorer-api/tests/`).
- Idempotency is enforced at two layers: the triple PK (`INSERT OR REPLACE`) and the global materialiser pass.
