-- 006_crawl_checkpoint.sql — durable cross-session crawl checkpoint (004-crawl-checkpoint-resume)
-- Numbering note (plan.md Cross-Spec Coordination / research.md R9): canonical collision-free
-- prefix is 006 (002 claims 004_index_failures, 003 claims 005_index_state). Re-confirm
-- `ls migrations/` at merge time and renumber only if a sibling lands first.
-- Additive only — no ALTER/DROP on existing tables. Reuses datasets.source_etag_or_hash
-- (001_core.sql) for the egov dataset-level validator (no migration needed for it).

CREATE TABLE crawl_checkpoints (
  scope_hash TEXT PRIMARY KEY,
  scope_json TEXT NOT NULL,
  frozen_ids_json TEXT NOT NULL DEFAULT '[]',
  cursor_uri TEXT,
  total_datasets INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_id TEXT,
  reconciled_at TEXT
);
CREATE INDEX idx_crawl_checkpoints_status ON crawl_checkpoints(status);

CREATE TABLE crawl_checkpoint_datasets (
  scope_hash TEXT NOT NULL REFERENCES crawl_checkpoints(scope_hash) ON DELETE CASCADE,
  dataset_uri TEXT NOT NULL,
  validator TEXT,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','complete','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  resource_count INTEGER NOT NULL DEFAULT 0,
  captured_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_visited_at TEXT,
  last_failure_reason TEXT,
  PRIMARY KEY (scope_hash, dataset_uri)
);
CREATE INDEX idx_ccp_datasets_outcome ON crawl_checkpoint_datasets(scope_hash, outcome);

CREATE TABLE crawl_checkpoint_resources (
  scope_hash TEXT NOT NULL REFERENCES crawl_checkpoints(scope_hash) ON DELETE CASCADE,
  dataset_uri TEXT NOT NULL,
  resource_uri TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending','success','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  validator TEXT,
  captured_at TEXT,
  last_failure_reason TEXT,
  PRIMARY KEY (scope_hash, dataset_uri, resource_uri),
  FOREIGN KEY (scope_hash, dataset_uri)
    REFERENCES crawl_checkpoint_datasets(scope_hash, dataset_uri) ON DELETE CASCADE
);
