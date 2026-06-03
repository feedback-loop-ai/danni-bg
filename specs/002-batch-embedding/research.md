# Phase 0 Research — 002-batch-embedding

**Date**: 2026-06-03
**Status**: Resolves all design unknowns so Phase 1 can proceed. Every decision
is grounded in the code read under `src/index/` and `src/config/` and honors the
binding clarifications in `spec.md` (both 2026-06-03 sessions).

Canonical form below: **Decision / Rationale / Alternatives considered**.

---

## R1 — Mapping returned vectors back to datasets

**Decision**: **Positional mapping with a strict length check.** Send the batch
as an ordered `string[]` of composed texts; assert `returned.length ===
input.length`; map result `i` to input pair `i`. Any mismatch (reorder, dedup,
short response) fails the **whole batch**, which then falls to the FR-004
single-text retry. This is exactly the clarified decision (round 2, Q1) and
FR-003.

**Rationale**: The existing `Embedder` contract
(`src/index/embedder.ts`: `embed(texts: string[]) => Promise<Float32Array[]>`)
is already positional, and `HostedApiEmbedder.embed`
(`src/index/embedders/hosted-api.ts:44`) already throws when
`data.length !== texts.length`. We make that guarantee explicit at the *caller*
so it holds for every provider, not just the hosted one. A length-equal response
is treated as in-order — providers that silently reorder would also have to
silently change the count to be undetectable, which the OpenAI-compatible shape
does not do (it returns one object per input).

**Alternatives considered**:
- *Key by an echoed id from the provider* — rejected. The `Embedder` interface
  takes plain strings, not id-tagged objects; adding ids would change the
  interface contract (Principle V) and most embedding APIs do not echo ids.
- *Sort/dedup defensively and re-expand* — rejected. Dedup would collapse two
  datasets with identical composed text into one vector and then mis-map on
  re-expansion; the spec explicitly forbids silent mis-assignment (FR-003).

---

## R2 — Where chunking, retry, and forced-single live

**Decision**: A new module `src/index/batch-embed.ts` owns: chunking
non-empty `{datasetId, text}` pairs into `effectiveBatchSize` groups, sequential
embedding, the positional length-check, the single-text retry, forced-single
mode, the 429/5xx backoff wrapper, and per-batch progress emission. It returns
`{embedded, embedderRequests, skippedEmpty, failed, failures: {datasetId,
reason}[]}`. `run-index.ts` stays a thin orchestrator; `composeEmbeddingText`,
`upsertEmbedding`, and the FTS path are untouched.

**Rationale**: Today `upsertEmbeddingFor` (`src/index/vec.ts:34`) is called once
per dataset from `run-index.ts:45` inside the FTS loop, doing `embed([text])` —
one request per dataset, the exact inefficiency this feature removes. Pulling the
embedding concern out of the per-dataset loop into one batcher (a) keeps the FTS
upsert per-dataset and outside batching (FR-010), and (b) gives a single,
fully-coverable home for the new control flow (Principle VIII). `vec.ts` keeps
`composeEmbeddingText` and the persistence helper; only the *driver* moves.

**Alternatives considered**:
- *Add batching inside `upsertEmbeddingFor`* — rejected. That function is
  per-dataset by shape; batching there would re-introduce a per-dataset request
  or require it to see the whole corpus, muddying responsibilities.
- *Batch inside each provider* — rejected. Then every provider re-implements
  chunking/retry/length-check; the caller is the right single owner (Principle V).

---

## R3 — Detecting "cannot accept multiple texts per request" (forced single)

**Decision**: An **explicit static capability signal**: add an optional
`readonly maxBatchSize?: number` to the `Embedder` interface. When a provider
declares `maxBatchSize === 1`, the batcher statically forces single-text mode
(one text per request for that provider) — **distinct** from the transient
single-text retry of FR-004. This is the clarified decision (Q3) and FR-005.

**Rationale**: The clarification is explicit that `maxBatchSize === 1` is a
*capability* signal, not a runtime symptom. Putting it on the interface keeps the
batcher provider-agnostic. The effective batch size is then
`min(config.batchSize, config.maxBatchSize ?? ∞, provider.maxBatchSize ?? ∞)` —
the config cap (R6) and the provider cap compose the same way (`min`). The
bundled stub (`LocalOnnxEmbedder`) declares no cap, so CI exercises *real*
multi-text batching, not the degenerate single path (spec Assumptions).

**Alternatives considered**:
- *Infer single-mode from a runtime error* — rejected. The spec separates the
  static capability from the transient retry; conflating them would force the
  batcher to send a doomed multi-text request first.
- *A separate boolean `supportsBatching`* — rejected. `maxBatchSize === 1`
  carries the same information and also composes into the `min()` cap, so one
  field suffices (Principle V).

---

## R4 — 429/5xx backoff: placement and testability

**Decision**: A thin **retry wrapper** (in `batch-embed.ts`, e.g.
`embedWithRetry`) wraps each embedder invocation and retries on transient
responses (HTTP 429 / 5xx) with **exponential backoff + jitter** up to a small
budget, before the unit is counted as a content failure. Batches run
**sequentially** (one request in flight). The delay function and clock are
**injectable** (set to 0 in tests) so the suite stays < 5s (Principle VI). A
transient error that exhausts the budget is treated like any other batch failure
and falls to the single-text retry (FR-004) / per-text recording. This is the
clarified decision (round 2, Q4) and FR-009.

**Rationale**: `HostedApiEmbedder.embed` currently throws a plain
`Error("Embedder ... returned HTTP <status>")` on `!res.ok`
(`src/index/embedders/hosted-api.ts:40`). To retry intelligently the batcher
needs to distinguish *transient* (429/5xx) from *content* (length-mismatch)
failures. We classify by inspecting the thrown error (the hosted provider's HTTP
status message) and/or a typed error; the wrapper only retries the transient
class. Sequential execution honors the clarified "one batch at a time" and keeps
us a good citizen to the embedding provider (Principle XI spirit). Output is
unaffected (R7).

**Alternatives considered**:
- *Parallel batches with a concurrency cap* — rejected. The clarification is
  explicit: sequential, one in flight (FR-009).
- *Retry inside each provider* — rejected. The batcher must also count
  `embedderRequests` per invocation including retries (round-2 Q3); centralizing
  the count and the retry in one place keeps SC-001's `⌈N/b⌉` arithmetic honest.
- *Real `sleep` in tests* — rejected. Violates the < 5s suite budget; the delay
  is injected as 0.

---

## R5 — Persisting "not-embedded" reasons (`index_failures`) and 003 separation

**Decision**: A **new `index_failures` table** keyed by `dataset_id`
(`reason TEXT`, `updated_at TEXT`), written via a new `IndexFailuresRepo`
(`src/store/repos/index-failures.ts`). On a per-text failure (empty text per
FR-007, or an individually-failing text per FR-004) the batcher records
`{datasetId, reason}` both **in-memory** (returned in `failures[]`) and
**persisted** (upsert into `index_failures`). On a dataset's **successful**
embed, its `index_failures` row is **cleared** (FR-008). This table is kept
**strictly separate** from 003's `index_state` (the cross-feature note). This is
the clarified decision (round 2, Q2) and FR-008.

**Rationale**: The run-result counts (`embedded`/`embedderRequests`/
`skippedEmpty`/`failed`) plus in-memory `failures[]` answer "what happened this
run"; the persisted table answers "which datasets are *currently* not embedded
and why" for later inspection — distinct lifetimes, hence a distinct table.
Keying by `dataset_id` (PRIMARY KEY, upsert) means the persisted set is a current
snapshot, never an append-only log, and clearing on success keeps it from going
stale-positive (Principle IX). `index_state` (003) tracks fingerprints for
*skipping*; `index_failures` (002) tracks *failures* for inspection — different
concerns, separate tables, no shared rows. The empty-text skip is counted in
`skippedEmpty` (not `failed`) but is *also* a legitimate persisted not-embedded
reason per FR-007/Key-Entities — see data-model.md for the exact `reason` taxonomy.

**Alternatives considered**:
- *Reuse / extend 003's `index_state` with a failure column* — rejected by the
  spec's explicit "kept separate from 003's `index_state`" (round-2 Q2 and the
  task's cross-feature note). Coupling them would make 003's skip logic depend on
  002's failure rows.
- *Append-only failure log* — rejected. "Cleared for a dataset once it embeds
  successfully" (FR-008) requires a current-snapshot keyed by dataset_id, not a
  history. (An audit history, if ever wanted, is a separate follow-up.)

---

## R6 — Config: batchSize, maxBatchSize, effective size

**Decision**: Extend `EmbedderConfigSchema` (`src/config/schema.ts:110`) with:
- `batchSize: z.number().int().min(1).max(256).default(32)`
- `maxBatchSize: z.number().int().min(1).max(256).nullable().optional()`

Effective batch size = `min(batchSize, maxBatchSize ?? Infinity,
provider.maxBatchSize ?? Infinity)`; **no cap applied when `maxBatchSize` is
unset** (clarification Q1, FR-002). Default 32, allowed range 1–256
(clarification Q2). Validated at config load (fail-fast, Principle VII).

**Rationale**: Mirrors the existing optional-field style in the same schema
(`endpointUrl`/`apiKeyEnv` are `.nullable().optional()`). The `min()` with an
`Infinity` sentinel for the unset cap is the literal clarified formula and also
composes the provider's hard cap (R3). Keeping both fields under
`enrichment.embedder` matches FR-002's exact config path and the existing
`EmbedderConfigSchema` location.

**Alternatives considered**:
- *A single `batchSize` with no cap field* — rejected. FR-002 explicitly
  requires the optional `maxBatchSize` cap and the `min()` semantics.
- *Put batch config under `index.*`* — rejected. The spec names
  `enrichment.embedder.batchSize` exactly (FR-002).
- *Clamp out-of-range silently* — rejected. Zod `.min(1).max(256)` rejects
  out-of-range at load (fail-fast), consistent with the constitution's
  "validate config at startup" rule.

---

## R7 — Output-equivalence guarantee (batch size MUST NOT change the vector)

**Decision**: Output-equivalence is guaranteed by **construction**: the composed
text per dataset (`composeEmbeddingText`, `src/index/vec.ts:18`) is identical
regardless of batch; positional mapping (R1) returns each text's own vector; and
no cross-text state is introduced. The bundled stub `hashEmbedding`
(`src/index/embedders/local-onnx.ts:33`) is a pure function of a single text, so
batch-1 and batch-64 are byte-identical by definition. A regression test
(SC-002) asserts byte-identical stored vectors between a batch-1 and a batch-64
run over the same datasets, including Cyrillic.

**Rationale**: The only way batching could change a vector is (a) a provider that
pads/contaminates across texts in a request, or (b) caller-side reordering. (a)
is the provider's contract violation, which the length-check + per-text retry
surfaces rather than hides; (b) is prevented by positional mapping with a strict
count assertion (FR-003/FR-006). The stub being a per-text pure function makes
the equivalence test deterministic in CI.

**Alternatives considered**:
- *Normalize/L2 each returned vector to mask provider drift* — rejected. That
  would *hide* a contaminating provider rather than fail it; and the stub already
  normalizes per text, so it adds nothing.

---

## R8 — Migration numbering coordination (002 / 003 / 004)

**Decision**: This feature's migration is named **`004_index_failures.sql`** with
`X` = the next free numeric prefix at merge time. Today the applied set is
`001_core`, `002_curate_enrich`, `003_index`
(`/home/.../danni-bg/migrations/`), so the next free prefix is **`004`**.
**HOWEVER**, features 002-batch-embedding (`index_failures`),
003-incremental-indexing (`index_state`), and 004-crawl-checkpoint-resume
(`crawl_checkpoint`) **each introduce a new migration and would all claim `004`**.
They MUST be assigned distinct, ascending prefixes in merge order; the
`src/store/migrate.ts` runner sorts by numeric prefix and **checksum-guards
already-applied files**, so two files sharing prefix `004` (or reusing a prefix
after it shipped) is a hard error. data-model.md records the proposed name and
flags this as a release-blocking coordination item.

**Rationale**: `discoverMigrations` (`src/store/migrate.ts:18`) keys applied
state by the integer prefix and rejects a checksum change on an already-applied
version. Forward-only numbering with no collisions is therefore a correctness
requirement, not a style preference. The three sibling features are being planned
in parallel from the same `003_index` baseline, so the collision is real and must
be called out now.

**Alternatives considered**:
- *Each feature hard-codes `004`* — rejected; guaranteed collision.
- *Timestamp-prefixed migrations* — rejected; the runner's regex is
  `^(\d+)_name\.sql$` and the existing files are zero-padded sequential
  (`001`/`002`/`003`); changing the scheme is out of scope for this feature.

---

## Summary: unknowns resolved

| Item | Resolution |
|------|-----------|
| Vector→dataset mapping | R1: positional + strict length check; mismatch fails whole batch → single-text retry |
| Where batching lives | R2: new `src/index/batch-embed.ts`; FTS + compose + persist unchanged |
| Forced single-text mode | R3: `Embedder.maxBatchSize === 1` static capability signal |
| 429/5xx handling | R4: sequential batches + injectable exponential backoff+jitter wrapper |
| Persisted failures | R5: new `index_failures(dataset_id, reason, updated_at)`, cleared on success, separate from 003 `index_state` |
| Config | R6: `batchSize` (1–256, default 32) + optional `maxBatchSize`; effective = `min(...)` |
| Output-equivalence | R7: guaranteed by construction; byte-identical batch-1-vs-64 test (SC-002) |
| Migration number | R8: `004_index_failures.sql`, next free is `004` but **must be coordinated with 003/004 specs** |

All Phase 0 unknowns resolved. Phase 1 may proceed.
