-- 004_index_failures.sql — per-dataset "not-embedded" reasons for the vector
-- index (002-batch-embedding, FR-008). Current snapshot keyed by dataset_id;
-- cleared the moment a dataset embeds successfully. Kept SEPARATE from
-- 003-incremental-indexing's index_state and from the single-row global
-- embeddings_meta. PRIMARY KEY serves point lookups (no secondary index — the
-- table holds at most the count of currently-failing datasets).

CREATE TABLE index_failures (
  dataset_id TEXT PRIMARY KEY,
  reason     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
