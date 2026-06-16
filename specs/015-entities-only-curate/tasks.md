---
description: "Task list for 015-entities-only-curate"
---

# Tasks: Entities-only curate mode (re-extract without re-parsing)

> **Status (2026-06-16): Implemented.** Every task below is complete and exercised by the test suite (full suite green; lint + typecheck clean). This was shipped via **PR #20** (`feat(curate): --entities-only mode (re-extract without re-parsing)`, merged 2026-06-16 from branch `feat/curate-entities-only`). It is a RETROSPECTIVE spec: the code shipped before these artifacts were written, then the spec/plan/tasks were reconciled against the merged diff and the green suite.

**Input**: Design documents from `/specs/015-entities-only-curate/`
**Prerequisites**: plan.md, spec.md (incl. the `### Session 2026-06-16` clarification block), research.md (R1–R4), data-model.md, quickstart.md, contracts/cli.md

**Tests**: Tests are MANDATORY for this feature (Constitution Principles VII, VIII: 100% line + branch coverage, TDD — the failing test guards the new branch). This feature adds **no new portal endpoint and no new published read contract**: the only external-surface change is the `--entities-only` CLI flag (documented in `contracts/cli.md`), and the entity/link/relation upserts are unchanged. So there is **no parity-matrix entry to add**; the mandatory test is the new `run-curate` unit test asserting that `--entities-only` re-extracts entities (incl. the publisher-derived place) WITHOUT parsing resources or translating, even when a translator is supplied.

## Implementation status

Complete. All tasks below are `[X]` — implemented and verified by the test suite (see the status note above). Files touched (from `gh pr diff 20`): `src/cli/curate.ts`, `src/curate/run-curate.ts`, `src/enrich/extractors/bg-admin-publisher.ts`, `tests/unit/curate/run-curate.test.ts`.

**Organization**: Tasks are grouped by user story (US1 = P1 low-memory entity refresh, US2 = P2 run without a translator/LAN, US3 = P3 idempotent whole-catalog re-runs) to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependencies on incomplete tasks in the same phase
- **[Story]**: User-story phase tasks only (US1–US3)
- Every task includes an exact file path
- **TDD**: the test task (T001) is written and made to FAIL before the implementation it guards

## Path Conventions

Single-project layout (inherited from 001, plan.md §Project Structure):
- Source confined to: `src/curate/run-curate.ts`, `src/cli/curate.ts`, and a comment correction in `src/enrich/extractors/bg-admin-publisher.ts`
- No new migration (no schema change); the only external-surface change is the `--entities-only` CLI flag (`contracts/cli.md`)
- Tests: `tests/unit/curate/run-curate.test.ts`
- Read-only deps: `src/curate/registry.ts`, `src/enrich/register-entities.ts`, `src/enrich/link-datasets.ts`, `src/enrich/relations/register-relations.ts`, `src/enrich/translate.ts`, the registered extractors under `src/enrich/extractors/`, the repos under `src/store/repos/`, and `migrations/002_curate_enrich.sql` + `migrations/007_entity_relations.sql` (the PK-guarded upsert targets)

---

## Phase 1: User Story 1 — Refresh entities after an extractor/gazetteer change without OOM (Priority: P1) 🎯 MVP

**Goal**: An operator can re-run entity attachment across the whole local mirror to materialize an extractor/gazetteer change, and the run completes within memory (≈140 MB RSS) instead of being OOM-killed by the full re-curate's per-resource parse (≈20 GB RSS on the ~16k-resource mirror). The parse loop is skipped; the curated-artifact writes are zero (FR-001, FR-002, FR-005).

**Independent Test** (quickstart §1–2): on a store with a captured, parse-able resource, `runCurate({ entitiesOnly: true })` attaches entities (incl. the publisher-derived place) while writing zero curated artifacts; `curated === uncurated === 0` and `CuratedArtifactsRepo.byDataset(...)` has no new rows.

### Tests for User Story 1 (TDD — write FIRST, ensure it FAILs) ⚠️

- [X] T001 [US1] Add the `'--entities-only re-extracts entities without parsing resources or translating'` test to `tests/unit/curate/run-curate.test.ts`: seed a captured, parse-able resource (`ResourcesRepo.upsert` + `recordCapture` + a real `raw.json` on disk) that a full run WOULD parse, supply a `LocalMarianMtTranslator`, run `runCurate({ entitiesOnly: true, translator })`, and assert `out.curated === 0`, `out.uncurated === 0`, `out.translationsWritten === 0`, `new CuratedArtifactsRepo(s.db).byDataset('d1').length === 0`, `out.entitiesAttached > 0`, and that `dataset_entities` contains `geo:bg-municipality-stolichna` (publisher `Столична община` → place). Guards T002–T003.

### Implementation for User Story 1

- [X] T002 [US1] Add `entitiesOnly?: boolean` to `RunCurateOptions` in `src/curate/run-curate.ts` (with the JSDoc explaining it re-runs extraction + linking only, skipping the parse that can exhaust memory on a large mirror), and short-circuit the per-resource parse loop with `if (opts.entitiesOnly) break;` as the **first** statement inside `for (const r of resources)` — so no resource file is touched and `curated_artifacts` gets no new rows (FR-001, FR-002, research.md R1/R2). Satisfies the artifact assertions in T001.
- [X] T003 [US1] Verify (no code change beyond T002) that `registerEntities`, `linkAllSharedEntities`, and `registerEntityRelations` still run for every targeted dataset in entities-only mode, so the dataset's entities — including the publisher-derived place from `BgAdminPublisherExtractor` over the metadata `Столична община` — are re-asserted (FR-005). Satisfies the `entitiesAttached > 0` / `geo:bg-municipality-stolichna` assertions in T001.

**Checkpoint**: entities-only attaches entities from metadata while writing zero curated artifacts; the parse loop (the OOM cause) is skipped (SC-001, SC-002). MVP shippable here.

---

## Phase 2: User Story 2 — Run without a translator or LAN access (Priority: P2)

**Goal**: Entities-only neither attempts translation nor requires the translation backend: the run-level translation block is guarded, and the CLI does not construct a translator when `--entities-only` is given (FR-003, FR-004).

**Independent Test** (quickstart §1–2): a translator supplied to `runCurate({ entitiesOnly: true, translator })` is ignored (`translationsWritten === 0`); `danni curate --entities-only` builds no translator.

### Implementation for User Story 2

- [X] T004 [US2] Guard the translation block in `src/curate/run-curate.ts` with `if (opts.translator && !opts.entitiesOnly)` so no translation is attempted in entities-only mode even when a translator is supplied — `translationsWritten` stays 0 (FR-003, research.md R3). Covered by the `translationsWritten === 0` assertion in T001.
- [X] T005 [US2] Add the `--entities-only` flag to `parseFlags` in `src/cli/curate.ts` (set `flags.entitiesOnly = true`), update the `--help` usage line to `danni curate [--datasets <id1,id2,...>] [--since <iso>] [--curator-version <v>] [--entities-only]`, and in `run()` pass `...(flags.entitiesOnly ? { entitiesOnly: true } : { translator: buildTranslator(config) })` — so the CLI does **not** call `buildTranslator` in entities-only mode and the run needs no translation backend / LAN access (FR-004, research.md R3). (Depends on T002.)

**Checkpoint**: a supplied translator writes zero translations (ignored), and `danni curate --entities-only` succeeds with no translation backend reachable (SC-003).

---

## Phase 3: User Story 3 — Idempotent re-runs over the whole catalog (Priority: P3)

**Goal**: Re-running entities-only over the whole catalog produces no duplicate or accumulating `dataset_entities` / `dataset_links` / `entity_relations` rows, because the writes are PK-guarded `INSERT OR REPLACE` (FR-006). Correct the stale publisher-extractor ordering comments so the per-extractor / max-confidence behavior is documented accurately.

**Independent Test** (quickstart §3): running entities-only twice over an unchanged store leaves the `dataset_entities` / `dataset_links` / `entity_relations` row sets identical.

### Implementation for User Story 3

- [X] T006 [US3] Correct the publisher-extractor ordering comments in `src/curate/run-curate.ts` (the extractor list) and `src/enrich/extractors/bg-admin-publisher.ts` to state the real data model: `dataset_entities`' PK includes the extractor, so a place matched both in-content and via publisher keeps **a row per extractor**, and the read layer takes the **max confidence** per `(dataset, entity)` — the stronger in-content 0.95/0.75 wins downstream over the publisher 0.7/0.6, NOT via an `INSERT OR REPLACE` "last writer wins" overwrite between extractors (FR-006, research.md R4). Documentation/correctness only; no behavior change.
- [X] T007 [US3] Confirm (no code change) that the entity/link/relation writes inherit idempotency from their existing composite PKs — `dataset_entities (dataset_id, entity_id, extractor)`, `dataset_links (dataset_a_id, dataset_b_id, via_entity_id, heuristic)`, `entity_relations (subject_id, predicate, object_id)` (`migrations/002_curate_enrich.sql`, `migrations/007_entity_relations.sql`) — so the whole-catalog re-run is safe and adds no migration (FR-006, FR-008).
- [X] T009 [US3] Pin the entities-only `RunCurateResult` counts in the T001 assertions (`tests/unit/curate/run-curate.test.ts`): `curated === 0`, `uncurated === 0`, `translationsWritten === 0`, `entitiesAttached > 0`, and the graph-derived `linksCreated`/`relationsCreated` re-asserted as non-negative (`>= 0`) — they reflect the linking/relation passes running over the entity graph, not zeroed-out parse counts. Documents/locks the entities-only-mode behavior of these fields (FR-009).

**Checkpoint**: re-running entities-only over an unchanged store leaves the entity/link/relation row sets identical (SC-004); no schema change, no migration.

---

## Phase 4: Gates

- [X] T008 Full suite green with the addition; Biome lint + typecheck clean. No parity-matrix entry (no new endpoint/contract); no migrate-smoke change (no migration). (SC-005)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (US1)** → the OOM-relieving parse-loop skip in `src/curate/run-curate.ts`. T001 (test) written first, then T002 (the `break`); T003 verifies extraction/linking/relations still run.
- **Phase 2 (US2)** → the translation skip. T004 (run-level guard) and T005 (CLI flag + no translator) — T005 depends on T002 (the option exists). Covered by the same T001 test.
- **Phase 3 (US3)** → idempotency + comment correction. T006 (comments) and T007 (PK-inherited idempotency); independent of the parse/translation changes.
- **Phase 4** → gates after the code lands.

### User Story Dependencies

- **US1 (P1)** — the parse-loop skip; no dependency on other stories.
- **US2 (P2)** — the translation skip + CLI flag; the CLI part depends on the `entitiesOnly` option from US1 (T002).
- **US3 (P3)** — idempotency assertion + comment correction; independent.

### Parallel Opportunities

- T002 and T004 are sequential edits to the same file (`src/curate/run-curate.ts`).
- T005 (`src/cli/curate.ts`) and T006's `bg-admin-publisher.ts` comment edit touch different files and could proceed in parallel once T002 lands.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase.
- [Story] label maps each task to its user story (US1–US3).
- Task-ID ordering: T009 was added under Phase 3 (US3) after T008 already existed; T008 is the final validation gate in Phase 4 and is intentionally executed LAST despite its lower number. Numeric order ≠ execution order — follow the phase grouping.
- Tests are MANDATORY and TDD (Constitution VII/VIII): the new branch (parse-loop `break`; translation guard) is covered by the new `--entities-only` test plus the existing full-run and no-translator tests. There is **no new portal endpoint and no new published read contract** — only the `--entities-only` CLI flag (`contracts/cli.md`) — so there is **no parity-matrix entry** to add.
- No new migration: entities-only reuses the existing `dataset_entities` / `dataset_links` / `entity_relations` PK-guarded `INSERT OR REPLACE` upserts and the existing `RunCurateResult` shape (FR-007, FR-008).
- The OOM cause was the per-resource parse loop (≈20 GB RSS on the live mirror); the fix is to not enter it (research.md R1/R2). Entities-only runs at ≈140 MB RSS.
- Shipped via PR #20 from branch `feat/curate-entities-only` (this branch name deviates from the `###-name` convention; the spec dir `015-entities-only-curate/` carries the canonical numbering). The commit corrected the stale publisher-extractor ordering comments alongside the option/flag.
- The OOM-diagnosis narrative (≈20 GB full curate vs ≈140 MB entities-only; why re-parse is waste) is canonical in **research.md R1/R2**; spec.md / plan.md / data-model.md restate it for context but defer to R1/R2 as the source of truth.
- FR-004 (no translator built at the CLI) is exercised end-to-end by T005's wiring; the shipped suite does not include a dedicated CLI-parse test for `--entities-only`. A `parseFlags`-level test asserting `--entities-only` sets `flags.entitiesOnly` and that `run()` does not call `buildTranslator` could cover FR-004 at the CLI boundary cheaply — none ships today (do not assume one exists).
