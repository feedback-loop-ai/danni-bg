# Implementation Plan: Incremental Indexing (Skip Unchanged Datasets)

**Branch**: `003-incremental-indexing` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-incremental-indexing/spec.md`

## Summary

Make `danni index` incremental by default: re-derive a dataset's keyword (FTS) entry and
its embedding only when the inputs that feed each actually changed, and purge index rows
for datasets that are no longer active. Today `runIndex` (`src/index/run-index.ts`)
re-embeds **every** active dataset on every run and leaves orphan vectors behind (it deletes
FTS rows only for non-active datasets it happens to visit, and never touches
`dataset_embeddings`). This feature adds a per-dataset fingerprint ledger, the
`index_state` table (`dataset_id`, `content_fp`, `embed_fp`, `model_id`), and gates each
store independently on (fingerprint match AND model identity match AND store row present).
`content_fp` is SHA-256 over the serialized `FtsRow` fields; `embed_fp` is SHA-256 over the
exact `composeEmbeddingText` output — so a tags-only change refreshes the keyword entry
without re-embedding. A model-identity change (embedder id/dimension vs the per-dataset
`index_state.model_id`) re-embeds vectors only, never FTS. `--full` force-rebuilds all three
stores in one transaction. Every incremental run reconciles all three stores against
`datasets.listActive()` and purges orphans full-corpus, even under `--datasets`. Composes
with 002 (the changed set is what gets batched) and delivers the incremental-index behavior
already promised by FR-015/SC-007 of 001.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, `noUncheckedIndexedAccess`, no `any`
outside type guards) — unchanged from 001.
**Primary Dependencies**:
- Runtime: Bun 1.x with `bun:sqlite` (existing `openDb` / `withTransaction` in
  `src/store/db.ts`).
- Hashing: `sha256Hex` from `src/lib/hash.ts` (Node `crypto`), already used by the
  migrate runner and blob store — reused for both fingerprints.
- Validation: Zod ^3.25.x. No new config schema needed — `config.index.incremental`
  already exists in `IndexConfigSchema` (`src/config/schema.ts`).
- Migrations: forward-only SQL via the in-house runner (`src/store/migrate.ts`),
  one new file.
- Testing: `bun test` + coverage (`--coverage --coverage-threshold=1.0`) per 001's
  Complexity Tracking decision (Vitest hangs under Bun with `bun:sqlite`).
- Lint/Format: Biome.

**Storage**: One new table `index_state` inside `store/danni.sqlite`. No new on-disk blob
layout. No new contract files (index_state is internal bookkeeping, not a published read
contract).

**Testing**: `bun test` against in-memory/temp SQLite stores seeded with fixture datasets;
deterministic stub `Embedder` (records invocations and returns fixed vectors) to assert
re-embed counts. No live network or live embedder needed for the inner loop (Principle VI).

**Target Platform**: Linux server / macOS dev — unchanged from 001.

**Project Type**: Single project — CLI + library. This feature is confined to `src/index/`,
`src/cli/index-cmd.ts`, and one migration.

**Performance Goals**:
- A re-index over an unchanged corpus re-embeds zero datasets and completes in a small
  fraction of a full rebuild (SC-001). The dominant cost becomes N point-lookups +
  N fingerprint computations, not N embedder calls.
- When K of N datasets changed, exactly K are re-embedded (SC-002).
- `bun test` unit suite remains < 5s (Principle VI).

**Constraints**:
- 100% line + branch coverage (Principle VIII).
- Cyrillic preserved byte-exact: fingerprints are computed over the same UTF-8 strings
  that are stored/embedded; no normalization that could alter Cyrillic (Principle X).
- Per-dataset transactional write ordering: `content_fp` only after the FTS upsert,
  `embed_fp`/`model_id` only after the vector persists (FR-010).
- The orphan purge is keyed strictly to `listActive()` and runs full-corpus even under
  `--datasets` (FR-006).

**Scale/Scope**: ~10⁴ active datasets (per 001). Incremental state is one small row per
dataset; the reconciliation scan is three `SELECT dataset_id FROM <store>` enumerations
diffed against an in-memory active-id `Set`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence in this plan |
|---|-----------|--------|------------------------|
| I | AI-Native Development | ✅ PASS | Read path is unchanged; this feature only changes *how much* is recomputed, never *what* the index contains for a given end state (FR-008/SC-005). Run-result counts (`embedded`/`skippedUnchanged`/`reembeddedDueToModelChange`/`purged`) are structured JSON on the CLI surface. No authoritative portal data is altered. |
| II | Spec-Driven Development | ✅ PASS | spec.md (WHAT, two clarification rounds) → this plan + research.md + data-model.md (HOW) → tasks.md (next) → `bun test` (VALIDATION). Roles separated in artifacts. |
| III | Contract-First API Design | ✅ PASS | No new MCP tool, no new portal endpoint. `index_state` is internal index bookkeeping — correctly NOT added to `contracts/`. The CLI flag/precedence contract (`--full` > config > default) and the run-result count shape are documented in quickstart.md before implementation. |
| IV | Operational Excellence | ✅ PASS | Each run logs structured counts (extends the existing `log.info('index.completed', …)`). Per-dataset transactional commit (FR-010) makes an interrupted run converge on the next run without manual intervention (graceful degradation). |
| V | Simplicity & YAGNI | ✅ PASS | One table, four columns; reuses `sha256Hex`, `buildFtsRow`, `composeEmbeddingText`, `withTransaction`, `DatasetsRepo.listActive`, `deleteFtsRow`, `deleteEmbedding`. No new config schema (reuses existing `config.index.incremental`). No new CLI flag (reuses existing `--full`/`--datasets`). Every column cites an FR. |
| VI | Fast Feedback Loops | ✅ PASS | `bun test` against temp SQLite + deterministic stub embedder; no network/live embedder in the inner loop. Incremental indexing itself makes the dev loop's own re-index fast. |
| VII | Type Safety & Validation | ✅ PASS | New `IndexStateRow` typed interface; reads tolerate NULL fingerprints by design. `config.index.incremental` validated by existing Zod schema. No new JSON columns ⇒ no nested-JSON parse risk. |
| VIII | 100% Test Coverage & Endpoint Parity | ✅ PASS | TDD: fingerprint serializers, the skip gate (each truth-table row in data-model §3), the model-change path, the orphan purge (incl. full-corpus-under-`--datasets`), the `--full` single-transaction rebuild, and interrupted-run convergence each get tests before code. No new portal endpoint ⇒ parity matrix unaffected. Coverage gate stays 100% line + branch. |
| IX | Data Freshness & Sync Integrity | ✅ PASS | Strengthens integrity: orphan purge (FR-006) ensures search never returns a withdrawn dataset (SC-004), closing the current orphan-embedding leak. No authoritative field is mutated; only derived index rows are added/removed. |
| X | Bulgarian-Locale Awareness | ✅ PASS | Fingerprints hash the exact UTF-8 Cyrillic strings already stored/embedded; no case-folding or diacritic stripping in the fingerprint path (FTS5's `remove_diacritics 0` is untouched). Cyrillic fixtures included in fingerprint round-trip tests. |
| XI | Respectful Crawling | ✅ N/A | No crawler surface touched; indexing reads the local store only. |

**Result**: All gates PASS. No new violations; no Complexity Tracking entries required
beyond the inherited `bun test` decision (001) and the cross-feature migration-numbering
coordination flagged in research.md R10 / data-model §4.1.

## Project Structure

### Documentation (this feature)

```text
specs/003-incremental-indexing/
├── plan.md              # This file
├── research.md          # Phase 0 output (R1–R10)
├── data-model.md        # Phase 1 output (index_state + fingerprint contract + migration)
├── quickstart.md        # Phase 1 output (end-to-end verification + SC checklist)
├── spec.md
└── tasks.md             # Created by /speckit-tasks (not by /speckit-plan)
```

No `contracts/` directory: this feature introduces no MCP tool, no portal endpoint, and no
published read contract. `index_state` is internal index bookkeeping.

### Source Code (repository root)

Files to **add**:

```text
migrations/
└── 005_index_state.sql          # NEW — index_state table (renumber at merge; see R10)

src/index/
├── index-state.ts               # NEW — IndexStateRow type, repo (get/upsert/delete/listIds),
│                                #        serializeFtsRow + content/embed/model fingerprint helpers
```

Files to **modify**:

```text
src/index/run-index.ts           # Add incremental mode: per-dataset skip gate (content/embed/
│                                #   model + store-row presence), per-dataset transaction (FR-010),
│                                #   model identity recorded at run start, --full = single-tx
│                                #   3-store rebuild, full-corpus orphan purge; extend RunIndexResult
│                                #   with embedded/skippedUnchanged/reembeddedDueToModelChange/purged
src/index/fts.ts                 # Export serializeFtsRow(row) (or place in index-state.ts) so
│                                #   content_fp is computed from the exact FtsRow that is upserted
src/index/vec.ts                 # Expose embedding text for fingerprinting without forcing an embed;
│                                #   keep composeEmbeddingText as the single source of embed_fp bytes
src/index/embeddings-store.ts    # (Read) reuse deleteEmbedding for purge; model identity recorded
│                                #   at run start rather than lazily inside upsertEmbeddingFor
src/cli/index-cmd.ts             # Pass config.index.incremental into runIndex; precedence
│                                #   --full > config > default(true); print extended result JSON
```

Files **read but not modified** (depended upon):

```text
src/store/db.ts                  # withTransaction for the per-dataset commit and --full rebuild
src/store/repos/datasets.ts      # DatasetsRepo.listActive() — the purge source of truth
src/lib/hash.ts                  # sha256Hex for both fingerprints
src/lib/time.ts                  # nowIso() for index_state.updated_at
src/store/migrate.ts             # forward-only runner that applies 005_index_state.sql
src/config/schema.ts             # IndexConfigSchema.incremental — already present, unchanged
```

**Structure Decision**: Single-project layout (inherited from 001). All new logic lives under
`src/index/` next to the code it extends (`run-index.ts`, `fts.ts`, `vec.ts`,
`embeddings-store.ts`), keeping the per-pipeline-stage organization. The new `index-state.ts`
module owns the fingerprint ledger (table access + serialization) so `run-index.ts` stays an
orchestrator. No new top-level directory.

## Implementation Phases

Ordered, TDD-first (tests precede code per Principle VIII). Each phase is independently
testable.

**Phase 0 — Research (done).** R1–R10 in research.md resolve fingerprint serialization,
table placement, skip gate, precedence wiring, transactional ordering, orphan purge, `--full`
semantics, model-change detection, run-count shape, and migration-numbering coordination.

**Phase 1 — Migration + index_state repo (foundation).**
1. Write `migrations/005_index_state.sql` (data-model §4). Verify the migrate runner applies
   it (`src/store/migrate.ts`) and the checksum guard holds.
2. Add `src/index/index-state.ts`: `IndexStateRow` type and a small repo
   (`get(datasetId)`, `upsertContent`/`upsertEmbed` merge-per-field, `delete(datasetId)`,
   `listDatasetIds()`), plus fingerprint helpers `contentFp(ftsRow)`, `embedFp(text)`,
   `modelId(embedder)`. Tests: NULL-tolerant reads, partial upserts (tags-only updates
   `content_fp` only), Cyrillic round-trip on `serializeFtsRow`.

**Phase 2 — Fingerprint serialization (US-1 core).**
3. Add `serializeFtsRow(row): string` producing ordered `label=value\n` lines in
   `migrations/003_index.sql` column order, empties included (data-model §2.1). Wire
   `contentFp` to it. Wire `embedFp` to the exact `composeEmbeddingText` output (data-model
   §2.2). Tests: a value moving across a field boundary changes `content_fp`; a tags-only
   change changes `content_fp` but not `embed_fp`.

**Phase 3 — Incremental skip gate in `runIndex` (US-1, P1).**
4. Resolve effective mode: `incremental = !full && (config.index.incremental ?? true)`
   (R4). Record the current model identity at run start (R8).
5. For each target dataset: build `FtsRow`; compute `ftsSkip`/`vecSkip` per the data-model §3
   truth table (fingerprint match AND store-row present; vector also gated on model match).
   Recompute only what is not skipped, each dataset in one `withTransaction` writing the
   matching `index_state` field(s) **after** the store write (FR-010). Tests: SC-001 (no
   change ⇒ 0 re-embeds), SC-002 (K of N), tags-only (FTS-only), new dataset, two datasets
   with identical content skipped independently, interrupted-run convergence (fp present but
   store row missing ⇒ recompute).

**Phase 4 — Model-change path (US-2, P1).**
6. Per-dataset `model_id` comparison drives `reembeddedDueToModelChange`; a model change
   re-embeds vectors only, never FTS (FR-004). Record the global identity in `embeddings_meta`
   at run start. Tests: SC-003 (switch model ⇒ 100% re-embed, FTS untouched, both
   `embeddings_meta` and every `index_state.model_id` reflect the new model); same model ⇒ 0
   model re-embeds; NULL `embeddings_meta` first run behaves as model-changed.

**Phase 5 — Orphan purge (P1, SC-004).**
7. After the recompute pass (and always, even under `--datasets`), compute
   `activeIds = Set(listActive().map(d=>d.id))`, enumerate ids in each store, delete the set
   difference from `datasets_fts` (`deleteFtsRow`), `dataset_embeddings` (`deleteEmbedding`),
   and `index_state`; accumulate `purged`. Tests: withdrawn dataset purged from all three;
   purge runs full-corpus when a `--datasets` subset excludes the withdrawn id; active rows
   never purged.

**Phase 6 — `--full` rebuild + CLI wiring + reporting (US-3, P2).**
8. `--full`: in one `withTransaction`, clear all three stores then re-derive every active
   dataset's FTS row, vector, and fresh `index_state` (R7). Tests: every active dataset
   re-embedded irrespective of fingerprints; resulting index byte-identical to the
   incremental-converged index (SC-005).
9. `src/cli/index-cmd.ts`: pass `config.index.incremental` into `runIndex`; keep the existing
   `--full`/`--datasets` parsing; print the extended result JSON. Tests: precedence
   (`--full` > config=false > default true); config=false disables skipping without a
   destructive clear.
10. Extend `RunIndexResult` + the `index.completed` log with the four FR-007 counts.

**Phase 7 — Coverage + polish.** Drive line+branch coverage to 100% (Principle VIII); Biome
clean; quickstart.md commands pass end-to-end; confirm composition seam with 002 documented
(the changed set is the batched set; FTS stays per-dataset).

## Complexity Tracking

> No Constitution violations introduced by this feature. The two items below are *inherited
> constraints / coordination flags*, not new violations, recorded for the implementer.

| Item | Why it exists | Note |
|------|---------------|------|
| `bun test` (not Vitest) | Inherited from 001 Complexity Tracking — `bun:sqlite` only resolves under the Bun runtime; Vitest's worker pool hangs. | Keeps describe/it/expect API and 100% line+branch coverage enforcement; no change for this feature. |
| Migration number is **not** the branch number | Three in-flight features (002, 003, 004) each add one migration; the runner keys on the numeric prefix and rejects duplicate versions on merge. Branch `003-*` does NOT imply `003_*` (taken by `003_index.sql`). | Proposed file `005_index_state.sql`; assign 004/005/006 in merge order (research.md R10, data-model §4.1). The merging engineer renumbers to the next free prefix. |
## Cross-Spec Coordination (review 2026-06-04)

Features 002/003/004 were planned in parallel and share infrastructure; a cross-spec review reconciled:

- **Migration numbering (canonical, collision-free):** `004_index_failures.sql` (002), `005_index_state.sql` (003), `006_crawl_checkpoint.sql` (004). All are additive and order-independent; `src/store/migrate.ts` should also gain a duplicate-prefix guard.
- **run-index composition (002 ↔ 003): land 003 first.** 003 owns the per-dataset incremental loop (fingerprint check → FTS upsert + `content_fp`; embed + `embed_fp`/`model_id`, each in its own transaction; model identity read once at run start). 002 then batches **only the changed/selected set** 003 yields, persisting each vector with its `embed_fp`/`model_id`. The two MUST share one merged `run-index` loop, not two competing rewrites.
- **Orphan purge:** 003's every-run reconcile-vs-`listActive()` purge MUST also clear 002's `index_failures` rows for non-active datasets.
- **004 orchestrator:** the egov crawl is wired through `src/crawler/run-sync.ts`, sharing the single `sync_runs_lock` (egov & CKAN mutually exclusive); egov exit codes mirror the CKAN path.
