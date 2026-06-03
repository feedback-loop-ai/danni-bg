-- 002_curate_enrich.sql — curated artifacts, entities, links, translations.
-- Per data-model.md §1.6–§1.9, §1.11, §3.3.

CREATE TABLE curated_artifacts (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  resource_id TEXT NOT NULL REFERENCES resources(id),
  kind TEXT NOT NULL CHECK (kind IN ('tabular','json','geojson','xml','text','uncurated')),
  path TEXT NOT NULL,
  schema_json TEXT NOT NULL DEFAULT '{}',
  transform_rules_json TEXT NOT NULL DEFAULT '[]',
  encoding TEXT NOT NULL DEFAULT 'utf-8',
  uncurated_reason TEXT,
  curator_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_curated_at TEXT NOT NULL,
  UNIQUE (resource_id, curator_version)
);

CREATE INDEX idx_curated_artifacts_dataset ON curated_artifacts(dataset_id);
CREATE INDEX idx_curated_artifacts_kind ON curated_artifacts(kind);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('organization','geographic_unit','time_period','named_subject','tag','group')),
  canonical_label_bg TEXT NOT NULL,
  canonical_label_en TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_entities_kind ON entities(kind);

CREATE TABLE dataset_entities (
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  extractor TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence > 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  attached_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, entity_id, extractor)
);

CREATE INDEX idx_dataset_entities_entity ON dataset_entities(entity_id);

CREATE TABLE dataset_links (
  dataset_a_id TEXT NOT NULL REFERENCES datasets(id),
  dataset_b_id TEXT NOT NULL REFERENCES datasets(id),
  via_entity_id TEXT NOT NULL REFERENCES entities(id),
  heuristic TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence > 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (dataset_a_id, dataset_b_id, via_entity_id, heuristic),
  CHECK (dataset_a_id < dataset_b_id)
);

CREATE INDEX idx_dataset_links_b ON dataset_links(dataset_b_id);
CREATE INDEX idx_dataset_links_entity ON dataset_links(via_entity_id);

CREATE TABLE translations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('dataset_title','dataset_description','resource_description','entity_label')),
  subject_id TEXT NOT NULL,
  text_bg TEXT NOT NULL,
  text_en TEXT NOT NULL,
  translator TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  created_at TEXT NOT NULL,
  UNIQUE (subject_kind, subject_id, translator)
);

CREATE INDEX idx_translations_subject ON translations(subject_kind, subject_id);

CREATE TABLE embeddings_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  model_id TEXT,
  dimension INTEGER,
  updated_at TEXT
);

INSERT INTO embeddings_meta (id, model_id, dimension, updated_at) VALUES (1, NULL, NULL, NULL);
