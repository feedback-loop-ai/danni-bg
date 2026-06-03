-- 003_index.sql — FTS5 + sqlite-vec virtual tables for keyword/semantic search.
-- Per data-model.md §3.1–§3.2.

CREATE VIRTUAL TABLE datasets_fts USING fts5(
  dataset_id UNINDEXED,
  title_bg,
  title_en,
  description_bg,
  description_en,
  publisher_label,
  tag_labels,
  group_labels,
  column_labels,
  entity_labels,
  tokenize = 'unicode61 remove_diacritics 0'
);

-- Vector index — created at runtime via sqlite-vec when the dimension is known.
-- We seed the meta row here; the actual virtual table is provisioned by the index orchestrator
-- (vec0 requires a constant column type that depends on the embedder dimension).
