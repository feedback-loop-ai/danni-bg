---

description: "Task list for 003-incremental-indexing"
---

# Tasks: Incremental Indexing (Skip Unchanged Datasets)

**Input**: Design documents from `/specs/003-incremental-indexing/`
**Prerequisites**: plan.md, spec.md (incl. both `### Session 2026-06-03` clarification blocks), research.md (R1–R10), data-model.md, quickstart.md

**Tests**: Tests are MANDATORY for this feature (Constitution Principles VII, VIII: 100% line + branch coverage, TDD — write failing tests FIRST). There is no new portal endpoint or published read contract here (`index_state` is internal index bookkeeping; plan.md §Constitution Check III), so there is no `contracts/` directory and no parity-matrix entry to add; instead the mandatory tests are the fingerprint round-trip (over Cyrillic, Principle X), the skip-gate truth table (data-model §3), the model-change path, the orphan purge, the `--full` single-transaction rebuild, interrupted-run convergence, and the incremental-==-full equivalence (SC-005).

## KEYSTONE / Cross-Spec seam (read before starting)

This feature is the **keystone** of the 002/003/004 trio (plan.md §Cross-Spec Coordination, review 2026-06-04). **Land 003 first.**

- **003 owns the merged per-dataset run-index loop** in `src/index/run-index.ts`: fingerprint check → FTS upsert + `content_fp`; embed + `embed_fp`/`model_id`; each leg committed in its own per-dataset transaction; the global model identity is read once at run start.
- **002-batch-embedding extends THIS loop, not a competing rewrite.** 002 batches **only the changed/selected set** that 003's skip gate yields, persisting each vector with its `embed_fp`/`model_id` as the batch returns. 003 MUST hand the vector layer a *set* of dataset ids (not assume one-at-a-time embedding) and write `embed_fp` per dataset as each vector lands — that boundary is the seam (research.md R5 "Composition with 002 batching"). **Tasks T020 (skip gate) and T026 (model-change branch) below are the explicit seam: keep the "decide changed set" step separable from the "embed the set" step.**
- **Orphan purge co-owns 002's table**: 003's every-run reconcile-vs-`listActive()` purge MUST also clear 002's `index_failures` rows for non-active datasets once that table exists (plan.md §Cross-Spec Coordination). T031 carries a forward-compatible note so the purge is written set-difference-driven and trivially extends to a 4th store.
- **Migration numbering (canonical, collision-free)**: `004_index_failures.sql` (002), `005_index_state.sql` (003 — this), `006_crawl_checkpoint.sql` (004). All additive and order-independent. The branch number is **not** the migration number (research.md R10 / data-model §4.1). T002 also adds a duplicate-prefix guard to `src/store/migrate.ts` (none exists today).

## Implementation status

Not started. All tasks below are `[ ]`.

**Organization**: Tasks are grouped by user story (US1 = P1 incremental skip, US2 = P1 model-change re-embed, US3 = P2 force-rebuild) to enable independent implementation and testing. Setup, foundational, and polish phases carry no story label.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependencies on incomplete tasks in the same phase
- **[Story]**: User-story phase tasks only (US1, US2, US3)
- Every task includes an exact file path
- **TDD**: every test task is written and made to FAIL before the implementation task it guards

## Path Conventions

Single-project layout (inherited from 001, plan.md §Project Structure):
- Source confined to: `src/index/{index-state.ts,run-index.ts,fts.ts,vec.ts,embeddings-store.ts}`, `src/cli/index-cmd.ts`
- Migration: `migrations/005_index_state.sql`
- Tests: `tests/unit/index/`, `tests/integration/`
- Read-only deps: `src/store/db.ts` (`withTransaction`), `src/store/repos/datasets.ts` (`DatasetsRepo.listActive`), `src/lib/hash.ts` (`sha256Hex`), `src/lib/time.ts` (`nowIso`), `src/config/schema.ts` (`IndexConfigSchema.incremental`), `src/store/migrate.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the touchpoints exist and the dev/test loop is green before any change.

- [ ] T001 [P] Confirm the baseline `runIndex` loop and its stores are as plan.md describes: `src/index/run-index.ts` re-embeds **every** active dataset and deletes FTS rows only for non-active datasets it visits (never touches `dataset_embeddings`); `src/index/embeddings-store.ts` exposes `deleteEmbedding`/`ensureEmbeddingsTable`/`getEmbeddingsMeta`/`setEmbeddingsMeta`; `src/index/vec.ts` exposes `composeEmbeddingText`; `src/index/fts.ts` exposes `buildFtsRow`/`upsertFtsRow`/`deleteFtsRow` and the `FtsRow` interface. Also confirm the presence of the test files the later tasks say to **extend** — `tests/integration/index-incremental.test.ts`, `tests/unit/index/run-index.test.ts`, `tests/unit/store/migrate.test.ts`, `tests/unit/index/embeddings-store.test.ts` (each exists today) — and note that `tests/unit/index/index-state.test.ts` and `tests/unit/cli/index-cmd.test.ts` do **not** yet exist and are created new by their guarding tasks. Run `bun test tests/unit/index/` and `bun run lint` to confirm a green starting point. (No code change; this is the pre-flight that anchors every file path cited below.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `index_state` table, its repo, and the fingerprint helpers — every user story depends on these. NO user-story work may start until this phase is complete.

**⚠️ CRITICAL**: This is the durable skip ledger + the fingerprint contract. Without it the skip gate, model-change path, and orphan purge have nothing to read.

> **Task-id ordering (intentional, this phase only)**: implementation tasks T002–T004 are listed before the foundational tests T005–T008 that guard them, so that **T002 keeps its id as the cross-spec anchor** for the duplicate-prefix guard — `002` T001 and `004` T201 both gate on "`003` T002". Per Constitution VIII the tests (T005–T008) are still authored FIRST and MUST FAIL before T002–T004 land (each carries a `(guards Tnnn)` backref). For this phase, **execution order is tests → impl**, not id order.

### Migration + duplicate-prefix guard

- [ ] T002 Add a duplicate numeric-prefix guard to the migrate runner in `src/store/migrate.ts`: in `discoverMigrations` (or `runMigrations`), throw a `MigrationError` when two files share a numeric prefix (e.g. two `004_*.sql`), per research.md R10 / data-model §4.1 (prevents the 002/003/004 cross-branch collision). Today no such guard exists — `discoverMigrations` sorts by `version` and would silently keep both.
- [ ] T003 [P] Author migration `migrations/005_index_state.sql` creating `index_state(dataset_id TEXT PRIMARY KEY REFERENCES datasets(id), content_fp TEXT, embed_fp TEXT, model_id TEXT, updated_at TEXT NOT NULL)` per data-model.md §4 — no secondary indexes (PK serves point lookups; reconciliation is a full scan). Header comment notes it is **separate** from `embeddings_meta` (global, single-row) and from 002's transient `index_failures`. (Renumber to the next free prefix at merge time per R10 — proposed name `005_index_state.sql`.)

### IndexStateRepo + fingerprint helpers

- [ ] T004 Implement `src/index/index-state.ts`:
  - `IndexStateRow` typed interface (`dataset_id`, `content_fp: string | null`, `embed_fp: string | null`, `model_id: string | null`, `updated_at: string`) mirroring the columns (data-model §1.1, §5.1 — reads tolerate NULLs by design).
  - `IndexStateRepo` (constructed with `Database`): `get(datasetId): IndexStateRow | null` (point lookup), `upsertContent(datasetId, contentFp, now?)` and `upsertEmbed(datasetId, embedFp, modelId, now?)` — **merge per-field** so a tags-only refresh rewrites `content_fp` + `updated_at` and leaves `embed_fp`/`model_id` intact and vice-versa (data-model §1.1 invariants, FR-003/FR-010), `delete(datasetId)`, `listDatasetIds(): string[]` (full `SELECT dataset_id FROM index_state` scan for the reconciler).
  - Fingerprint helpers (pure functions): `serializeFtsRow(row: FtsRow): string` — ordered `label=value\n` lines, one per `FtsRow` field **excluding `dataset_id`**, in the FTS column order declared by `migrations/003_index.sql` (`title_bg`, `title_en`, `description_bg`, `description_en`, `publisher_label`, `tag_labels`, `group_labels`, `column_labels`, `entity_labels`), empties emitted as `label=\n` (data-model §2.1); `contentFp(row: FtsRow): string` = `sha256Hex(serializeFtsRow(row))`; `embedFp(text: string): string` = `sha256Hex(text)` over the **exact** `composeEmbeddingText` output (no trim/reorder/rejoin, data-model §2.2); `modelIdOf(embedder: Embedder): string` = `` `${embedder.id}#${embedder.dimension}` `` (research.md R2 encoding, data-model §2.3). Reuses `sha256Hex` (`src/lib/hash.ts`) and `nowIso` (`src/lib/time.ts`). Imports `FtsRow` from `src/index/fts.ts` and `Embedder` from `src/index/embedder.ts`. (`serializeFtsRow` MAY instead be exported from `src/index/fts.ts` next to `buildFtsRow` — see plan.md Files-to-modify note; keep one home and import it.)

### Foundational tests (TDD — write FIRST, ensure they FAIL before T002–T004)

> **NOTE**: Per Constitution VIII these are written before the code above and must fail first.

- [ ] T005 [P] Unit tests for the duplicate-prefix guard in `tests/unit/store/migrate.test.ts` (extend existing file): two files sharing a numeric prefix throw `MigrationError`; distinct prefixes still apply in order; existing migrate tests stay green (guards T002).
- [ ] T006 [P] Unit tests for `index_state` migration shape in `tests/unit/index/index-state.test.ts` (table created by the migration; PK on `dataset_id`; all three fingerprint columns nullable; `updated_at` NOT NULL) (guards T003).
- [ ] T007 [P] Unit tests for `IndexStateRepo` in `tests/unit/index/index-state.test.ts` (same file as T006): NULL-tolerant `get` on a fresh row; `upsertContent` then `upsertEmbed` accumulate into one row; **partial merge** — `upsertContent` alone leaves `embed_fp`/`model_id` NULL and a later `upsertContent` does not clobber a prior `embed_fp` (FR-003 tags-only); `delete`; `listDatasetIds` returns exactly the inserted ids (guards T004 repo).
- [ ] T008 [P] Unit tests for fingerprint helpers in `tests/unit/index/index-state.test.ts` (same file): `serializeFtsRow` emits the 9 ordered lines with empties present; a value moving across a field boundary (e.g. text in `title_bg` vs `description_bg`) changes the digest; **Cyrillic round-trip** — a Cyrillic `FtsRow` hashes deterministically and byte-exact (no normalization, Principle X); `embedFp` equals `sha256Hex` of the raw `composeEmbeddingText` string (no trimming); `modelIdOf` formats `` `${id}#${dimension}` `` (guards T004 helpers).

**Checkpoint**: `bun run db:migrate` applies `005_index_state` on a clean checkout; `IndexStateRepo` + fingerprint helpers pass 100% line + branch coverage over `src/index/index-state.ts`. User-story implementation may now begin.

---

## Phase 3: User Story 1 — A routine re-index only touches what changed (Priority: P1) 🎯 MVP

**Goal**: `runIndex` becomes incremental by default. For each target dataset, build its `FtsRow`, then skip a store **only** when its fingerprint matches AND the corresponding store row is present; otherwise recompute, writing the matching `index_state` field **after** the store write, each dataset in its own transaction (FR-001, FR-003, FR-010). A tags-only change refreshes FTS without re-embedding; an unchanged corpus does zero embeds.

**Independent Test** (quickstart §1–§3a): build the full index, re-run with no changes → `embedded:0`, `skippedUnchanged:N`, stored vectors byte-identical; change one dataset's embedding input → exactly that one re-embedded; change only `tags_json` → `ftsUpdated:1`, `vectorsUpdated:0`.

### Tests for User Story 1 (TDD — write FIRST, ensure they FAIL) ⚠️

- [ ] T009 [P] [US1] Unit tests for the skip-decision truth table in `tests/unit/index/run-index.test.ts` (extend existing file) — drive both tables in data-model §3 with a deterministic stub `Embedder` that records `embed()` invocations: `content_fp` match + FTS row present → FTS skip; `content_fp` match + FTS row missing → FTS recompute (presence guard); NULL/mismatched `content_fp` → recompute; `embed_fp`+`model_id` match + embedding row present → vector skip (`skippedUnchanged`); `embed_fp` mismatch → re-embed (guards T020).
- [ ] T010 [P] [US1] Unit tests for per-dataset transactional write ordering in `tests/unit/index/run-index.test.ts` — `content_fp` is never present without its `datasets_fts` row, `embed_fp`/`model_id` never present without the `dataset_embeddings` row; a tags-only pass writes `content_fp` only (FR-010, data-model §1.1 invariants) (guards T021).
- [ ] T011 [US1] Integration test SC-001 (no-op re-index) in `tests/integration/index-incremental.test.ts` (extend existing file): full build, then re-run incrementally → `embedded:0`, `vectorsUpdated:0`, `skippedUnchanged:N`; capture a SHA-256 over `(dataset_id || vector)` for all `dataset_embeddings` rows before and after — the two digests MUST be identical (quickstart §2) (guards US1 end-to-end).
- [ ] T012 [US1] Integration test SC-002 (changed-only re-embed) in `tests/integration/index-incremental.test.ts`: for **each** of the four FR-002 indexable inputs **independently** — title, description, machine translation, attached entity — mutate exactly one dataset's that input on a freshly-converged index and re-run → `ftsUpdated:1`, `vectorsUpdated:1`, `embedded:1`, `skippedUnchanged:N-1`, with `embed_fp` (and, for the FTS-visible fields, `content_fp`) bumped only for the touched dataset (one `describe`/loop case per input source so dropping any single source from `composeEmbeddingText`/`buildFtsRow` is caught, FR-002 enumerated list); a newly-added dataset is embedded without re-embedding any unchanged one (US1 scenarios 2–3).
- [ ] T013 [US1] Integration test (tags-only, FR-003) in `tests/integration/index-incremental.test.ts`: change only `tags_json` → `ftsUpdated:1`, `vectorsUpdated:0`, `embedded:0` (`content_fp` bumped, `embed_fp` unchanged) (quickstart §3a).
- [ ] T014 [US1] Integration test (identical-content independence) in `tests/integration/index-incremental.test.ts`: two datasets with byte-identical indexable content are each fingerprinted and skipped independently — indexing/changing one never causes the other to be skipped or recomputed (spec edge case, US1).
- [ ] T015 [US1] Integration test (interrupted-run convergence / presence guard) in `tests/integration/index-incremental.test.ts`: simulate a fingerprint recorded WITHOUT its store row (delete the `datasets_fts` / `dataset_embeddings` row but leave `index_state`), re-run incrementally → that dataset is recomputed with no `--full` needed (FR-001, FR-008, spec edge case "partial previous run") (guards the presence term of T020).

### Implementation for User Story 1

- [ ] T016 [US1] Extend `RunIndexResult` in `src/index/run-index.ts` with the FR-007 counts: add `embedded`, `skippedUnchanged`, `reembeddedDueToModelChange`, `purged` alongside existing `ftsUpdated`/`vectorsUpdated` (research.md R9). Initialize all to 0. (Backward compatible — existing fields retained.)
- [ ] T017 [US1] Extend `RunIndexOptions` / resolve effective mode in `src/index/run-index.ts`: add an `incremental?: boolean` option; compute `const incremental = !opts.full && (opts.incremental ?? true)` (research.md R4 — `--full` overrides; default true). (CLI wiring of the config value is T036 in Phase 6.)
- [ ] T018 [US1] In `src/index/run-index.ts`, instantiate `IndexStateRepo` and import `contentFp`, `embedFp`, `modelIdOf`, plus `ensureEmbeddingsTable`/`deleteEmbedding`/`getEmbeddingsMeta` from `src/index/embeddings-store.ts` and `composeEmbeddingText` from `src/index/vec.ts`. Add cheap store-presence point lookups (`SELECT 1 FROM datasets_fts WHERE dataset_id = ?`, `SELECT 1 FROM dataset_embeddings WHERE dataset_id = ?`) as local helpers (research.md R3). (Depends on T004.)
- [ ] T019 [US1] In `src/index/run-index.ts`, compute the run-start model identity once: read `getEmbeddingsMeta` and derive `currentModelId = modelIdOf(embedder)` (research.md R8; the global `embeddings_meta` write is US2/T025, but the per-dataset comparison value is established here so the gate can read it). (Depends on T018; the actual model-change branch is T026.)
- [ ] T020 [US1] Replace the unconditional re-embed loop body in `src/index/run-index.ts` with the per-dataset skip gate (data-model §3): for each active target, `buildFtsRow`; `ftsSkip = state?.content_fp === contentFp(row) && ftsRowPresent`; `vecSkip = state?.embed_fp === embedFp(composeEmbeddingText(...)) && state.model_id === currentModelId && embeddingRowPresent`. Recompute only what is not skipped; bump `skippedUnchanged` when both legs skip. **SEAM NOTE (002): keep "decide the changed/selected set of dataset ids needing a vector" as a distinct step from "embed that set" — 002 will batch the set. Do NOT inline one-at-a-time embedding assumptions into the decision.** (Depends on T017–T019; guards T009.)
- [ ] T021 [US1] In `src/index/run-index.ts`, wrap each dataset's writes in its own `withTransaction` (`src/store/db.ts`) with strict ordering: upsert FTS row → `indexState.upsertContent` (`content_fp` only after the FTS upsert); persist vector → `indexState.upsertEmbed` (`embed_fp`/`model_id` only after the vector persists), each merging only the field(s) whose work ran this pass (FR-010, research.md R5, data-model §1.1). Increment `ftsUpdated`/`vectorsUpdated`/`embedded` accordingly. (Depends on T020; guards T010.)

**Checkpoint**: `bun run src/cli/danni.ts index` over an unchanged corpus reports `embedded:0`/`skippedUnchanged:N` with byte-identical vectors; a one-field change re-embeds exactly one; a tags-only change refreshes FTS only. US1 modules at 100% line + branch. **MVP shippable here (incremental default + tags-only refresh + interrupted-run convergence).**

---

## Phase 4: User Story 2 — Changing the embedder forces a full re-embed automatically (Priority: P1)

**Goal**: A change in embedder id/dimension (vs each dataset's `index_state.model_id`) re-embeds vectors **only** — never FTS (FR-004). The global `embeddings_meta` identity is recorded once at run start; the per-dataset decision reads `index_state.model_id` so a partial/interrupted model switch converges. Model-driven re-embeds are counted as `reembeddedDueToModelChange`.

**Independent Test** (quickstart §4): index with model A, switch to model B (different id/dimension), re-run → `reembeddedDueToModelChange:N`, `ftsUpdated:0`; `embeddings_meta` and every `index_state.model_id` reflect B; re-run with same model → `reembeddedDueToModelChange:0`.

### Tests for User Story 2 (TDD — write FIRST, ensure they FAIL) ⚠️

- [ ] T022 [P] [US2] Unit tests for the model-change branch in `tests/unit/index/run-index.test.ts`: with `embed_fp` matching but `model_id` mismatching, the vector is re-embedded and counted under `reembeddedDueToModelChange` (not `embedded`); FTS is NOT touched when only the model changed (`ftsUpdated` stays 0); same model + same content → both counts 0; **count-precedence case** — when a dataset's `embed_fp` is mismatched/NULL **and** its `model_id` also differs (content **and** model changed in the same run), it is counted **once under `embedded`** and **not** under `reembeddedDueToModelChange` (content takes precedence; the two reasons are mutually exclusive, data-model §3 second table + count-precedence note, FR-004) (guards T026). **SEAM NOTE (002): the model-changed set is just another "set of ids needing a vector" — same seam as T020; 002 batches it.**
- [ ] T023 [P] [US2] Unit tests for run-start `embeddings_meta` bootstrap in `tests/unit/index/run-index.test.ts` (or `tests/unit/index/embeddings-store.test.ts`): NULL `embeddings_meta` on the first run behaves as model-changed (every dataset re-embeds); the global identity is written once at run start, not lazily per dataset (research.md R8) (guards T025/T026).
- [ ] T024 [US2] Integration test SC-003 (model switch) in `tests/integration/index-incremental.test.ts`: index with stub embedder A (`id`/`dimension` X), switch to stub B (different `id` or `dimension`), re-run → `reembeddedDueToModelChange:N`, `embedded:0`, `ftsUpdated:0`; assert `embeddings_meta.model_id`/`dimension` and `SELECT DISTINCT model_id FROM index_state` both reflect B; a subsequent same-model run → `skippedUnchanged:N`, `reembeddedDueToModelChange:0` (US2 scenarios 1–2, quickstart §4) (guards US2 end-to-end).

### Implementation for User Story 2

- [ ] T025 [US2] In `src/index/run-index.ts`, at run start record the global model identity in `embeddings_meta` via `setEmbeddingsMeta(db, embedder.id, embedder.dimension)` when it differs from the stored meta or is NULL (research.md R8). This decouples the global marker from the per-dataset decision. (Depends on T019.)
- [ ] T026 [US2] In `src/index/run-index.ts`, add **only** the counting/branch decision for a vector recompute (the per-dataset `embed_fp`/`model_id` persist is T021's — do not restate the `upsertEmbed` call here): classify the recompute as `reembeddedDueToModelChange` **only** when `embed_fp` matches but `state.model_id !== currentModelId` (a *pure* model change); a content-driven re-embed (changed/NULL `embed_fp`) stays `embedded` **even when `model_id` also differs** — content takes precedence so the two reasons stay mutually exclusive and a dataset is never double-counted (data-model §3 count-precedence note); ensure the FTS leg is never triggered by a model-only change (FR-004 — model change re-embeds vectors only). Satisfies the T022 model-change + count-precedence unit tests. (Depends on T021, T025.)
- [ ] T027 [US2] Confirm/keep `src/index/vec.ts` `upsertEmbeddingFor`'s lazy `setEmbeddingsMeta` as a harmless safety net but ensure the per-dataset decision in `run-index.ts` depends only on `index_state.model_id`, not on the global meta (research.md R8 "Note on existing coupling"). If `run-index.ts` now persists vectors directly (to write `embed_fp` per dataset), document that `upsertEmbeddingFor` is bypassed by the incremental loop and is retained only for any remaining direct callers; no behavior change to `vec.ts` exports. (Depends on T026.)

**Checkpoint**: switching the stub embedder re-embeds 100% of active datasets, leaves FTS untouched, and flips both the global and per-dataset model identity; same-model reruns re-embed nothing. US1+US2 modules at 100% line + branch.

---

## Phase 5: Orphan purge (P1, SC-004) — every-run reconcile-vs-listActive

**Goal**: Every incremental run, after the recompute pass and **always** (even under `--datasets`), reconciles all index stores against `DatasetsRepo.listActive()` and deletes rows for any `dataset_id` present in a store but absent from the active set, from `datasets_fts` (`deleteFtsRow`), `dataset_embeddings` (`deleteEmbedding`), and `index_state` (`IndexStateRepo.delete`); accumulate `purged` (FR-006, SC-004). This closes the documented orphan-embedding leak.

> Note: this is shared P1 infrastructure that US1 and US2 both rely on for FR-008/SC-005 (an index functionally identical to a full rebuild), so it is its own phase rather than nested under a single story.

### Tests for the orphan purge (TDD — write FIRST, ensure they FAIL) ⚠️

- [ ] T028 [P] Unit tests for the reconciler in `tests/unit/index/run-index.test.ts`: given store rows whose `dataset_id` is not in `listActive()`, the set difference is deleted from all three stores; active rows are never deleted; an empty difference deletes nothing (FR-006) (guards T030).
- [ ] T029 Integration test SC-004 (withdraw purges all three stores) in `tests/integration/index-incremental.test.ts`: index a corpus, set one dataset `lifecycle_state='withdrawn'`, re-run incrementally → `purged:1`; assert `COUNT(*)=0` for that `dataset_id` in `datasets_fts`, `dataset_embeddings`, AND `index_state` (quickstart §5) (guards purge end-to-end).
- [ ] T030 Integration test (purge runs full-corpus under `--datasets`) in `tests/integration/index-incremental.test.ts`: withdraw a dataset, then run `runIndex({ datasetIds: ['some-other-id'] })` that does NOT name the withdrawn id → the withdrawn dataset is STILL purged from all three stores while only `some-other-id` is considered for recompute (FR-006 full-corpus clause, quickstart §5a) (guards the full-corpus scope of T031).

### Implementation for the orphan purge

- [ ] T031 In `src/index/run-index.ts`, after the recompute pass, implement the reconciler: `activeIds = new Set(datasets.listActive().map(d => d.id))`; enumerate ids in each store (`SELECT dataset_id FROM datasets_fts`, `SELECT dataset_id FROM dataset_embeddings`, `IndexStateRepo.listDatasetIds()`); delete the set difference (`id ∉ activeIds`) via `deleteFtsRow` / `deleteEmbedding` / `indexState.delete`; accumulate a single `purged` count (count distinct purged dataset ids). Run this **unconditionally**, including under `--datasets` (research.md R6, FR-006). **SEAM NOTE (002): when `index_failures` (002) lands, the same set-difference must also clear non-active rows there — write the reconciler set-difference-driven so adding a 4th store is a one-line extension (plan.md §Cross-Spec Coordination).** Remove the old per-target `ds.lifecycle_state !== 'active'` FTS-only delete branch (the documented bug it embodies). (Depends on T020–T021; guards T028.)

**Checkpoint**: a withdrawn dataset disappears from keyword AND semantic search after one incremental run with no `--full`; the purge is full-corpus even under a `--datasets` subset; active rows are never touched.

---

## Phase 6: User Story 3 — Force a clean full rebuild on demand (Priority: P2) + CLI wiring

**Goal**: `--full` ignores all fingerprints and rebuilds **all three** stores in **one** transaction (not a bare FTS `DELETE`), re-deriving every active dataset's FTS row, vector, and fresh `index_state` (FR-005, research.md R7). The CLI passes `config.index.incremental` into `runIndex` with precedence `--full` > config > default(true) (FR-009), and prints the extended result JSON.

**Independent Test** (quickstart §1, §6, §7): `index --full` re-embeds every active dataset irrespective of fingerprints and the resulting index is byte-identical to the incremental-converged index (SC-005); `index.incremental=false` recomputes all without a destructive clear; `--full` > config.

### Tests for User Story 3 (TDD — write FIRST, ensure they FAIL) ⚠️

- [ ] T032 [P] [US3] Unit tests for `--full` single-transaction rebuild in `tests/unit/index/run-index.test.ts`: `--full` clears `datasets_fts`, `dataset_embeddings`, and `index_state` then re-derives all active datasets, all inside one `withTransaction`; every active dataset is re-embedded regardless of pre-existing fingerprints; a `--full` run produces a fresh `index_state` for every active dataset (FR-005, research.md R7) (guards T035).
- [ ] T033 [P] [US3] Unit tests for CLI precedence in `tests/unit/cli/index-cmd.test.ts` (new file): `--full` flag → `runIndex` called with `full:true` (overrides config); `config.index.incremental=false` (no `--full`) → `runIndex` called with `incremental:false`; default (no flag, config `true`) → `incremental:true`; precedence `--full` > config > default (FR-009, research.md R4); the extended result JSON (the four FR-007 counts) is printed to stdout (guards T036–T037).
- [ ] T034 [US3] Integration test SC-005 (incremental == full-rebuild equivalence) in `tests/integration/index-incremental.test.ts`: run an arbitrary sequence of incremental runs (add, change, tags-only, withdraw, model-switch) to a final state; capture the FTS-row set + the per-dataset vector set; then run `--full` on the same final state and assert the FTS-row set and per-dataset vectors are identical (no missing/stale/duplicated entries) (FR-008, SC-005, quickstart §7) (guards US3 + the whole feature's correctness invariant).

### Implementation for User Story 3

- [ ] T035 [US3] In `src/index/run-index.ts`, implement the `--full` branch as a single `withTransaction` that clears all three stores (`DELETE FROM datasets_fts`, `DELETE FROM dataset_embeddings`, `DELETE FROM index_state`) then re-derives every active dataset's FTS row + vector + fresh `index_state` (writing `content_fp`, `embed_fp`, `model_id` for each), recording the global `embeddings_meta` identity at run start (research.md R7). Replace the current bare `opts.db.exec('DELETE FROM datasets_fts')` (which leaves `dataset_embeddings` and `index_state` untouched). `--full` does not consult the skip gate. (Depends on T021, T025; guards T032.)
- [ ] T036 [US3] Wire config + flags into `src/cli/index-cmd.ts`: pass `config.index.incremental` into `runIndex` as `incremental`; keep the existing `--full`/`--datasets` parsing in `parseFlags`; precedence resolved in `runIndex` (T017) as `--full` > config > default(true). (Depends on T017, T035.)
- [ ] T037 [US3] In `src/cli/index-cmd.ts`, ensure the extended `RunIndexResult` (the four FR-007 counts) flows through the existing `process.stdout.write(JSON.stringify(result))` surface (research.md R9 — no out-of-band stats). Extend the `index.completed` `log.info` in `src/index/run-index.ts` to include `embedded`/`skippedUnchanged`/`reembeddedDueToModelChange`/`purged` (FR-007, Principle IV). (Depends on T016, T036.)

**Checkpoint**: `index --full` rebuilds all three stores atomically and yields an index byte-identical to the incremental-converged one (SC-005); `index.incremental=false` recomputes all without a destructive clear; `--full` overrides config. All user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Coverage, lint, and end-to-end validation spanning all stories.

- [ ] T038 [P] Drive line + branch coverage to 100% over `src/index/{index-state.ts,run-index.ts}` and the touched edits in `src/index/{fts.ts,vec.ts,embeddings-store.ts}` and `src/cli/index-cmd.ts` (`bun test --coverage`); add targeted unit tests for any uncovered branch (NULL-meta bootstrap, empty-text skip in `composeEmbeddingText`, empty active set, no-target `--datasets`) (Constitution VIII).
- [ ] T039 [P] Biome clean: `bun run lint` and `bun run format` over all changed files; zero violations (Constitution — Lint/Format gate).
- [ ] T040 [P] Quickstart validation: walk `specs/003-incremental-indexing/quickstart.md` steps 0–7 end-to-end against a fixture store (full build → no-op → one-change → tags-only → model-switch → withdraw → `--datasets` purge → config-disable → interrupted-run → `--full` equivalence); confirm each reported JSON matches the expected counts in the quickstart.
- [ ] T041 [P] Confirm the 002 composition seam is documented in code: a short comment at the skip-gate/embedding boundary in `src/index/run-index.ts` (the T020/T026/T031 SEAM NOTEs) stating that 002 batches **only** the changed/selected set this loop yields, that FTS upserts stay per-dataset and outside batching, and that the orphan purge will also clear `index_failures` once that table lands (plan.md §Cross-Spec Coordination, research.md R5). No functional change — this guarantees 002 extends rather than rewrites the loop.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → no code change; pre-flight only.
- **Phase 2 (Foundational)** → BLOCKS all user stories. T002 (guard) ∥ T003 (migration) ∥ T004 (repo+helpers) — but T004 depends conceptually on T003's table existing for its tests; T005–T008 (tests) are written FIRST and fail until T002–T004 land.
- **Phase 3 (US1)** → starts after Phase 2. T016/T017 (result+mode) → T018 (wiring) → T019 (run-start identity) → T020 (skip gate) → T021 (per-dataset tx). Tests T009–T015 written first.
- **Phase 4 (US2)** → after Phase 3 (extends the same loop). T025 → T026 → T027. Tests T022/T023/T024 first.
- **Phase 5 (Orphan purge)** → after Phase 3 (needs the recompute pass + `IndexStateRepo`); independent of US2's counting but lands before SC-005 equivalence can pass. T031. Tests T028–T030 first.
- **Phase 6 (US3 + CLI)** → after Phases 3–5 (SC-005 equivalence compares incremental-converged vs `--full`). T035 → T036 → T037. Tests T032–T034 first.
- **Phase 7 (Polish)** → after all selected stories complete.

### User Story Dependencies

- **US1 (P1)** — the merged incremental loop; foundation for everything. No dependency on US2/US3.
- **US2 (P1)** — extends US1's loop with the model-change branch + run-start meta. Independently testable (model switch over a US1-built index).
- **US3 (P2)** — the `--full` escape hatch + CLI precedence. Its SC-005 equivalence test compares against the incremental path (US1+US2+purge), so it runs last.
- **Orphan purge (P1)** — shared infra both US1 and US2 rely on for FR-008/SC-005; ordered after US1.

### Within Each User Story / Phase

- Tests (mandatory, Constitution VIII) are written and made to FAIL before the implementation they guard.
- `index_state` table + `IndexStateRepo` + fingerprint helpers (Phase 2) before any gate logic.
- Skip gate before per-dataset transaction wiring; model-change branch before orphan purge before `--full`.
- CLI wiring after the `runIndex` mode/precedence resolution exists.

### Parallel Opportunities

- **Phase 2**: T002 ∥ T003; tests T005, T006, T007, T008 all parallel (different concerns, same/new test files).
- **US1**: tests T009, T010 parallel; integration tests T011–T015 share `index-incremental.test.ts` so write sequentially or as distinct `describe` blocks. Implementation T016/T017 are quick and parallel; T018–T021 are sequential edits to `run-index.ts`.
- **US2**: tests T022, T023 parallel; T025–T027 sequential edits to the same loop.
- **Orphan purge**: T028 (unit) parallel with US2 tests; T029/T030 sequential in the shared integration file.
- **US3**: tests T032 (unit run-index) ∥ T033 (new `index-cmd.test.ts`); implementation T035 then T036/T037.
- **Polish**: T038, T039, T040, T041 all parallel.

> Note: most implementation tasks edit the single file `src/index/run-index.ts` and are therefore **sequential among themselves** (not `[P]`), even though they belong to different stories. The seam to 002 (T020/T026/T031) keeps the *decision* step separable so 002's batching is an additive change, not a conflicting rewrite.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Write the failing tests first (TDD), in parallel:
Task: "T005 Unit tests for duplicate-prefix guard in tests/unit/store/migrate.test.ts"
Task: "T006 Unit tests for index_state migration shape in tests/unit/index/index-state.test.ts"
Task: "T007 Unit tests for IndexStateRepo in tests/unit/index/index-state.test.ts"
Task: "T008 Unit tests for fingerprint helpers in tests/unit/index/index-state.test.ts"

# Then implement in parallel where files differ:
Task: "T002 Duplicate-prefix guard in src/store/migrate.ts"
Task: "T003 Migration migrations/005_index_state.sql"
Task: "T004 IndexStateRepo + fingerprint helpers in src/index/index-state.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (Setup) → 2. Phase 2 (Foundational: table + repo + fingerprints) → 3. Phase 3 (US1 incremental skip gate).
2. **Stop and validate**: re-index an unchanged corpus → `embedded:0`/`skippedUnchanged:N` with byte-identical vectors; one-field change → exactly one re-embed; tags-only → FTS-only; interrupted run converges. Coverage 100% over US1 modules.
3. Shippable as the day-2 incremental indexer that delivers FR-015/SC-007 of 001.

### Incremental Delivery

1. MVP (US1) → demo: no-op re-index is near-instant.
2. Add US2 (model-change) → demo: switch the stub embedder, watch 100% re-embed, FTS untouched.
3. Add the orphan purge → demo: withdraw a dataset, watch it vanish from both indexes (SC-004).
4. Add US3 (`--full` + CLI precedence) → demo: `--full` rebuild byte-identical to the incremental-converged index (SC-005).
5. Polish (Phase 7) → coverage 100%, Biome clean, quickstart green, 002 seam documented.

### KEYSTONE handoff to 002 / 004

- Land 003 first. 002 then batches **only** the changed/selected set this loop yields (the T020/T026/T031 seam), persisting each vector with its `embed_fp`/`model_id`; FTS stays per-dataset, outside batching. The two share **one** merged `run-index` loop.
- 003's orphan purge (T031) is written set-difference-driven so it extends to clear 002's `index_failures` non-active rows in one line.
- Migration prefix is assigned at merge (`005_index_state.sql` proposed); the T002 duplicate-prefix guard protects the merge.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase. Most `run-index.ts` edits are intentionally sequential.
- [Story] label maps each task to its user story (US1/US2/US3); setup, foundational, orphan-purge, and polish phases carry no story label.
- Tests are MANDATORY and TDD (Constitution VII/VIII): write failing tests first, 100% line + branch coverage. There is no new portal endpoint or read contract, so no parity-matrix entry — the round-trip/equivalence tests are the contract guarantees here.
- Cyrillic preservation (Principle X): `serializeFtsRow`/`contentFp`/`embedFp` hash the exact UTF-8 strings already stored/embedded; no normalization. Asserted in T008 (fingerprint round-trip) and exercised by the Cyrillic fixtures in the integration tests.
- Transactional ordering (FR-010): `content_fp` only after the FTS upsert, `embed_fp`/`model_id` only after the vector persists, per-dataset commit — asserted in T010.
- The skip gate (FR-001) requires fingerprint match AND store-row present; the presence guard is what makes an interrupted run self-heal (T015).
- The orphan purge (FR-006) is keyed strictly to `listActive()` and runs full-corpus even under `--datasets` (T030).
- Commit after each task or logical group; stop at any checkpoint to run `bun test --coverage` and validate before proceeding.
