-- 005_index_state.sql — per-dataset incremental-index fingerprint ledger.
-- Per data-model.md (003-incremental-indexing) §1.1 / §4. The durable skip ledger that
-- gates whether a dataset's FTS row and/or embedding need recomputing.
--
-- SEPARATE from embeddings_meta (002_curate_enrich.sql — global, single-row: the current
-- embedder identity) and SEPARATE from 002's transient index_failures (cleared on success).
-- content_fp / embed_fp / model_id are all nullable: NULL ⇒ that store has never been
-- written for this dataset ⇒ recompute. No secondary indexes: the PK serves all point
-- lookups and the orphan reconciler is a full scan.
CREATE TABLE index_state (
  dataset_id TEXT PRIMARY KEY REFERENCES datasets(id),
  content_fp TEXT,
  embed_fp   TEXT,
  model_id   TEXT,
  updated_at TEXT NOT NULL
);
