# Feature Specification: Batched Embedding for the Vector Index

**Feature Branch**: `002-batch-embedding`  
**Created**: 2026-06-03  
**Status**: Draft  
**Input**: User description: "When we re-index the vectors after a full crawl, embedding one dataset at a time means ~12k separate embedder calls. Embed in batches so a real (hosted or local) embedder can index the whole corpus efficiently."

## Clarifications

### Session 2026-06-03

- Q: How is batch size configured and capped to a provider's maximum request size? → A: Add `enrichment.embedder.batchSize` (default) and an optional `enrichment.embedder.maxBatchSize`; effective size = `min(batchSize, maxBatchSize)`, with no cap applied when `maxBatchSize` is unset.
- Q: Default batch size and allowed bounds? → A: Default **32**, allowed range **1–256**.
- Q: How is "the embedder cannot accept multiple texts per request" detected for the single-text fall-back? → A: An explicit capability signal (`maxBatchSize === 1`) statically forces single-text mode; this is distinct from the transient-failure retry path.
- Q: On a failed or short batch, retry before recording datasets as not-embedded? → A: Retry the failed batch once as single-text requests; record as not-embedded only the individual texts that still fail.
- Q: How are per-dataset "not-embedded" outcomes and the run summary surfaced? → A: Extend the run result with `embedded` / `embedderRequests` / `skippedEmpty` / `failed` counts plus an in-memory `failures: {datasetId, reason}[]`, AND persist per-dataset not-embedded reasons for later inspection.

### Session 2026-06-03 (round 2)

- Q: How are returned vectors keyed back to datasets? → A: Positional mapping with a strict length check — assert the returned vector count equals the input count and map by index; any mismatch (reordering/dedup/short response) fails the whole batch, which then falls to the FR-004 single-text retry.
- Q: Where do the persisted not-embedded reasons live? → A: A new `index_failures` table (`dataset_id`, `reason`, `updated_at`), cleared for a dataset once it embeds successfully; kept separate from 003's `index_state`.
- Q: Does `embedderRequests` count single-text retry / forced-single requests? → A: Yes — it counts every embedder invocation, so SC-001's `⌈N/batchSize⌉` equality holds only on the happy path (no retries).
- Q: Are batches embedded sequentially with backoff? → A: Sequentially, one batch at a time, retrying 429/5xx with backoff before counting a content failure.
- Q: Progress reporting and FTS scope? → A: Emit per-batch progress (batches done/total + running counts); FTS row upserts stay per-dataset and are explicitly outside the batching path.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Index the whole corpus with a real embedder in one efficient pass (Priority: P1)

After crawling the full portal, an operator wires a real embedder (a hosted embedding API or a local model) and runs the indexer to (re)build the vector index over every dataset. The indexer sends datasets to the embedder in batches rather than one request per dataset, so the full re-index finishes in a fraction of the calls and wall-clock time.

**Why this priority**: One-request-per-dataset over ~12k datasets makes a real-embedder re-index slow and expensive (and may hit per-request rate limits or minimums). Batching is the difference between a re-index that is practical and one that is not. It is the prerequisite for the corpus-wide semantic index being usable at all.

**Independent Test**: Configure an embedder that records how many times it is invoked and how many texts each invocation carries. Index a store of N datasets. Verify the embedder was invoked ⌈N / batch_size⌉ times (not N times), that every dataset received exactly one vector, and that the resulting vectors are identical to those produced one-at-a-time for the same texts.

**Acceptance Scenarios**:

1. **Given** a store with 1,000 indexable datasets and a batch size of 64, **When** the index is built, **Then** the embedder is invoked 16 times, each carrying up to 64 texts, and all 1,000 datasets have a stored vector.
2. **Given** a batch in which the embedder returns one fewer vector than texts sent (or errors on that batch), **When** indexing continues, **Then** the affected datasets are recorded as not-embedded with a reason and the rest of the run completes successfully.
3. **Given** an embedder that does not support multi-text requests, **When** the index is built, **Then** the indexer falls back to a batch size of 1 and still indexes every dataset correctly.

---

### User Story 2 - Stable vector output regardless of batching (Priority: P2)

A consumer who relies on semantic search must get the same results whether the vectors were produced in batches or individually. Batching is an efficiency change only; it MUST NOT change which vector a dataset gets.

**Why this priority**: If batching changed vector values (e.g., via cross-text contamination or reordering), it would silently alter search ranking. Trust in the index depends on batching being output-equivalent.

**Independent Test**: Embed a fixed set of datasets twice — once with batch size 1, once with batch size 64 — using a deterministic embedder. Verify the stored vectors are byte-identical per dataset.

**Acceptance Scenarios**:

1. **Given** the same datasets and embedder, **When** indexed with batch size 1 and again with batch size 64, **Then** each dataset's stored vector is identical between the two runs.
2. **Given** a batch of mixed-length texts, **When** embedded together, **Then** each returned vector maps back to the correct dataset (order and keying preserved).

---

### Edge Cases

- What happens when a single dataset's composed embedding text is empty? (It MUST be excluded from a batch and left un-embedded, not padded into the batch.)
- What happens when the embedder returns vectors in a different order than the texts were sent? (The indexer MUST key results to datasets explicitly, never positionally-by-assumption, or MUST verify count and order.)
- How does the system handle the final partial batch (N not divisible by batch size)?
- How does the system behave when the configured batch size exceeds the embedder's maximum request size? (It MUST cap to the provider limit or surface a clear error.)
- What happens to throughput/memory when batch size is set very large?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The indexer MUST embed datasets in batches, issuing one embedder request per batch rather than one request per dataset.
- **FR-002**: The batch size MUST be configurable via `enrichment.embedder.batchSize` (default **32**, allowed range **1–256**) with an optional `enrichment.embedder.maxBatchSize` cap; the effective size MUST be `min(batchSize, maxBatchSize)`, with no cap applied when `maxBatchSize` is unset.
- **FR-003**: The indexer MUST map returned vectors to datasets positionally and MUST assert the returned vector count equals the input count; any length mismatch (reorder, dedup, or short response) MUST fail the whole batch (which then falls to the FR-004 single-text retry), never silently mis-assigning a vector.
- **FR-004**: A failed or short batch MUST NOT abort the run; the indexer MUST retry that batch once as single-text requests and MUST record as not-embedded (with a reason) only the individual texts that still fail; remaining batches MUST still be processed.
- **FR-005**: An embedder that cannot accept multiple texts per request MUST be detected via an explicit capability signal (`maxBatchSize === 1`), which statically forces single-text mode — distinct from the transient single-batch retry of FR-004.
- **FR-006**: Batching MUST be output-equivalent to single-text embedding: a dataset's vector MUST NOT depend on which batch it was placed in or on the other texts in that batch.
- **FR-007**: Datasets whose composed embedding text is empty MUST be excluded from batches and left un-embedded (consistent with current behavior).
- **FR-008**: The run result MUST report `embedded`, `embedderRequests` (counting every embedder invocation, including single-text retries), `skippedEmpty`, and `failed` counts plus an in-memory `failures: {datasetId, reason}[]`; per-dataset not-embedded reasons MUST also be persisted in a new `index_failures` table (`dataset_id`, `reason`, `updated_at`) and cleared for a dataset once it embeds successfully. (Composition note: `embedded` here is the count of datasets that got a vector this run. When this feature is merged into 003-incremental-indexing's run-index loop, that total is partitioned across 003's `embedded` (content-changed) and `reembeddedDueToModelChange` (model-changed) counters, so the merged `RunIndexResult.embedded` is the content-changed share — see data-model.md §4.2. The total persisted-vector count is `vectorsUpdated`.)
- **FR-009**: Batches MUST be embedded sequentially (one request in flight at a time); transient embedder responses (HTTP 429 / 5xx) MUST be retried with backoff before the batch is counted as a content failure, so a large re-index can complete within provider rate limits.
- **FR-010**: The indexer MUST emit per-batch progress (batches done / total and running counts) during the run; FTS row upserts MUST remain per-dataset and outside the batching path (only embeddings are batched).

### Key Entities

- **Embedding batch**: An ordered group of (dataset id, composed text) pairs sent to the embedder in a single request, with a maximum size and a guaranteed mapping from each input to its resulting vector.
- **Embedder configuration**: `enrichment.embedder.batchSize` (default 32, range 1–256) and optional `enrichment.embedder.maxBatchSize`; `maxBatchSize === 1` denotes an embedder with no multi-text support.
- **Not-embedded record**: Per-dataset `{datasetId, reason}` for datasets left un-embedded (empty text per FR-007, or individually-failing texts per FR-004), returned in the run result and persisted for inspection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the happy path (no retries), indexing N datasets with a batch-capable embedder issues ⌈N / batch_size⌉ embedder requests, verified to be far fewer than N for any batch size > 1; single-text retries add to `embedderRequests` only when batches fail.
- **SC-002**: Vectors produced with batch size > 1 are identical, per dataset, to vectors produced with batch size 1 for the same inputs and embedder.
- **SC-003**: A re-index of the full crawled corpus with a real hosted embedder completes without exceeding the embedder's per-request limits and with no dataset left un-embedded except those with empty embedding text. (Verification split: the **no-dataset-left-un-embedded-except-empty-text** clause is CI-verified against the deterministic stub/recording double — see tasks T030; the **within-per-request-limits** clause is operationally verified by construction — sequential, one request in flight, `effectiveBatchSize`-capped batches with 429/5xx backoff per FR-002/FR-009 — since exercising a live hosted embedder is out of the CI dev loop.)
- **SC-004**: A transient single-batch failure leaves un-embedded only the texts that also fail their single-text retry (a healthy provider salvages the whole batch); the run still completes and reports each failure with a reason.

## Assumptions

- Builds on the existing index pipeline (`danni index`) and the embedder abstraction whose interface already accepts multiple texts per call; this feature changes the caller to use that capability.
- A real embedder (hosted API or local model) is configured by the operator; the bundled deterministic stub remains available for CI and is also exercised through the batched path.
- Refines FR-012 of `001-egov-data-sync` (semantic index) without changing the stored vector format or the search behavior.
- Out of scope: choosing or bundling a specific embedding model; changing the similarity-search algorithm; the sqlite-vec virtual-table path.
