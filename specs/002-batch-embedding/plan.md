# Implementation Plan: Batched Embedding for the Vector Index

**Branch**: `002-batch-embedding` | **Date**: 2026-06-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-batch-embedding/spec.md`

## Summary

Replace the current one-request-per-dataset embedding loop with a **batched
embedding pass** so a real (hosted or local) embedder can re-index the whole
~12k-dataset corpus in `⌈N / batchSize⌉` requests instead of `N`. The embedder
interface (`Embedder.embed(texts: string[])`) already accepts multiple texts;
the change is entirely on the **caller side** — a new, **pure** batcher module
`src/index/batch-embed.ts` (chunking + positional length-check + single-text
retry + forced-single + 429/5xx backoff, returning a `BatchEmbedResult` and
writing **no** DB state) plus the seam in 003's merged `src/index/run-index.ts`
loop that hands the changed/selected set to the batcher and owns **all**
persistence — plus a small config addition (`enrichment.embedder.batchSize` /
`maxBatchSize`) and a new `index_failures` table that persists per-dataset
"not-embedded" reasons for later inspection. `src/index/vec.ts` is **not**
modified: its `composeEmbeddingText` is reused read-only to build each pair's
text. The vector persistence (`upsertEmbedding` + 003's `IndexStateRepo.upsertEmbed`
with `embed_fp`/`model_id`, the `index_failures` record/clear, and the single
`embeddings_meta` write) all live in 003's per-dataset loop, **not** in the
batcher — see `## Cross-Spec Coordination` below ("land 003 first").

Batching is an **efficiency change only**: a dataset's stored vector MUST be
byte-identical whether produced in a batch of 1 or 64 (FR-006/SC-002). The plan
preserves the existing `composeEmbeddingText` output, the empty-text skip
(FR-007), and the per-dataset FTS upsert path (which stays *outside* batching,
FR-010). Returned vectors are mapped **positionally with a strict length check**
(FR-003); any mismatch fails the whole batch, which then falls back to a
**single-text retry** (FR-004). Forced single-text mode is a static capability
signal (`maxBatchSize === 1`, FR-005), distinct from the transient retry path.
Batches run **sequentially** with 429/5xx backoff (FR-009) and emit per-batch
progress (FR-010).

This feature refines FR-012 of `001-egov-data-sync` (the semantic index) without
changing the stored vector format (`dataset_embeddings` BLOB) or search
behavior. It composes with `003-incremental-indexing`: only the changed/selected
set of datasets is handed to the batcher, and `index_failures` is kept
**strictly separate** from 003's `index_state`.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, `noUncheckedIndexedAccess`, no `any` outside type guards) — unchanged from 001.
**Primary Dependencies**:
- Runtime: Bun 1.x (`bun:sqlite`, native `fetch`)
- Validation: Zod ^3.25.x — extends `EmbedderConfigSchema` in `src/config/schema.ts`
- Embedder abstraction: existing `src/index/embedder.ts` (`Embedder.embed(texts: string[]) => Promise<Float32Array[]>`); existing providers `src/index/embedders/{local-onnx,hosted-api}.ts`
- Store: `bun:sqlite`; existing `dataset_embeddings` BLOB table via `src/index/embeddings-store.ts`; new `index_failures` table
- Migrations: forward-only SQL under `migrations/`, applied by `src/store/migrate.ts` (numeric-prefix runner with checksum guard)
- Testing: `bun test` + coverage (`bun test --coverage --coverage-threshold=1.0`), per 001's Complexity Tracking (Vitest hangs under Bun with `bun:sqlite`)
- Lint/Format: Biome

**Storage**: SQLite at `store/danni.sqlite`. New table `index_failures(dataset_id PRIMARY KEY, reason, updated_at)`. Vector format unchanged (BLOB in `dataset_embeddings`); no on-disk blob-layout change.

**Testing**: `bun test` against in-memory / temp SQLite. The bundled deterministic stub embedder (`LocalOnnxEmbedder`, hash-based) is the CI embedder and is exercised **through the batched path**. A recording test-double embedder (counts invocations + texts-per-call, can be told to short/reorder/throw 429) drives SC-001/SC-002/SC-004. No live network in the dev loop.

**Target Platform**: Linux server (operator) + macOS dev — unchanged from 001.

**Project Type**: Single project — CLI + library. Lives under the existing `src/index/` pipeline stage.

**Performance Goals**:
- A full re-index of N datasets issues `⌈N / effectiveBatchSize⌉` embedder requests on the happy path (SC-001), not N.
- A real hosted embedder completes the full corpus within its per-request limits (SC-003) — sequential batches + 429/5xx backoff (FR-009).
- `bun test` unit suite stays < 5s (Principle VI): batching tests use the in-process stub, no sleeps (backoff delay is injectable and set to 0 in tests).

**Constraints**:
- 100% line + branch coverage (Principle VIII), enforced in CI.
- Output-equivalence: vector value MUST NOT depend on batch placement or sibling texts (FR-006/SC-002).
- Cyrillic preserved byte-exact through the composed text (Principle X) — `composeEmbeddingText` is reused unchanged.
- Sequential, one request in flight (FR-009) — no parallel fan-out at the embedder.
- `index_failures` kept separate from 003's `index_state` (cross-feature note).

**Scale/Scope**:
- ~12k active datasets (the spec's motivating number); effective batch size default 32, range 1–256.
- Memory envelope: at most `effectiveBatchSize` composed texts + their returned vectors held at once (batches processed sequentially, not all materialized) — addresses the spec edge case "throughput/memory when batch size is set very large".

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Evidence in this plan |
|---|-----------|--------|------------------------|
| I | AI-Native Development | ✅ PASS | No change to the authoritative read path or stored vector format; batching is an internal efficiency change. Run result is structured (`embedded`/`embedderRequests`/`skippedEmpty`/`failed` + `failures[]`); `index_failures` reasons are machine-readable. |
| II | Spec-Driven Development | ✅ PASS | spec.md (WHAT, with both clarification rounds binding) → this plan (HOW) → tasks.md (next) → tests (VALIDATION). |
| III | Contract-First API Design | ✅ PASS | No new MCP tool or portal endpoint (so no portal-api/dataset-schema entry). The new internal contracts — `BatchEmbedResult` shape and `index_failures` schema — are defined in data-model.md before code. The `Embedder` interface contract is unchanged (already `embed(texts[])`). |
| IV | Operational Excellence | ✅ PASS | Per-batch progress logs (batches done/total + running counts, FR-010) via the existing `withContext`/structured logger. Each not-embedded dataset is logged with a reason and persisted to `index_failures` for inspection. 429/5xx handled with backoff, not a crash (FR-009). |
| V | Simplicity & YAGNI | ✅ PASS | Reuses the existing `Embedder.embed(texts[])` capability (no new abstraction); reuses `composeEmbeddingText` and `upsertEmbedding` unchanged. One small table, two config fields, one retry wrapper. No queue, no parallelism, no new dependency. FTS path is explicitly left alone. |
| VI | Fast Feedback Loops | ✅ PASS | Backoff delay is injectable (0 in tests) so the suite stays < 5s; stub embedder needs no network. |
| VII | Type Safety & Validation | ✅ PASS | `batchSize` (1–256, default 32) and optional `maxBatchSize` Zod-validated at config load (fail-fast). `index_failures` rows are typed in the repo; positional length check (FR-003) is an explicit runtime assertion, not a silent assumption. |
| VIII | 100% Test Coverage & Endpoint Parity | ✅ PASS | New code paths (batch chunking, positional length-check failure, single-text retry, forced-single mode, 429/5xx backoff, empty-text exclusion, `index_failures` write/clear, progress emission) each get unit + integration coverage to 100% line+branch. No new portal endpoint ⇒ no parity-matrix entry; no new MCP tool. Output-equivalence is asserted by a batch-1-vs-64 byte-identical test (SC-002). |
| IX | Data Freshness & Sync Integrity | ✅ PASS | No freshness semantics touched; vectors are derived data. `index_failures` is cleared for a dataset once it embeds successfully (FR-008), so the persisted not-embedded set is never stale-positive. |
| X | Bulgarian-Locale Awareness | ✅ PASS | `composeEmbeddingText` (Cyrillic title/description/entity labels) is reused unchanged; tests include Cyrillic-text datasets in a batch and assert byte-identical vectors vs single-text. |
| XI | Respectful Crawling | ✅ N/A (consistent) | The embedder is not the portal crawler, but the *spirit* applies to the hosted embedder: sequential requests + exponential backoff on 429/5xx (FR-009) mirror Principle XI's etiquette for the embedding provider. |

**Result**: All gates PASS. No Complexity Tracking violations introduced (the 001 `bun test` deviation is inherited, not new).

## Project Structure

### Documentation (this feature)

```text
specs/002-batch-embedding/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (index_failures + config)
├── quickstart.md        # Phase 1 output
└── spec.md
```

No `contracts/` directory: this feature adds no MCP tool and no portal endpoint.
The single internal data contract (`index_failures` schema + run-result shape)
is specified in `data-model.md`.

### Source Code (repository root)

**Add:**

```text
migrations/
└── 004_index_failures.sql        # NEW — index_failures table (see data-model.md;
                                  #   number MUST be coordinated across 002/003/004)

src/store/repos/
└── index-failures.ts             # NEW — IndexFailuresRepo: record(datasetId, reason),
                                  #   clear(datasetId), list(): row[] (typed)

src/index/
└── batch-embed.ts                # NEW — embedBatch orchestration: chunk into
                                  #   effective-size batches, positional length-check
                                  #   (FR-003), single-text retry (FR-004), forced-single
                                  #   mode (FR-005), 429/5xx backoff wrapper (FR-009),
                                  #   per-batch progress callback (FR-010). Returns
                                  #   {embedded, embedderRequests, skippedEmpty, failed,
                                  #    failures[]}. PURE — writes NO DB state (no
                                  #   upsertEmbedding, no FTS, no index_failures, no
                                  #   embeddings_meta); persistence is the caller's job
                                  #   in run-index.ts (R2). Yields each {datasetId,vector}
                                  #   via a callback so the caller persists as it lands.
```

**Modify:**

```text
src/config/schema.ts              # EmbedderConfigSchema: add batchSize (int 1–256,
                                  #   default 32) and optional maxBatchSize (int 1–256).
                                  #   effectiveBatchSize = min(batchSize, maxBatchSize ?? ∞).

src/index/run-index.ts            # 003's merged loop, extended at the embed-the-set seam:
                                  #   (1) FTS upsert per dataset stays unchanged (outside
                                  #   batching, FR-010); (2) build each pair's text via the
                                  #   read-only composeEmbeddingText and collect non-empty
                                  #   {datasetId,text} pairs (tagged content-changed vs
                                  #   model-changed by 003's skip gate); (3) hand the set to
                                  #   the pure batch-embed.ts; (4) OWN ALL PERSISTENCE — as
                                  #   each {datasetId,vector} lands, call upsertEmbedding +
                                  #   003's IndexStateRepo.upsertEmbed(embed_fp/model_id),
                                  #   clear index_failures on success, record it on per-text
                                  #   failure; write embeddings_meta once (003's behavior).
                                  #   RunIndexResult extended with embedderRequests/
                                  #   skippedEmpty/failed + failures[] (embedded/vectorsUpdated
                                  #   come from merging BatchEmbedResult into 003's counters).

src/index/embedder.ts             # Embedder interface: add optional readonly maxBatchSize?
                                  #   capability signal (maxBatchSize === 1 ⇒ forced single,
                                  #   FR-005). embed() signature UNCHANGED.

src/index/embedders/hosted-api.ts # Surface maxBatchSize from constructor opts (provider
                                  #   may declare a hard cap). Existing length-check throw
                                  #   stays (feeds the FR-003 fail → FR-004 retry).

src/index/embedders/local-onnx.ts # Optional maxBatchSize passthrough (stub stays
                                  #   batch-capable by default so CI exercises real batching).

src/cli/index-cmd.ts              # buildEmbedder: pass batchSize/maxBatchSize from config
                                  #   into the batcher (not the provider ctor). Print the
                                  #   extended RunIndexResult (counts + failures) as JSON.
```

**Read-only (reused, NOT modified):**

```text
src/index/vec.ts                  # composeEmbeddingText reused read-only to build each
                                  #   pair's text (the trailing empty-text filter is the
                                  #   FR-007 guard). NOT modified by 002; persistence lives
                                  #   in run-index.ts, not in vec.ts.
src/index/embeddings-store.ts     # upsertEmbedding/getEmbeddingsMeta/setEmbeddingsMeta
                                  #   reused by run-index.ts's persistence step — unchanged.
```

**Test files (added by /speckit-tasks, listed here for structure):**

```text
tests/unit/index/batch-embed.test.ts          # chunking, length-check fail, single-text
                                               #   retry, forced-single, backoff, progress
tests/unit/index/run-index.test.ts            # EXTEND — new result fields, FTS-outside-batch,
                                               #   per-dataset persistence + index_failures
                                               #   record/clear, content-vs-model partition
tests/unit/index/embedders/local-onnx.test.ts  # EXTEND — maxBatchSize capability signal (T009)
tests/unit/index/embedders/hosted-api.test.ts  # EXTEND — maxBatchSize capability signal (T009)
tests/unit/store/repos/index-failures.test.ts # record/clear/list + migration shape
tests/unit/config/schema.test.ts              # EXTEND — batchSize bounds, maxBatchSize cap
tests/unit/cli/index-cmd.test.ts               # CLI batch-size wiring → runIndex; result JSON (T031)
tests/integration/index-batched.test.ts        # SC-001 (⌈N/b⌉ requests), SC-002 (byte-identical
                                               #   batch-1 vs batch-64), SC-003 (no dataset left
                                               #   un-embedded except empty-text), SC-004 (salvage
                                               #   on transient batch failure), Cyrillic batch
```

**Structure Decision**: The feature stays inside the existing `src/index/`
pipeline stage from 001 (organized by data-flow, not by layer). The new
`batch-embed.ts` is the single place that owns batch chunking, the positional
length-check, the single-text retry, forced-single mode, and the 429/5xx
backoff — and is **pure** (it writes no DB state). All persistence
(`upsertEmbedding` + 003's `IndexStateRepo.upsertEmbed`, `index_failures`
record/clear, the single `embeddings_meta` write) lives in 003's merged
`run-index.ts` loop at the embed-the-set seam, which also keeps
`composeEmbeddingText` and the entire FTS path untouched (`vec.ts` is reused
read-only, not modified). The new `index_failures` repo lives beside the other
`src/store/repos/*`.

## Implementation Phases

**Phase 0 — Research** (research.md): resolve the open design choices grounded in
the read code — positional-vs-keyed mapping (R1), where chunking/retry live
(R2), how forced-single is signaled (R3), the backoff wrapper placement and
testability (R4), `index_failures` shape & separation from 003 (R5), config
bounds & effective-size math (R6), output-equivalence guarantee (R7), and the
migration-numbering coordination (R8).

**Phase 1 — Design** (data-model.md + quickstart.md): finalize the
`index_failures` schema + migration, the extended `RunIndexResult` /
`BatchEmbedResult` shape, the config schema delta, and the end-to-end verify
commands + acceptance checks.

**Phase 2 — Implementation order** (for /speckit-tasks; TDD — tests first per
Principle VIII):

1. **Config**: extend `EmbedderConfigSchema` (batchSize default 32 / range 1–256,
   optional maxBatchSize). Tests: bounds, default, `min()` effective-size,
   cap-unset case. *(FR-002)*
2. **Migration + repo**: write `004_index_failures.sql` and `IndexFailuresRepo`
   (`record` = upsert by `dataset_id`, `clear`, `list`). Tests: idempotent
   record, clear-on-success, list. *(FR-008)*
3. **Embedder capability signal**: add optional `maxBatchSize` to the `Embedder`
   interface and the two providers; `embed()` signature unchanged. Tests: stub
   declares no cap; a `maxBatchSize: 1` stub forces single. *(FR-005)*
4. **Backoff wrapper**: a small `withEmbedRetry` (or inline in batch-embed) that
   retries 429/5xx with exponential backoff + jitter and an injectable
   delay/clock (0 in tests). Distinguish transient (retryable) from content
   (length-mismatch) failures. Tests: 429-then-200, exhausted budget. *(FR-009)*
5. **Batcher core** (`batch-embed.ts`): chunk non-empty pairs into
   `effectiveBatchSize` groups; sequentially embed each; positional length-check
   (FR-003) → on mismatch/error, single-text retry each pair (FR-004), recording
   only the individually-failing ones; forced-single when `maxBatchSize === 1`;
   emit per-batch progress; count `embedderRequests` per invocation (incl.
   retries). Tests: happy path request count, short response → salvage, reorder
   → fail-whole-batch → salvage, all-single forced mode, empty pairs excluded.
   *(FR-001, FR-003, FR-004, FR-005, FR-007, FR-010, SC-001, SC-004)*
6. **Persist results at the seam** in 003's merged `run-index.ts` loop (the pure
   batcher writes nothing): per successful vector call `upsertEmbedding`
   (unchanged) + 003's `IndexStateRepo.upsertEmbed(embed_fp/model_id)` + clear
   `index_failures`; per failing text record `index_failures` and add to the
   in-memory `failures[]`; write `embeddings_meta` once (003's behavior).
   Attribute each returned vector to 003's two counters by the pair's tag —
   `content-changed → embedded`, `model-changed → reembeddedDueToModelChange`
   (so `embedded` is the content-changed share, and `embedded +
   reembeddedDueToModelChange === BatchEmbedResult.embedded === vectorsUpdated`).
   Extend `RunIndexResult` (merge in `embedderRequests`/`skippedEmpty`/`failed`/
   `failures[]`). Tests: counts, persistence, clear-on-later-success, content-vs-
   model partition. *(FR-006, FR-008)*
7. **Wire CLI** (`index-cmd.ts`): pass config batch sizes into `runIndex` (the
   loop resolves `effectiveBatchSize`), **not** into the provider ctor; print the
   extended result JSON.
8. **Integration**: SC-001 (`⌈N/b⌉` requests via recording embedder), SC-002
   (byte-identical batch-1 vs batch-64, incl. Cyrillic), SC-003 (no dataset left
   un-embedded except empty-text), SC-004 (transient batch failure salvaged).

**Re-check Constitution after Phase 1**: no new violations expected; coverage
gate re-asserted in CI.

## Complexity Tracking

No new violations. The plan adds one table, two config fields, one batcher
module, and one retry wrapper — all justified by explicit FRs. The inherited
`bun test` (instead of Vitest) deviation is already recorded in 001's plan and
is not re-litigated here.

**Cross-feature coordination (not a violation, but a release-blocking risk):**
features 002, 003, and 004 each introduce a new migration from the same
`003_index` baseline. The canonical, collision-free assignment is recorded in
`## Cross-Spec Coordination` below (002 → `004_index_failures.sql`); the
`src/store/migrate.ts` duplicate-prefix guard (added by 003's T002) protects the
merge. See also data-model.md §5.

## Cross-Spec Coordination

> This section is part of the plan body (review 2026-06-04). Features 002/003/004
> were planned in parallel from the same `003_index` baseline and share
> infrastructure; the items below are the binding reconciliation. The two items
> 002 actually owns are the migration prefix and the 002 ↔ 003 run-index seam;
> the orphan-purge co-ownership is shared with 003.

- **Migration numbering (canonical, collision-free):** `004_index_failures.sql` (002), `005_index_state.sql` (003), `006_crawl_checkpoint.sql` (004). All are additive and order-independent; `src/store/migrate.ts` gains a duplicate-prefix guard (added by 003's T002; 002 relies on it).
- **run-index composition (002 ↔ 003): land 003 first.** 003 owns the per-dataset incremental loop (fingerprint check → FTS upsert + `content_fp`; embed + `embed_fp`/`model_id`, each in its own transaction; model identity read once at run start). 002 then batches **only the changed/selected set** 003 yields. The **pure** `batch-embed.ts` returns vectors; **003's loop owns all persistence** — it writes each vector with its `embed_fp`/`model_id` (`upsertEmbedding` + `IndexStateRepo.upsertEmbed`), records/clears `index_failures`, and writes `embeddings_meta` once, partitioning each returned vector into 003's `embedded` (content-changed) or `reembeddedDueToModelChange` (model-changed) counter. The two MUST share one merged `run-index` loop, not two competing rewrites; 002 changes only the *embed-the-set* call site, never 003's skip gate or the FTS leg.
- **Orphan purge co-ownership:** 003's every-run reconcile-vs-`listActive()` purge MUST also clear 002's `index_failures` rows for non-active datasets (one-line extension by 002, co-owned with 003's reconciler).
