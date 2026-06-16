-- Entity-to-entity relations: the typed-predicate layer that turns the entity index into a formal
-- knowledge graph. Each row is a directed triple (subject) --predicate--> (object) between two
-- canonical entities, with provenance + confidence (mirrors dataset_entities' evidence model).
-- Dataset->entity edges remain in dataset_entities (typed by entity kind); this table is strictly
-- entity<->entity. The controlled predicate vocabulary lives in src/enrich/relations/vocabulary.ts.
CREATE TABLE entity_relations (
  subject_id TEXT NOT NULL REFERENCES entities(id),
  predicate TEXT NOT NULL,
  object_id TEXT NOT NULL REFERENCES entities(id),
  confidence REAL NOT NULL CHECK (confidence > 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (subject_id, predicate, object_id)
);

-- Forward traversal (subject -> ...) is served by the PK's leading column. These cover reverse
-- traversal (object's incoming edges, e.g. an oblast's child municipalities) and predicate scans.
CREATE INDEX idx_entity_relations_object ON entity_relations(object_id, predicate);
CREATE INDEX idx_entity_relations_predicate ON entity_relations(predicate);
