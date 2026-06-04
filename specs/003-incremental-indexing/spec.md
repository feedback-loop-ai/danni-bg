# Feature Specification: Incremental Indexing (Skip Unchanged Datasets)

**Feature Branch**: `003-incremental-indexing`  
**Created**: 2026-06-03  
**Status**: Implemented (shipped in 7659883; verified by the test suite, 2026-06-04)  
**Input**: User description: "The indexer re-embeds every active dataset on every run, even when nothing changed. Make indexing incremental so a routine re-index only re-embeds datasets whose content (or the embedder model) actually changed, while keeping a way to force a full rebuild."

## Clarifications

### Session 2026-06-03

- Q: Where/how is the per-dataset fingerprint stored, and does it track FTS and vector inputs separately? → A: A new `index_state` table (`dataset_id`, `content_fp`, `embed_fp`, `model_id`); the FTS input and the embedding input are fingerprinted separately so each can skip independently (a tags-only change refreshes the keyword entry without re-embedding).
- Q: Is incremental the default, and how do `config.index.incremental` and `--full` interact? → A: Incremental is the default; `config.index.incremental = false` disables it; CLI `--full` is a one-shot force-rebuild. Precedence: `--full` > `config.index.incremental` > default (true).
- Q: How is "changed" detected? → A: SHA-256 of the composed indexable text, compared against the stored fingerprint; an absent/unrecognized/legacy fingerprint is treated as changed.
- Q: Does a model-identity change rebuild FTS too, and how is it detected? → A: A change in embedder id/dimension (vs the global `embeddings_meta`) re-embeds vectors only; the model-independent FTS index is left untouched.
- Q: What purges no-longer-active datasets, and from which stores? → A: Every incremental run reconciles index keys against `datasets.listActive()` and purges non-active rows from `datasets_fts`, `dataset_embeddings`, and `index_state`.

### Session 2026-06-03 (round 2)

- Q: Exact serialization of content_fp vs embed_fp? → A: `content_fp` = SHA-256 over all FTS fields rendered as ordered `label=value\n` lines (empty fields included as empty values); `embed_fp` = SHA-256 over the exact `composeEmbeddingText` output. A tags-only change bumps `content_fp` but not `embed_fp`.
- Q: When is index_state written, and is it transactional? → A: `content_fp` is written only after the FTS upsert and `embed_fp` only after the vector is persisted, committed per-dataset in one transaction; a dataset is never marked done without its matching store row.
- Q: fp matches but the store row is missing? → A: Skip only when the fingerprint matches AND the corresponding store row is present; otherwise recompute.
- Q: `--full` and `--datasets` vs the orphan purge? → A: The purge is keyed strictly to "not in `listActive()`" and runs full-corpus even under `--datasets` (a subset limits only recompute, never purges active rows); `--full` rebuilds all stores in one transaction (not a bare FTS `DELETE`).
- Q: Model identity when `embeddings_meta` is NULL? → A: Re-embed is decided per dataset by comparing the current embedder id/dimension to that row's `index_state.model_id` (NULL or mismatch = changed); the global `embeddings_meta` identity is recorded once at run start, so the first run after a NULL meta behaves as model-changed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A routine re-index only touches what changed (Priority: P1)

After the initial full index, the operator runs the indexer on a schedule (e.g., after each daily re-sync). Most datasets are unchanged, so the indexer recomputes the keyword entry and the embedding only for datasets that are new or whose indexable content changed, and leaves the rest untouched. A re-index over an unchanged corpus does almost no work.

**Why this priority**: Re-embedding the whole corpus every run is wasteful and, with a real (especially hosted) embedder, slow and costly. Incremental indexing is what makes routine re-indexing affordable and is the day-2 counterpart to the one-time full build. The existing specification already promises incremental index updates (FR-015/SC-007 of `001-egov-data-sync`); today's implementation does not deliver them.

**Independent Test**: Build the full index. Without changing any dataset, run the indexer again and verify that zero datasets are re-embedded (all reported as skipped-unchanged). Then change one dataset's indexable content, re-run, and verify that exactly that one dataset is re-embedded.

**Acceptance Scenarios**:

1. **Given** a fully indexed store with no changes, **When** the indexer runs, **Then** it reports 0 datasets re-embedded and N skipped-unchanged, and all stored vectors are unchanged.
2. **Given** a dataset whose title, description, English translation, or attached entities changed since it was last indexed, **When** the indexer runs, **Then** that dataset (and only it) is re-embedded and its keyword entry refreshed.
3. **Given** a dataset newly added by a re-sync, **When** the indexer runs, **Then** it is embedded and added to the index without re-embedding any unchanged dataset.

---

### User Story 2 - Changing the embedder forces a full re-embed automatically (Priority: P1)

When the operator switches embedding models (or dimensions), the previously stored vectors are no longer comparable to new ones. The indexer detects the model change and re-embeds the entire corpus, so the vector space is never mixed across models.

**Why this priority**: Mixing vectors from two models silently corrupts similarity search. Incremental skipping MUST never skip on the basis of "already embedded" when the model that produced the old vector differs from the current one.

**Independent Test**: Fully index with model A. Switch to model B (different id/dimension). Run the indexer and verify every dataset is re-embedded and the recorded index model is now B.

**Acceptance Scenarios**:

1. **Given** a corpus indexed with model A, **When** the embedder is changed to model B and the indexer runs, **Then** all datasets are re-embedded and the recorded embedding-model identity becomes B.
2. **Given** the same embedder model across runs, **When** the indexer runs, **Then** model identity alone never triggers a re-embed.

---

### User Story 3 - Force a clean full rebuild on demand (Priority: P2)

The operator can request a complete rebuild that ignores the incremental fingerprints and re-embeds everything — used after a model upgrade, a curation change that affects many datasets, or to recover from a suspected stale index.

**Why this priority**: Incremental state can drift or a global change can invalidate everything; a force-rebuild escape hatch is required for trust and recovery. It is P2 because the incremental path covers the common case.

**Independent Test**: Run the indexer with the force-rebuild option and verify every dataset is re-embedded regardless of fingerprints, and the index is internally consistent afterward.

**Acceptance Scenarios**:

1. **Given** a fully indexed store, **When** the indexer runs in force-rebuild mode, **Then** every active dataset is re-embedded and the keyword index is rebuilt from scratch.

---

### Edge Cases

- A dataset removed/withdrawn since the last index — its stale keyword entry and vector MUST be purged so search never returns a dataset that is no longer active (the current full path leaves orphan embeddings behind).
- A dataset whose raw content is unchanged but whose enrichment changed (new entity extracted, translation added) — its embedding input changed and MUST trigger a re-embed.
- Two datasets with identical indexable content — each MUST be fingerprinted and skipped independently; sharing content MUST NOT cause one to be skipped because the other was indexed.
- A partially-completed previous index run (interrupted) — the next run MUST converge the index to correctness without requiring a manual full rebuild.
- The fingerprint scheme changes between releases — the indexer MUST treat unknown/legacy fingerprints as "changed" and re-embed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The indexer MUST skip recomputation for a dataset only when its fingerprint (SHA-256 of the composed input) AND embedding-model identity are unchanged since last indexed AND the corresponding store row (FTS row / embedding) is present; an absent or unrecognized fingerprint, or a missing store row, MUST force recomputation.
- **FR-002**: The indexer MUST recompute a dataset's keyword entry and embedding when any of its indexable inputs change, including title, description, machine translations, and attached entities.
- **FR-003**: The system MUST persist per-dataset index state in a new `index_state` table (`dataset_id`, `content_fp`, `embed_fp`, `model_id`). `content_fp` MUST be a SHA-256 over all FTS fields serialized as ordered `label=value` lines (empty fields included), and `embed_fp` a SHA-256 over the exact composed embedding input — so the keyword entry and the vector can be skipped independently and field-boundary moves are detected.
- **FR-004**: Re-embed MUST be decided per dataset by comparing the current embedder id/dimension to that dataset's `index_state.model_id` (NULL or mismatch = changed); the global `embeddings_meta` identity MUST be recorded at run start. A model change MUST re-embed vectors only; the model-independent FTS index MUST NOT be rebuilt by a model change.
- **FR-005**: The indexer MUST provide a force-rebuild mode (CLI `--full`) that re-embeds and rebuilds the entire index irrespective of fingerprints, replacing all three stores in a single transaction (not a bare FTS `DELETE`).
- **FR-006**: Every incremental run MUST reconcile index contents against the full active dataset set (`datasets.listActive()`) and purge entries for datasets that are no longer active (withdrawn, out-of-scope, or deleted) from all three stores — `datasets_fts`, `dataset_embeddings`, and `index_state` — without requiring a full rebuild; the purge MUST run full-corpus even under `--datasets` (a subset limits only which datasets are recomputed, never which active rows are purged).
- **FR-007**: Each run MUST report counts of datasets embedded, skipped-unchanged, re-embedded-due-to-model-change, and purged.
- **FR-008**: Incremental indexing MUST produce an index that is functionally identical to a full rebuild for the same end state (no missing, stale, or duplicated entries).
- **FR-009**: Incremental indexing MUST be the default behavior; `config.index.incremental = false` MUST disable it; the CLI `--full` flag MUST force a one-shot full rebuild. Precedence MUST be `--full` > `config.index.incremental` > default (true).
- **FR-010**: Per-dataset index state MUST be written transactionally and only after the corresponding work succeeds — `content_fp` after the FTS upsert, `embed_fp` after the vector is persisted — committed per dataset so an interrupted run can never record a fingerprint without its matching store row.

### Key Entities

- **Index fingerprint**: Per-dataset record (`index_state` row) holding a SHA-256 `content_fp` of the FTS input, a SHA-256 `embed_fp` of the embedding input, and the embedding-model identity (`model_id`). An absent or unrecognized fingerprint means the dataset is treated as changed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A re-index over an unchanged corpus re-embeds zero datasets (`embedded == 0`, the measurable proxy asserted in T011/T040: N point-lookups + N fingerprint computations, not N embedder calls), and therefore completes in a small fraction of the time of a full rebuild.
- **SC-002**: When exactly K of N datasets changed since the last index, exactly those K are re-embedded.
- **SC-003**: Switching embedding models causes 100% of active datasets to be re-embedded on the next run.
- **SC-004**: After a re-sync that withdrew a dataset, that dataset is absent from both keyword and semantic search results without a full rebuild.
- **SC-005**: For any sequence of incremental runs, the resulting index matches what a single force-rebuild on the same final state would produce.

## Assumptions

- Builds on the existing index pipeline (`danni index`, its keyword + vector stores, and the embedding-model metadata already recorded).
- Composes with `002-batch-embedding`: only the datasets selected for (re)embedding are batched.
- Delivers the incremental-update behavior already promised by FR-015 and SC-007 of `001-egov-data-sync`.
- Out of scope: incremental crawling/curation (covered elsewhere); changing the similarity-search algorithm or vector storage format.
