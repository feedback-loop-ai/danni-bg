# Data Model: Entity knowledge graph (typed entity↔entity relations)

**Feature**: 016-entity-knowledge-graph · **Status**: Implemented (PR #23)

## `entity_relations` (migration 007)

Directed, typed triples between two canonical `entities`. Each row is `(subject) --predicate--> (object)` with provenance + confidence, mirroring the evidence model of `dataset_entities`. This table is **entity↔entity only** — dataset→entity edges stay in `dataset_entities`.

```sql
CREATE TABLE entity_relations (
  subject_id    TEXT NOT NULL REFERENCES entities(id),
  predicate     TEXT NOT NULL,
  object_id     TEXT NOT NULL REFERENCES entities(id),
  confidence    REAL NOT NULL CHECK (confidence > 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  PRIMARY KEY (subject_id, predicate, object_id)
);

CREATE INDEX idx_entity_relations_object    ON entity_relations(object_id, predicate);
CREATE INDEX idx_entity_relations_predicate ON entity_relations(predicate);
```

| Column | Type | Notes |
|--------|------|-------|
| `subject_id` | TEXT, FK → `entities(id)` | the edge's source entity (e.g. a municipality) |
| `predicate` | TEXT | a value from the controlled vocabulary; currently always `part_of` |
| `object_id` | TEXT, FK → `entities(id)` | the edge's target entity (e.g. the parent oblast) |
| `confidence` | REAL, `0 < c ≤ 1` | provenance confidence; gazetteer-derived edges use `1` |
| `evidence_json` | TEXT (JSON), default `'{}'` | provenance record; currently `{"source":"gazetteer"}` |
| `created_at` | TEXT (ISO-8601) | assertion time |

**Keys & indexes**
- **PK `(subject_id, predicate, object_id)`** — a triple is unique; re-asserting refreshes it (idempotency). Its leading column also serves forward traversal (edges by subject).
- **`idx_entity_relations_object (object_id, predicate)`** — reverse traversal: an object's incoming edges (e.g. an oblast's child municipalities).
- **`idx_entity_relations_predicate (predicate)`** — predicate scans (e.g. all `part_of` edges).

**Invariants**
- Both endpoints must exist in `entities` (foreign keys); no relation between non-entities.
- `confidence` is constrained to `(0, 1]` by CHECK.
- Idempotent writes: `INSERT OR REPLACE` on the triple PK — re-asserting `(s, p, o)` updates confidence/evidence/created_at, never adds a duplicate row.

## Predicate vocabulary (`src/enrich/relations/vocabulary.ts`)

The closed, documented set of relation types. Keeping it closed is what makes the graph *formal* — every edge's meaning is defined here, not inferred.

```ts
export const ENTITY_PREDICATES = {
  /** subject (municipality) is administratively part of object (oblast). */
  PART_OF: 'part_of',
} as const;

export type EntityPredicate = (typeof ENTITY_PREDICATES)[keyof typeof ENTITY_PREDICATES];
export const ALL_ENTITY_PREDICATES: readonly EntityPredicate[] = Object.values(ENTITY_PREDICATES);
export function isEntityPredicate(value: string): value is EntityPredicate { /* set membership */ }
```

| Predicate | Direction | Meaning | Source |
|-----------|-----------|---------|--------|
| `part_of` | municipality → oblast | a municipality is administratively part of its parent oblast (`geo:bg-municipality-*` → `geo:bg-oblast-*`) | bundled gazetteer |

**Explicitly NOT here**: dataset→entity predicates (publishedBy / locatedIn / about / during / tagged / inGroup) — those live in `dataset_entities`, typed by the linked entity's `kind`. The two layers never duplicate.

## Repository — `EntityRelationsRepo` (`src/store/repos/entity-relations.ts`)

Typed read/write access to the relation graph.

| Method | Signature | Behaviour |
|--------|-----------|-----------|
| `upsert` | `(input: UpsertRelationInput): void` | `INSERT OR REPLACE` the triple; idempotent on `(subject, predicate, object)`. `evidence` defaults to `{}`, `createdAt` to `nowIso()`. |
| `bySubject` | `(subjectId, predicate?): EntityRelationRow[]` | outgoing edges, ordered; optional predicate filter. |
| `byObject` | `(objectId, predicate?): EntityRelationRow[]` | incoming edges (reverse traversal), ordered; optional predicate filter. |
| `count` | `(): number` | total edge count. |

```ts
interface UpsertRelationInput {
  subjectId: string;
  predicate: EntityPredicate;   // typed to the closed vocabulary
  objectId: string;
  confidence: number;
  evidence?: Record<string, unknown>;
  createdAt?: string;
}
```

`EntityRelationRow` is the raw stored shape: `{ subject_id, predicate, object_id, confidence, evidence_json, created_at }`.

## Materialisation — `registerEntityRelations` (`src/enrich/relations/register-relations.ts`)

Builds the `part_of` graph from the gazetteer over the entities currently present:

1. For each gazetteer `MUNICIPALITY`, skip it unless its entity exists in `entities` (present in the corpus).
2. Look up its parent `OBLAST` by `oblastId`; skip if unknown.
3. Upsert the oblast as an entity node (`kind: geographic_unit`, BG/EN labels, `attributes: { iso3166_2 }`) so the parent always exists.
4. Upsert the edge `municipality --part_of--> oblast`, `confidence: 1`, `evidence: { source: 'gazetteer' }`; increment `created`.

Returns `{ created }`. Global + idempotent — safe to run at the end of every curate (full + `--entities-only`). `run-curate.ts` calls it and surfaces `relationsCreated` in `RunCurateResult` and the `curate.completed` log.

## API view types (`apps/explorer-api/src/schemas.ts`)

Returned by `GET /api/entities/:id`, composed by `ReadBridge.entityGraph`.

```ts
interface EntityNode {           // a canonical entity, as a graph node
  entityId: string;
  kind: string;
  labelBg: string;
  labelEn: string | null;
}

interface EntityRelationEdge {   // a typed edge, far end resolved
  predicate: string;
  confidence: number;
  entity: EntityNode;
}

interface EntityGraphView {      // one entity's neighbourhood
  entity: EntityNode;
  out: EntityRelationEdge[];     // edges where this entity is the subject (e.g. → parent oblast)
  in: EntityRelationEdge[];      // edges where this entity is the object (e.g. ← child municipalities)
  datasetCount: number;          // datasets linked directly (from dataset_entities)
}
```

`ReadBridge.entityGraph(entityId)` returns `null` for an unknown entity (the route maps that to `404 not_found`). Each edge's far endpoint is resolved via `EntitiesRepo.get`; an unresolvable id falls back to a placeholder node `{ entityId: id, kind: 'unknown', labelBg: id, labelEn: null }` so no edge is silently dropped.
