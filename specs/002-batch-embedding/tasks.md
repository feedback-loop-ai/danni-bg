---

description: "Task list for 002-batch-embedding"
---

# Tasks: Batched Embedding for the Vector Index

**Input**: Design documents from `/specs/002-batch-embedding/`
**Prerequisites**: plan.md (incl. `## Cross-Spec Coordination`), spec.md (incl. BOTH `### Session 2026-06-03` clarification blocks), research.md (R1–R8), data-model.md, quickstart.md

**Tests**: Tests are MANDATORY for this feature (Constitution Principles VII, VIII: 100% line + branch coverage, TDD — write failing tests FIRST). There is no new portal endpoint or published read contract here (`index_failures` is internal index bookkeeping and the run-result shape is an internal contract; plan.md §Constitution Check III), so there is no `contracts/` directory and no parity-matrix entry to add; instead the mandatory tests are: the **batch-1-vs-N byte-identical-vector** equivalence (SC-002, incl. Cyrillic, Principle X), the **⌈N/b⌉ request-count** happy path (SC-001), the **failed-batch retry-as-singles** salvage (SC-004), the **forced single-text** capability path (FR-005), the **429/5xx backoff** with injected `delay=0` (FR-009, Principle VI), and the **`index_failures` record + clear lifecycle** (FR-008). All run against the in-process deterministic stub + a recording test-double embedder; no live network.

## KEYSTONE dependency — 002 LAYERS ONTO 003 (read before starting)

This feature is **NOT the keystone**. 003-incremental-indexing is (003 `tasks.md` §KEYSTONE). **003 MUST land first.** Batching is layered onto the merged per-dataset run-index loop that 003 defines and operates **only over the changed/selected dataset set** 003's skip gate yields — it is an additive extension, **not a competing rewrite** of `src/index/run-index.ts`.

- **003 owns the merged loop.** Per 003's T020/T021/T026, `src/index/run-index.ts` is already the incremental loop: fingerprint check → FTS upsert + `content_fp`; decide the **changed/selected set of dataset ids needing a vector**; embed; write `embed_fp`/`model_id` per dataset; model identity read once at run start. 003 kept the *"decide the set"* step (its T020/T026 SEAM NOTE) deliberately separate from the *"embed the set"* step. **002 plugs into exactly that seam:** it replaces the one-at-a-time embed of that set with a batched embed of the same set, persisting each vector with its `embed_fp`/`model_id` as the batch returns. FTS upserts stay per-dataset and **outside** batching (FR-010).
- **Migration numbering (canonical, collision-free, plan.md §Cross-Spec Coordination)**: `004_index_failures.sql` (002 — this), `005_index_state.sql` (003), `006_crawl_checkpoint.sql` (004). All additive and order-independent. The branch number is **not** the migration number (research.md R8 / data-model §5). 003's T002 adds the duplicate-prefix guard to `src/store/migrate.ts`; 002 relies on it and does not re-add it.
- **Orphan purge co-ownership**: 003's every-run reconcile-vs-`listActive()` purge (003 T031, written set-difference-driven) MUST also clear 002's `index_failures` rows for non-active datasets once this table exists. 002 carries the wiring task that extends 003's reconciler by one store (T024) — it does not reimplement the purge.

## Implementation status

Not started. All tasks below are `[ ]`. **Phase 1 (the 003-landed gate) blocks everything.**

**Organization**: Tasks are grouped by user story (US1 = P1 efficient one-pass batched re-index, US2 = P2 output-equivalence regardless of batching). Setup, foundational, and polish phases carry no story label.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Different files, no dependencies on incomplete tasks in the same phase
- **[Story]**: User-story phase tasks only (US1, US2)
- Every task includes an exact file path
- **TDD**: every test task is written and made to FAIL before the implementation task it guards

## Path Conventions

Single-project layout (inherited from 001, plan.md §Project Structure):
- **Add**: `migrations/004_index_failures.sql`, `src/store/repos/index-failures.ts`, `src/index/batch-embed.ts`
- **Modify**: `src/config/schema.ts` (`EmbedderConfigSchema`), `src/index/embedder.ts` (`Embedder.maxBatchSize`), `src/index/embedders/{hosted-api,local-onnx}.ts`, `src/index/vec.ts`, `src/index/run-index.ts` (the 003-merged loop; `RunIndexResult`), `src/cli/index-cmd.ts`
- **Tests**: `tests/unit/index/batch-embed.test.ts`, `tests/unit/store/repos/index-failures.test.ts`, `tests/unit/index/run-index.test.ts` (extend 003's), `tests/unit/config/schema.test.ts`, `tests/integration/index-batched.test.ts`
- Read-only deps: `src/store/db.ts` (`withTransaction`), `src/store/repos/datasets.ts` (`DatasetsRepo.listActive`), `src/lib/time.ts` (`nowIso`), `src/index/embeddings-store.ts` (`ensureEmbeddingsTable`/`upsertEmbedding`/`getEmbeddingsMeta`/`setEmbeddingsMeta`), `src/index/vec.ts` (`composeEmbeddingText`), `src/store/migrate.ts` (duplicate-prefix guard added by 003 T002)

---

## Phase 1: Setup & the 003-landed gate (Shared Infrastructure)

**Purpose**: Confirm 003 has landed and the merged loop seam exists before any batching change. **No 002 task may start until T001 passes** — batching has nothing to plug into otherwise.

- [ ] T001 **DEPENDS-ON-003 GATE (blocking).** Verify 003-incremental-indexing is merged and its seam is present, because 002 extends 003's loop rather than rewriting it (plan.md §Cross-Spec Coordination; 003 tasks.md §KEYSTONE handoff). Confirm in the working tree: (a) `migrations/005_index_state.sql` exists and `bun run db:migrate` applies it on a clean checkout; (b) `src/index/index-state.ts` exports `IndexStateRepo` (`get`/`upsertContent`/`upsertEmbed`/`delete`/`listDatasetIds`) and the fingerprint helpers `contentFp`/`embedFp`/`modelIdOf`; (c) `src/index/run-index.ts` is the incremental skip-gate loop (a *changed/selected set of dataset ids needing a vector* is computed as a distinct step from embedding it — the 003 T020/T026 SEAM NOTE comment is present) and `RunIndexResult` already carries 003's `embedded`/`skippedUnchanged`/`reembeddedDueToModelChange`/`purged`; (d) `src/store/migrate.ts` has 003 T002's duplicate numeric-prefix guard (so `004`/`005`/`006` cannot collide). Run `bun test tests/unit/index/` + `bun run lint` for a green starting point. (No code change; pure pre-flight that anchors every seam citation below. If any of (a)–(d) is missing, STOP and land 003 first.)
- [ ] T002 [P] Confirm the baseline embedding touchpoints are as plan.md describes (so the cited symbols are real): `src/index/embedder.ts` declares `Embedder { id; dimension; embed(texts: string[]): Promise<Float32Array[]> }` (no `maxBatchSize` yet); `src/index/embedders/hosted-api.ts` `HostedApiEmbedder.embed` throws `Embedder ... returned HTTP <status>` on `!res.ok` and `returned N vectors, expected M` on a length mismatch; `src/index/embedders/local-onnx.ts` `LocalOnnxEmbedder` is a per-text pure hash stub with `embedFn` override; `src/index/vec.ts` exports `composeEmbeddingText(db, datasetId)` (the empty-text guard is the trailing `.filter((s) => s.length > 0)`); `src/index/embeddings-store.ts` exports `ensureEmbeddingsTable`/`upsertEmbedding`/`getEmbeddingsMeta`/`setEmbeddingsMeta`; `src/config/schema.ts` `EmbedderConfigSchema` is `.strict()` with `provider`/`modelId`/`endpointUrl`/`apiKeyEnv`. (No code change.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The config delta, the `index_failures` table + repo, the embedder capability signal, and the injectable backoff wrapper — the batcher (Phase 3) and persistence wiring (Phase 4) depend on all four. NO user-story work may start until this phase is complete.

**⚠️ CRITICAL**: These are the four primitives the batcher composes. Without the `maxBatchSize` signal there is no forced-single mode; without `index_failures` there is nowhere to persist a not-embedded reason; without the injectable delay seam the backoff tests cannot stay < 5s.

### Config delta (FR-002)

> **TDD — write the test (T003) FIRST and make it FAIL before T004.**

- [ ] T003 [P] Unit tests for the `EmbedderConfigSchema` delta in `tests/unit/config/schema.test.ts` (new file — config tests currently live in `loader.test.ts`; this file scopes the embedder schema): `batchSize` defaults to **32** when omitted; `batchSize` accepts `1` and `256`; `batchSize` of `0` and `257` and a non-integer each fail validation (fail-fast, Principle VII); `maxBatchSize` is optional/nullable and, when present, bounded `1–256`; an effective-size helper computes `min(batchSize, maxBatchSize ?? Infinity, providerCap ?? Infinity)` — assert no cap when `maxBatchSize` is unset, and that `maxBatchSize` (or a provider cap) of 1 yields effective 1 (data-model §2, R6) (guards T004).
- [ ] T004 [P] Extend `EmbedderConfigSchema` in `src/config/schema.ts`: add `batchSize: z.number().int().min(1).max(256).default(32)` and `maxBatchSize: z.number().int().min(1).max(256).nullable().optional()` to the existing `.strict()` object (keep `provider`/`modelId`/`endpointUrl`/`apiKeyEnv` unchanged). Export a pure `effectiveBatchSize(batchSize, configMax, providerMax)` = `Math.min(batchSize, configMax ?? Infinity, providerMax ?? Infinity)` helper next to the schema for reuse by the batcher (FR-002, data-model §2, R6). `DanniConfig` type re-infers automatically. (Guards T003.)

### Migration + IndexFailuresRepo (FR-008)

> **TDD — write the tests (T005, T006) FIRST and make them FAIL before T007, T008.**

- [ ] T005 [P] Unit tests for the `index_failures` migration shape in `tests/unit/store/repos/index-failures.test.ts`: applying migrations on a fresh in-memory DB creates `index_failures` with `dataset_id` as PRIMARY KEY, `reason` NOT NULL, `updated_at` NOT NULL (data-model §1) (guards T007).
- [ ] T006 [P] Unit tests for `IndexFailuresRepo` in `tests/unit/store/repos/index-failures.test.ts` (same file): `record(datasetId, reason)` upserts (a second `record` for the same `dataset_id` overwrites `reason` and bumps `updated_at`, never appends — current-snapshot semantics, data-model §1); `clear(datasetId)` deletes the row and is a no-op when absent; `list()` returns typed `{dataset_id, reason, updated_at}` rows ordered by `dataset_id`; an injected `now` is honored (mirrors `SyncRunEventsRepo` / `nowIso()` style) (guards T008).
- [ ] T007 [P] Author migration `migrations/004_index_failures.sql` creating `index_failures(dataset_id TEXT PRIMARY KEY, reason TEXT NOT NULL, updated_at TEXT NOT NULL)` exactly per data-model §5 — no secondary index (PK serves point lookups; the table holds at most the count of currently-failing datasets). Header comment: current snapshot keyed by `dataset_id`, cleared on successful embed (FR-008), kept **SEPARATE** from 003's `index_state` and from the single-row global `embeddings_meta`. (Prefix `004` is canonical per plan.md §Cross-Spec Coordination; the 003 T002 duplicate-prefix guard protects the merge.) (Guards T005.)
- [ ] T008 [P] Implement `src/store/repos/index-failures.ts`: `IndexFailureRow` typed interface (`dataset_id`, `reason: string`, `updated_at: string`) and `IndexFailuresRepo` (constructed with `Database`, mirroring the other `src/store/repos/*` classes): `record(datasetId, reason, now = nowIso())` → `INSERT OR REPLACE INTO index_failures (dataset_id, reason, updated_at) VALUES (?, ?, ?)`; `clear(datasetId)` → `DELETE FROM index_failures WHERE dataset_id = ?`; `list()` → `SELECT * FROM index_failures ORDER BY dataset_id`. Reuses `nowIso` (`src/lib/time.ts`). (Guards T006.)

### Embedder capability signal (FR-005)

> **TDD — write the test (T009) FIRST and make it FAIL before T010, T011.**

- [ ] T009 [P] Unit tests for the `maxBatchSize` capability signal in `tests/unit/index/embedders/local-onnx.test.ts` and `tests/unit/index/embedders/hosted-api.test.ts` (extend the existing per-embedder files): the stub `LocalOnnxEmbedder` leaves `maxBatchSize` **unset** (so CI exercises real multi-text batching, not the degenerate single path — spec Assumptions); a `LocalOnnxEmbedder` constructed with `maxBatchSize: 1` surfaces `maxBatchSize === 1`; `HostedApiEmbedder` surfaces a constructor-supplied `maxBatchSize` and leaves it unset otherwise; `embed()`'s signature/behavior is unchanged (guards T010, T011).
- [ ] T010 [P] Add the optional capability signal to the `Embedder` interface in `src/index/embedder.ts`: `readonly maxBatchSize?: number;` (doc-comment: `=== 1` statically forces single-text mode per FR-005 — a *capability*, distinct from the FR-004 transient retry). `embed(texts: string[]): Promise<Float32Array[]>` is UNCHANGED. (Guards the interface half of T009.)
- [ ] T011 [P] Surface `maxBatchSize` from both providers: in `src/index/embedders/hosted-api.ts` add an optional `maxBatchSize?: number` to `HostedApiEmbedderOptions` and assign `this.maxBatchSize` when supplied (a provider may declare a hard per-request cap); the existing length-check throw stays (it feeds the FR-003 fail → FR-004 retry). In `src/index/embedders/local-onnx.ts` add an optional `maxBatchSize?: number` passthrough to `LocalOnnxEmbedderOptions`, left unset by default. (Guards the provider half of T009.)

### Injectable backoff wrapper (FR-009)

> **TDD — write the test (T012) FIRST and make it FAIL before T013.**

- [ ] T012 [P] Unit tests for the transient-retry/backoff wrapper in `tests/unit/index/batch-embed.test.ts` (this file is shared with the batcher core tests T016+; write these in a dedicated `describe`): a 429-then-200 sequence succeeds after one retry; a 5xx-then-200 succeeds; a thrown **content** fault (length-mismatch / `returned N vectors` message) is classified **non-transient** and is NOT retried by the wrapper (it falls to the FR-004 path instead); a transient error that exhausts the budget rethrows a typed transient-exhausted error carrying the status; the injected `delay` is called with **growing** backoff arguments (exponential + jitter) and the test injects `delay = () => Promise.resolve()` (0-delay) so the suite stays < 5s (Principle VI). One embedder call is in flight at a time (FR-009) (guards T013).
- [ ] T013 [P] Implement the transient-retry wrapper in `src/index/batch-embed.ts` (same module as the batcher core; e.g. `embedWithRetry(embed, texts, {maxRetries, delay, classify})`): wrap a single embedder invocation, retry only **transient** responses (HTTP 429 / 5xx — classified by inspecting the thrown error's status/message from `HostedApiEmbedder`) with **exponential backoff + jitter** up to a small budget; treat a **content** fault (length-mismatch) as non-transient and rethrow immediately so the caller runs the FR-004 single-text retry; the `delay` function (and any clock) is an **injectable** seam defaulting to a real timer but set to a 0-delay resolver in tests (FR-009, R4). Throw a typed transient-exhausted error on budget exhaustion. **NOTE**: this task CREATES the `src/index/batch-embed.ts` module skeleton (the backoff/retry wrapper); the Phase-3 core task (T020) **EXTENDS the same file** with `embedBatch` — these are additive edits to one file across phases, not competing creations. (Guards T012.)

**Checkpoint**: `bun run db:migrate` applies `004_index_failures` on a clean checkout; `EmbedderConfigSchema` accepts `batchSize`/`maxBatchSize` and rejects out-of-range; `IndexFailuresRepo`, the `Embedder.maxBatchSize` signal, and the injectable backoff wrapper each pass 100% line + branch over their files. User-story implementation may now begin.

---

## Phase 3: User Story 1 — Index the whole corpus with a real embedder in one efficient pass (Priority: P1) 🎯 MVP

**Goal**: Replace the one-at-a-time embed of 003's *changed/selected set* with a batched embed of that same set. `src/index/batch-embed.ts` chunks the non-empty `{datasetId, text}` pairs into `effectiveBatchSize` groups, embeds them **sequentially** (one in flight, with the T013 backoff wrapper), maps returned vectors **positionally with a strict length check**, retries a failed/short batch **once as single-text requests**, forces single-text when `maxBatchSize === 1`, emits per-batch progress, and counts **every** invocation in `embedderRequests`. The 003 loop then persists each returned vector (`upsertEmbedding` + `embed_fp`/`model_id` via 003's `IndexStateRepo.upsertEmbed`) and clears/records `index_failures` per dataset. FTS upserts stay per-dataset and outside batching (FR-010).

**Independent Test** (quickstart §3, §5; spec US1 Independent Test): with a recording test-double embedder that counts invocations + texts-per-call, index N datasets at `batchSize` B → the embedder is invoked `⌈N/B⌉` times (not N), each call carries ≤ B texts, every dataset has exactly one stored vector, and a batch that short-returns/errors is salvaged via single-text retries while the run completes.

### Tests for User Story 1 (TDD — write FIRST, ensure they FAIL) ⚠️

- [ ] T014 [P] [US1] Unit tests for batch chunking + the happy-path request count in `tests/unit/index/batch-embed.test.ts`: with a recording stub, `N` non-empty pairs and `effectiveBatchSize = B` produce exactly `⌈N/B⌉` embedder invocations (incl. a final **partial batch** when `N % B !== 0`), each invocation carries ≤ B texts, and the result reports `embedded === N`, `embedderRequests === ⌈N/B⌉`, `failed === 0`, `failures: []` (SC-001) (guards the chunking/happy-path of T020).
- [ ] T015 [P] [US1] Unit tests for empty-text exclusion in `tests/unit/index/batch-embed.test.ts`: pairs whose `text` is empty/whitespace are **excluded** from every batch (never padded), counted in `skippedEmpty`, and recorded as `index_failures` reason `empty_text` (data-model §1.1; FR-007). The remaining non-empty pairs are still chunked into `⌈(N−empty)/B⌉` batches (guards the empty-skip term of T020).
- [ ] T016 [P] [US1] Unit tests for the positional length-check → fail-whole-batch → single-text retry path in `tests/unit/index/batch-embed.test.ts`: a stub that **short-returns** (one fewer vector than texts) on a batch fails the whole batch's length assertion (FR-003), which then retries each pair as a **single-text** request (FR-004); a stub that **reorders** but keeps the count is still caught because a reorder that preserves count is treated as in-order — assert the salvage path is driven by the count assertion and that on the single-text retry the genuinely-failing pairs (and only those) land in `failed` + `index_failures` reason `single_text_failed:<detail>`, while the rest are `embedded`; `embedderRequests` counts the original failed batch **plus** each single-text retry (round-2 Q3) (SC-004) (guards T020 salvage path).
- [ ] T017 [P] [US1] Unit tests for forced single-text mode in `tests/unit/index/batch-embed.test.ts`: an embedder declaring `maxBatchSize === 1` (config or provider cap → effective 1) statically issues **one text per request** for every pair — `embedderRequests === (N − skippedEmpty)` and each invocation carries exactly one text — and this path is exercised **without** any batch fault (distinct from the FR-004 transient retry, FR-005) (guards the forced-single branch of T020).
- [ ] T018 [P] [US1] Unit tests for the transient-batch-then-salvage budget interaction in `tests/unit/index/batch-embed.test.ts`: a batch whose embedder throws 429 until the backoff budget is exhausted falls to the single-text retry; a single text that *also* 429-exhausts is recorded `failed` with reason `transient_exhausted:<status>` (data-model §1.1); the run still completes and processes remaining batches (FR-004, FR-009, SC-004). Backoff `delay` injected as 0 (guards T020 + integrates T013).
- [ ] T019 [P] [US1] Unit tests for per-batch progress emission in `tests/unit/index/batch-embed.test.ts`: the batcher invokes an injected `onProgress({batchesDone, batchesTotal, embedded, embedderRequests, failed})` callback once per batch (done/total monotonic, running counts accumulate), `batchesTotal === ⌈(N − skippedEmpty)/B⌉` (FR-010) (guards the progress hook of T020).

### Implementation for User Story 1

- [ ] T020 [US1] Implement the batcher core `embedBatch` in `src/index/batch-embed.ts`. Signature accepts the non-empty `{datasetId, text}[]` (the caller pre-filters empty text, but the batcher also defends with the §1.1 `empty_text` skip), the `embedder`, the resolved `effectiveBatchSize` (from T004's `effectiveBatchSize(config.batchSize, config.maxBatchSize, embedder.maxBatchSize)`), and injectable `delay`/`onProgress` seams. Behavior: chunk into ≤ `effectiveBatchSize` groups (when `effectiveBatchSize === 1`, **statically** one text per request — FR-005); embed each group **sequentially** through the T013 backoff wrapper (FR-009); on a returned batch assert `returned.length === input.length` (FR-003) — on mismatch/error retry each pair in the group as a **single-text** request (FR-004), recording only the still-failing pairs; count **every** invocation (batches + single-text retries + forced-single) in `embedderRequests` (round-2 Q3); emit `onProgress` per batch (FR-010). Return `BatchEmbedResult { embedded, embedderRequests, skippedEmpty, failed, failures: {datasetId, reason}[] }` (data-model §4.1). Provide a callback/iterator so the caller can persist each `{datasetId, vector}` as it lands (so 003's loop writes the vector + `embed_fp`/`model_id` per dataset). **DO NOT** call `upsertEmbedding`, touch FTS, or write `index_failures` here — persistence is the caller's job (T022), keeping the batcher pure and fully coverable (R2). (Depends on T004, T010, T011, T013; guards T014–T019.)

**Checkpoint**: `embedBatch` over a recording stub issues `⌈N/B⌉` requests on the happy path, salvages a short/errored batch as singles, forces single-text under a `maxBatchSize===1` provider, excludes empty text, and emits per-batch progress — all at 100% line + branch over `src/index/batch-embed.ts`. The batcher is a pure function of its inputs (no DB writes yet).

---

## Phase 4: Wire the batcher into 003's merged loop (P1) — the seam

**Goal**: Plug `embedBatch` into 003's `run-index.ts` at the seam 003 left open (003 T020/T026 SEAM NOTE): collect the *changed/selected set of dataset ids needing a vector* that 003 already decides, build their non-empty `{datasetId, text}` pairs via `composeEmbeddingText`, hand the **set** to `embedBatch`, then persist each returned vector and update `index_failures`. This is shared P1 infrastructure both US1 and US2 rely on, so it is its own phase rather than nested under a single story.

> Composition rule (plan.md §Cross-Spec Coordination, "land 003 first"): 002 **extends** 003's per-dataset loop, it does **not** rewrite it. The FTS leg and 003's skip gate are untouched; only the *embed-the-set* step changes from one-at-a-time to batched. Each vector is persisted with its `embed_fp`/`model_id` exactly as 003's per-dataset path did, just driven by the batch result.

### Tests for the seam wiring (TDD — write FIRST, ensure they FAIL) ⚠️

- [ ] T021 [P] Unit tests for the extended `RunIndexResult` + FTS-outside-batch in `tests/unit/index/run-index.test.ts` (extend 003's file): a run over a content-changed set populates `embedded`/`embedderRequests`/`skippedEmpty`/`failed`/`failures[]` from the merged `BatchEmbedResult`; `vectorsUpdated === embedded + reembeddedDueToModelChange === BatchEmbedResult.embedded` (data-model §4.2 — the persisted-vector total is partitioned across 003's two counters by reason); FTS upserts still happen **per dataset** and their count is independent of batch size (FR-010); 003's existing `skippedUnchanged`/`reembeddedDueToModelChange`/`purged` fields are still populated (additive, not replaced) (guards T024, T025).
- [ ] T021b [P] Unit test for the content-vs-model partition of the batch result in `tests/unit/index/run-index.test.ts`: a **model-change-only** batched run (same content, switched embedder id/dimension so every pair is tagged `model-changed`) reports `reembeddedDueToModelChange:N`, `embedded:0`, and `ftsUpdated:0` — the batcher still issues `⌈N/B⌉` requests, but every returned vector is attributed to `reembeddedDueToModelChange` and none to `embedded` (consistent with 003's SC-003 / T026); a **content-only** change of the same set reports `embedded:N`, `reembeddedDueToModelChange:0`; a mixed set splits the two counters and their sum equals `vectorsUpdated` (FR-004, FR-006, data-model §4.2) (guards T024, T025).
- [ ] T022 [P] Unit tests for per-dataset persistence + the `index_failures` clear/record lifecycle in `tests/unit/index/run-index.test.ts`: each successfully embedded dataset gets `upsertEmbedding` called once, has its `index_state` `embed_fp`/`model_id` written (via 003's `IndexStateRepo.upsertEmbed`), AND has any prior `index_failures` row **cleared** (FR-008); a dataset that fails its single-text retry gets a `index_failures` row recorded with the §1.1 reason AND appears in the in-memory `failures[]`; a previously-failing dataset that now embeds successfully has its row cleared (record→clear lifecycle, FR-008, data-model §1) (guards T024).
- [ ] T023 [P] Unit tests for batched output-equivalence wiring in `tests/unit/index/run-index.test.ts`: running the merged loop with `effectiveBatchSize = 1` vs `= 64` over the same set persists byte-identical `dataset_embeddings` vectors per dataset (the loop adds no cross-text state — the equivalence is by construction, R7); positional mapping keys each returned vector to the correct dataset (FR-003/FR-006) (guards T024; SC-002 integration is T026).

### Implementation for the seam wiring

- [ ] T024 Wire `embedBatch` into 003's loop in `src/index/run-index.ts`. At the seam where 003 has decided the *set of dataset ids needing a vector*: (1) for each id in the set build its `text = composeEmbeddingText(db, id)` and collect non-empty `{datasetId, text}` pairs (empty ones counted as `skippedEmpty` + recorded `index_failures` `empty_text`) — **and tag each pair with the reason 003's skip gate assigned it: `content-changed` (changed/NULL `embed_fp`, T020) vs `model-changed` (`embed_fp` matches but `model_id` differs, T026)**; (2) resolve `effectiveBatchSize(config.batchSize, config.maxBatchSize, embedder.maxBatchSize)`; (3) call `embedBatch(pairs, embedder, effectiveBatchSize, {delay, onProgress})`; (4) as each `{datasetId, vector}` lands, persist it with the existing `upsertEmbedding` (unchanged) **and** 003's `IndexStateRepo.upsertEmbed(datasetId, embedFp(text), currentModelId)` in 003's per-dataset transaction, then `indexFailures.clear(datasetId)`, **and attribute the returned vector to 003's two counters by its tag — `content-changed` → `embedded`, `model-changed` → `reembeddedDueToModelChange` (each returned vector increments exactly one; their sum equals the count of successfully-persisted vectors)**; (5) for each `failures[]` entry call `indexFailures.record(datasetId, reason)`; (6) record the global `embeddings_meta` identity once at run start (already 003's behavior via `setEmbeddingsMeta`). The FTS leg + 003's skip gate are NOT touched (FR-010). Instantiate `IndexFailuresRepo`; import `embedBatch` and `effectiveBatchSize`. **SEAM (do not rewrite 003)**: replace only the *embed-the-set* call site; keep 003's "decide the set" step, its content-vs-model reason tagging, and per-dataset transaction ordering. (Depends on T008, T020; guards T021, T022, T023.)
- [ ] T025 Extend `RunIndexResult` in `src/index/run-index.ts` by **merging** the `BatchEmbedResult` accounting + `failures[]` into the existing (003-defined) result: add `embedderRequests`, `skippedEmpty`, `failed`, and `failures: {datasetId, reason}[]` alongside 003's `ftsUpdated`/`vectorsUpdated`/`embedded`/`skippedUnchanged`/`reembeddedDueToModelChange`/`purged` (data-model §4.2). **Reconcile the per-vector accounting (do NOT collapse 003's two counters):** the batcher returns per-vector results, but the caller (T024) partitions each returned vector into 003's `embedded` (content-changed) or `reembeddedDueToModelChange` (model-changed) by the pair's tag — so `embedded` is NOT the raw batch total; it is the content-changed share, and `embedded + reembeddedDueToModelChange === BatchEmbedResult.embedded === vectorsUpdated`. Keep one canonical `embedderRequests` (every invocation, T020). Extend the `index.completed` `log.info` to include `embedderRequests`/`skippedEmpty`/`failed`/`reembeddedDueToModelChange` (Principle IV). Initialize all new 002 fields to 0/empty. (Depends on T024; guards T021, T021b.)
- [ ] T026 Extend 003's orphan-purge reconciler in `src/index/run-index.ts` to clear `index_failures` for non-active datasets. 003's T031 wrote the reconciler set-difference-driven over (`datasets_fts`, `dataset_embeddings`, `index_state`); add `index_failures` as the 4th store so an `id ∉ activeIds` is also `indexFailures.clear(id)` (plan.md §Cross-Spec Coordination "Orphan purge co-ownership"; data-model §7). One-line extension by design — do NOT reimplement the purge. (Depends on T024; co-owned with 003 T031.)

**Checkpoint**: a batched re-index over 003's changed set persists each vector with its `embed_fp`/`model_id`, clears `index_failures` on success and records it on per-text failure, surfaces the four new counts in `RunIndexResult` and the completion log, and purges `index_failures` for withdrawn datasets — FTS and 003's skip gate unchanged. US1 modules at 100% line + branch. **MVP shippable here** (efficient batched re-index that salvages transient faults).

---

## Phase 5: User Story 2 — Stable vector output regardless of batching (Priority: P2) + CLI wiring

**Goal**: Prove (and CI-gate) that batching is an efficiency change only — a dataset's stored vector is byte-identical whether produced in a batch of 1 or 64, including Cyrillic (FR-006/SC-002, Principle X). Wire the config batch sizes through the CLI and print the extended result JSON.

**Independent Test** (quickstart §3, SC-002): embed a fixed set (incl. Cyrillic titles/descriptions) twice with a deterministic stub — once at `batchSize: 1`, once at `batchSize: 64` — and assert the `dataset_embeddings` BLOB is byte-identical per dataset; each returned vector maps back to the correct dataset (order/keying preserved).

### Tests for User Story 2 (TDD — write FIRST, ensure they FAIL) ⚠️

- [ ] T027 [P] [US2] Integration test SC-001 (request count) in `tests/integration/index-batched.test.ts`: with a recording embedder, full-index N fixture datasets at `batchSize` B → `embedderRequests === ⌈N/B⌉` (far fewer than N for B > 1), every active dataset with non-empty text has exactly one stored vector, and each invocation carried ≤ B texts (quickstart §SC-001) (guards US1 end-to-end through the CLI/loop).
- [ ] T028 [P] [US2] Integration test SC-002 (byte-identical batch-1 vs batch-N, incl. Cyrillic) in `tests/integration/index-batched.test.ts`: index the same fixture set (with Cyrillic-text datasets) twice with the same deterministic stub — once at `batchSize: 1`, once at `batchSize: 64` — and assert each dataset's `dataset_embeddings` BLOB is byte-identical between the two runs; capture a SHA-256 over `(dataset_id || vector)` for all rows under each batch size and assert the two digests match (FR-006, SC-002, Principle X) (guards the output-equivalence invariant).
- [ ] T029 [P] [US2] Integration test SC-004 (transient batch failure salvaged) in `tests/integration/index-batched.test.ts`: with a test embedder that short-returns/429s exactly one batch but succeeds on single-text retries, the run completes; `embedderRequests` includes the extra single-text retries; `failed` counts only the genuinely-failing texts; each failure appears in BOTH `failures[]` and the persisted `index_failures` (with a §1.1 reason); a healthy provider salvages the whole batch (`failed: 0`) (quickstart §SC-004, FR-004) (guards the salvage end-to-end).
- [ ] T030 [P] [US2] Integration test SC-003 (no dataset left un-embedded except empty-text) in `tests/integration/index-batched.test.ts`: after a full batched index over the fixture corpus with a batch-capable stub, every active dataset with non-empty composed text has a `dataset_embeddings` row, and the only `index_failures` rows are `empty_text` ones (run the quickstart §SC-003 SQL assertion: `missing = 0`) (guards SC-003).
- [ ] T031 [P] [US2] Unit tests for CLI batch-size wiring in `tests/unit/cli/index-cmd.test.ts` (new file): `run()` passes `config.enrichment.embedder.batchSize`/`maxBatchSize` from config into `runIndex` (not into the provider ctor); the extended `RunIndexResult` (the four 002 counts + `failures[]`) is serialized to stdout JSON; existing `--full`/`--datasets` parsing in `parseFlags` is unchanged (guards T032).

### Implementation for User Story 2

- [ ] T032 [US2] Wire config batch sizes through the CLI in `src/cli/index-cmd.ts`: pass `config.enrichment.embedder.batchSize` and `maxBatchSize` from the loaded config into `runIndex` (as a `batchSize`/`maxBatchSize` option, resolved to `effectiveBatchSize` inside the loop alongside `embedder.maxBatchSize`) — **not** into `buildEmbedder`'s provider constructors. Keep `process.stdout.write(JSON.stringify(result))` so the extended counts + `failures[]` flow through unchanged (research alignment with 003 T037). (Depends on T025, T032's `runIndex` option plumbed via T024; guards T031.)

**Checkpoint**: a `batchSize: 1` run and a `batchSize: 64` run over the same fixtures (incl. Cyrillic) yield byte-identical stored vectors (SC-002); the CLI threads config batch sizes into the loop and prints the four new counts; SC-001/SC-003/SC-004 integration tests are green. All user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Coverage, lint, and end-to-end validation spanning both stories.

- [ ] T033 [P] Drive line + branch coverage to 100% over `src/index/batch-embed.ts`, `src/store/repos/index-failures.ts`, and the touched edits in `src/config/schema.ts`, `src/index/{embedder.ts,run-index.ts,vec.ts,embedders/hosted-api.ts,embedders/local-onnx.ts}`, and `src/cli/index-cmd.ts` (`bun test --coverage`); add targeted unit tests for any uncovered branch (effective-size with both caps unset, exactly-divisible vs partial final batch, single-element set, all-empty set, budget-exhausted single-text retry) (Constitution VIII).
- [ ] T034 [P] Biome clean: `bun run lint` and `bun run format` over all changed files; zero violations (Constitution — Lint/Format gate).
- [ ] T035 [P] Quickstart validation: walk `specs/002-batch-embedding/quickstart.md` steps 1–5 + the SC-001/SC-002/SC-003/SC-004 acceptance checks end-to-end against a fixture store (migrate → configure batchSize → full batched index → inspect `index_failures` → subset re-index); confirm each reported JSON matches the expected counts (`embedderRequests === ⌈N/B⌉`, byte-identical vectors, `failed`/`failures[]` on the salvage path).
- [ ] T036 [P] Confirm the 003-composition seam is documented in code: a short comment at the embed-the-set call site in `src/index/run-index.ts` (the T024 SEAM) stating that 002 batches **only** the changed/selected set 003's loop yields, that FTS upserts stay per-dataset and outside batching (FR-010), that `index_failures` is cleared on success and recorded on per-text failure (FR-008), and that the orphan purge also clears `index_failures` (T026). No functional change — this guarantees the boundary between 003 (decide the set) and 002 (batch the set) stays legible.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup & 003 gate)** → T001 is a **hard blocking gate**: if 003 is not merged with its seam, STOP. T002 ∥ T001 (read-only confirmations).
- **Phase 2 (Foundational)** → BLOCKS all later phases. Four independent primitives: config (T003→T004), migration+repo (T005/T006→T007/T008), capability signal (T009→T010/T011), backoff wrapper (T012→T013). All four sub-groups are mutually `[P]` (different files); tests precede their implementations.
- **Phase 3 (US1 batcher core)** → after Phase 2. Tests T014–T019 written FIRST and fail; implementation T020 depends on T004/T010/T011/T013 and **extends** the `src/index/batch-embed.ts` file T013 created (additive, not a second creation). Its tests fan out `[P]` as distinct `describe` blocks in the one `batch-embed.test.ts`.
- **Phase 4 (seam wiring)** → after Phase 3 (needs `embedBatch`) AND requires 003's loop (T001 gate). Tests T021/T021b/T022/T023 first; T024 (the seam) → T025 (result merge) → T026 (purge extension). All edit the single `src/index/run-index.ts` → sequential among themselves.
- **Phase 5 (US2 + CLI)** → after Phase 4 (SC-002 equivalence + SC-001/003/004 run through the merged loop). Tests T027–T031 first; T032 (CLI) depends on T025.
- **Phase 6 (Polish)** → after both stories complete.

### User Story Dependencies

- **US1 (P1)** — the batcher core + its wiring into 003's loop (Phases 3–4). Foundation for everything. No dependency on US2.
- **US2 (P2)** — the output-equivalence guarantee + CLI wiring. Its SC-002 byte-identical test compares two runs of the US1-wired loop, so it runs after Phase 4. Independently testable (batch-1 vs batch-64 over a fixed fixture set).
- **Seam wiring (P1)** — shared infra both stories rely on; ordered after the batcher core (US1) and before US2's equivalence/CLI tests.

### Within Each User Story / Phase

- Tests (mandatory, Constitution VII/VIII) are written and made to FAIL before the implementation they guard.
- Config + `index_failures` repo + capability signal + backoff wrapper (Phase 2) before any batcher logic.
- Batcher core (pure, no DB) before the seam wiring (DB persistence) before US2's equivalence/CLI.
- CLI wiring after `runIndex`'s batch-size option exists.

### Parallel Opportunities

- **Phase 1**: T001 ∥ T002 (read-only).
- **Phase 2**: the four sub-groups (T003/T004 ∥ T005–T008 ∥ T009–T011 ∥ T012/T013) all touch different files — fully parallel; within each, the test precedes the impl.
- **Phase 3**: tests T014–T019 all parallel (distinct `describe` blocks in the one `batch-embed.test.ts`); implementation is the single T020, which **extends** the `batch-embed.ts` file T013 created with `embedBatch`.
- **Phase 4**: tests T021/T021b/T022/T023 parallel (shared `run-index.test.ts`, distinct blocks); implementation T024→T025→T026 **sequential** (same `run-index.ts`).
- **Phase 5**: integration tests T027–T030 share `index-batched.test.ts` (distinct `describe` blocks) and are parallel with T031 (new `index-cmd.test.ts`); implementation is the single T032.
- **Polish**: T033, T034, T035, T036 all parallel.

> Note: most Phase-4 implementation tasks edit the single file `src/index/run-index.ts` (003's merged loop) and are therefore **sequential among themselves** — by design, so 002 is an additive change to one seam, not a conflicting rewrite.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Write the failing tests first (TDD), in parallel across the four primitives:
Task: "T003 [P] Unit tests for EmbedderConfigSchema delta in tests/unit/config/schema.test.ts"
Task: "T005 [P] Unit tests for index_failures migration shape in tests/unit/store/repos/index-failures.test.ts"
Task: "T006 [P] Unit tests for IndexFailuresRepo in tests/unit/store/repos/index-failures.test.ts"
Task: "T009 [P] Unit tests for Embedder.maxBatchSize in tests/unit/index/embedders/{local-onnx,hosted-api}.test.ts"
Task: "T012 [P] Unit tests for the backoff wrapper in tests/unit/index/batch-embed.test.ts"

# Then implement in parallel where files differ:
Task: "T004 [P] EmbedderConfigSchema batchSize/maxBatchSize + effectiveBatchSize in src/config/schema.ts"
Task: "T007 [P] Migration migrations/004_index_failures.sql"
Task: "T008 [P] IndexFailuresRepo in src/store/repos/index-failures.ts"
Task: "T010 [P] Embedder.maxBatchSize in src/index/embedder.ts"
Task: "T011 [P] maxBatchSize passthrough in src/index/embedders/{hosted-api,local-onnx}.ts"
Task: "T013 [P] Injectable backoff wrapper in src/index/batch-embed.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 + seam)

1. Phase 1 (003 gate) → 2. Phase 2 (config + index_failures + capability signal + backoff) → 3. Phase 3 (batcher core) → 4. Phase 4 (wire into 003's loop).
2. **Stop and validate**: a full batched re-index issues `⌈N/B⌉` requests (not N), salvages a short/errored batch as singles, excludes empty text, persists each vector with its `embed_fp`/`model_id`, and clears/records `index_failures`. Coverage 100% over `batch-embed.ts` + `index-failures.ts` + the `run-index.ts` edits.
3. Shippable as the efficient corpus-wide re-index that makes a real (hosted/local) embedder practical (FR-001, SC-001, SC-003).

### Incremental Delivery

1. MVP (US1 + seam) → demo: re-index ~N datasets in `⌈N/B⌉` requests; watch per-batch progress and a salvaged transient fault.
2. Add US2 (equivalence + CLI) → demo: index at `batchSize: 1` and `batchSize: 64`, prove byte-identical vectors (incl. Cyrillic); the CLI prints the four new counts.
3. Polish (Phase 6) → coverage 100%, Biome clean, quickstart green, 003 seam documented in code.

### KEYSTONE handoff (002 ↔ 003)

- **Land 003 first** (T001 gate). 002 batches **only** the changed/selected set 003's loop yields, persisting each vector with its `embed_fp`/`model_id`; FTS stays per-dataset, outside batching. The two share **one** merged `run-index` loop — 002 changes only the *embed-the-set* call site (T024).
- 002's `index_failures` is kept strictly separate from 003's `index_state`; 003's set-difference orphan purge is extended by one line to clear `index_failures` for non-active datasets (T026).
- Migration prefix is canonical at `004_index_failures.sql`; the 003 T002 duplicate-prefix guard protects the merge.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the same phase. The Phase-4 `run-index.ts` edits are intentionally sequential.
- [Story] label maps each task to its user story (US1/US2); setup, foundational, seam-wiring, and polish phases carry no story label.
- Tests are MANDATORY and TDD (Constitution VII/VIII): write failing tests first, 100% line + branch coverage. There is no new portal endpoint or read contract, so no parity-matrix entry — the batch-1-vs-N equivalence, `⌈N/b⌉` count, salvage, forced-single, backoff, and record/clear-lifecycle tests are the contract guarantees here.
- Output-equivalence (FR-006/SC-002) is by construction: `composeEmbeddingText` is reused unchanged, positional mapping returns each text's own vector, and the batcher introduces no cross-text state — asserted byte-exact (incl. Cyrillic, Principle X) in T023 (unit) and T028 (integration).
- `embedderRequests` counts **every** invocation — batches, single-text retries, and forced-single calls (round-2 Q3) — so SC-001's `⌈N/B⌉` equality holds **only on the happy path** (no retries) (T014 vs T016/T018).
- RunIndexResult accounting (round-2): the batcher returns per-vector results; the caller (T024) tags each `{datasetId, text}` pair with its 003 skip-gate reason (`content-changed` vs `model-changed`) when building the set and attributes each returned vector to 003's `embedded` (content) or `reembeddedDueToModelChange` (model) accordingly. `embedded + reembeddedDueToModelChange === BatchEmbedResult.embedded === vectorsUpdated`; a model-change-only batched run reports `reembeddedDueToModelChange:N`, `embedded:0` (consistent with 003 SC-003) — asserted in T021b.
- Backoff is sequential, one request in flight (FR-009), with an injectable 0-delay seam so the suite stays < 5s (Principle VI) — T012/T013/T018.
- The batcher (`batch-embed.ts`) is pure: it never writes the DB. Persistence (`upsertEmbedding` + `IndexStateRepo.upsertEmbed` + `IndexFailuresRepo` record/clear) lives in 003's loop (T024), keeping the batcher fully coverable and the FTS path untouched.
- Commit after each task or logical group; stop at any checkpoint to run `bun test --coverage` and validate before proceeding.
