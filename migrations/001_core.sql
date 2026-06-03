-- 001_core.sql — core schema for danni-bg
-- Per data-model.md §1.1–§1.5, §1.10, §1.13–§1.16
-- (schema_migrations table is created by src/store/migrate.ts before any user migration runs.)

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title_bg TEXT NOT NULL,
  description_bg TEXT,
  source_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL
);

CREATE TABLE datasets (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title_bg TEXT NOT NULL,
  description_bg TEXT,
  publisher_id TEXT REFERENCES organizations(id),
  license_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  groups_json TEXT NOT NULL DEFAULT '[]',
  source_url TEXT NOT NULL,
  metadata_created TEXT,
  metadata_modified TEXT,
  first_seen_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  source_etag_or_hash TEXT,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active','withdrawn','out_of_scope')),
  lifecycle_changed_at TEXT,
  withdrawn_reason TEXT
);

CREATE INDEX idx_datasets_publisher ON datasets(publisher_id);
CREATE INDEX idx_datasets_lifecycle ON datasets(lifecycle_state);
CREATE INDEX idx_datasets_metadata_modified ON datasets(metadata_modified);
CREATE INDEX idx_datasets_last_synced ON datasets(last_synced_at);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  description_bg TEXT,
  declared_format TEXT,
  detected_content_type TEXT,
  detected_format TEXT,
  source_url TEXT NOT NULL,
  bytes INTEGER,
  sha256 TEXT,
  raw_path TEXT,
  etag TEXT,
  last_modified TEXT,
  first_seen_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  last_outcome TEXT NOT NULL CHECK (last_outcome IN ('success','failure','skipped_unchanged','withdrawn','out_of_scope')),
  last_failure_reason TEXT,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('active','withdrawn','out_of_scope'))
);

CREATE INDEX idx_resources_dataset ON resources(dataset_id);
CREATE INDEX idx_resources_sha256 ON resources(sha256);
CREATE INDEX idx_resources_last_synced ON resources(last_synced_at);
CREATE INDEX idx_resources_last_outcome ON resources(last_outcome);

CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('manual','scheduled')),
  scope_filter_json TEXT NOT NULL,
  summary_outcome TEXT CHECK (summary_outcome IN ('success','partial','failed') OR summary_outcome IS NULL),
  discovered_count INTEGER NOT NULL DEFAULT 0,
  captured_count INTEGER NOT NULL DEFAULT 0,
  skipped_unchanged_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  withdrawn_count INTEGER NOT NULL DEFAULT 0,
  out_of_scope_count INTEGER NOT NULL DEFAULT 0,
  manifest_path TEXT,
  notes TEXT
);

CREATE INDEX idx_sync_runs_started ON sync_runs(started_at);
CREATE INDEX idx_sync_runs_outcome ON sync_runs(summary_outcome);

CREATE TABLE sync_run_events (
  run_id TEXT NOT NULL REFERENCES sync_runs(id),
  dataset_id TEXT NOT NULL,
  resource_id TEXT NOT NULL DEFAULT '',
  event_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('captured','skipped_unchanged','failed','withdrawn','out_of_scope','discovered')),
  bytes INTEGER,
  sha256 TEXT,
  failure_reason TEXT,
  http_status INTEGER,
  PRIMARY KEY (run_id, dataset_id, resource_id)
);

CREATE INDEX idx_sync_run_events_run ON sync_run_events(run_id);

CREATE TABLE sync_runs_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_locked INTEGER NOT NULL CHECK (is_locked IN (0,1)),
  held_by_run_id TEXT,
  acquired_at TEXT
);

INSERT INTO sync_runs_lock (id, is_locked, held_by_run_id, acquired_at) VALUES (1, 0, NULL, NULL);

CREATE TABLE schedules (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cron_expression TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Sofia',
  on_overlap TEXT NOT NULL CHECK (on_overlap IN ('skip','queue')),
  failure_rate_threshold REAL NOT NULL DEFAULT 0.05,
  notifier TEXT NOT NULL DEFAULT 'stderr',
  notifier_config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

INSERT INTO schedules (id, cron_expression, timezone, on_overlap, failure_rate_threshold, notifier, notifier_config_json, updated_at)
VALUES (1, NULL, 'Europe/Sofia', 'skip', 0.05, 'stderr', '{}', '1970-01-01T00:00:00.000Z');

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES sync_runs(id),
  kind TEXT NOT NULL CHECK (kind IN ('run_failed','threshold_exceeded')),
  channel TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE INDEX idx_notifications_run ON notifications(run_id);

CREATE TABLE dataset_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  observed_at TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  run_id TEXT NOT NULL REFERENCES sync_runs(id)
);

CREATE INDEX idx_dataset_revisions_dataset ON dataset_revisions(dataset_id);
CREATE INDEX idx_dataset_revisions_run ON dataset_revisions(run_id);
