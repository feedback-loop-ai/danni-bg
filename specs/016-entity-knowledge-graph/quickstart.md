# Quickstart: Entity knowledge graph (typed entity↔entity relations)

**Feature**: 016-entity-knowledge-graph · **Status**: Implemented (PR #23)

The knowledge-graph layer promotes the administrative hierarchy into queryable, typed triples. This shows how the `part_of` edges get materialised and how to read one entity's graph node.

## How `part_of` is materialised

The `part_of` edges (municipality → parent oblast) are derived from the bundled administrative gazetteer (`src/enrich/gazetteer/bg-admin.ts`) and asserted at the **end of curate** — both a full run and `--entities-only`:

```bash
# Materialise (or reconcile) the relation graph over the current corpus.
danni curate --entities-only
```

What `registerEntityRelations` does, for every municipality entity present in the corpus (i.e. linked to ≥1 dataset):
1. Upserts the parent oblast as an entity node (so the hierarchy is complete even if no dataset referenced the oblast directly).
2. Upserts the edge `municipality --part_of--> oblast` with `confidence: 1` and `evidence: { source: "gazetteer" }`.

It is **global and idempotent**: it reconciles the whole graph regardless of which datasets ran, and re-running produces zero net new edges. Curate reports the count:

```jsonc
// curate.completed log + RunCurateResult
{ "relationsCreated": 249, /* … */ }
```

On the live mirror this is **249 `part_of` edges** (one per municipality present in the corpus).

## Read one entity's graph node

`GET /api/entities/:id` returns the entity, its outgoing/incoming typed relations, and its direct dataset count.

### A municipality → its parent oblast (outgoing edge)

```bash
curl -s http://localhost:3000/api/entities/geo:bg-municipality-stolichna | jq
```
```json
{
  "entity": { "entityId": "geo:bg-municipality-stolichna", "kind": "geographic_unit", "labelBg": "Столична", "labelEn": null },
  "out": [
    { "predicate": "part_of", "confidence": 1,
      "entity": { "entityId": "geo:bg-oblast-sofia-grad", "kind": "geographic_unit", "labelBg": "София (град)", "labelEn": "Sofia (city)" } }
  ],
  "in": [],
  "datasetCount": 1
}
```

### An oblast → its child municipalities (incoming edges)

```bash
curl -s http://localhost:3000/api/entities/geo:bg-oblast-sofia-grad | jq
```
```json
{
  "entity": { "entityId": "geo:bg-oblast-sofia-grad", "kind": "geographic_unit", "labelBg": "София (град)", "labelEn": "Sofia (city)" },
  "out": [],
  "in": [
    { "predicate": "part_of", "confidence": 1,
      "entity": { "entityId": "geo:bg-municipality-stolichna", "kind": "geographic_unit", "labelBg": "Столична", "labelEn": null } }
  ],
  "datasetCount": 0
}
```

The same edge appears as `out` on the municipality and `in` on the oblast — that is reverse traversal served by the `(object_id, predicate)` index, no gazetteer JSON read.

### Unknown entity → 404

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/entities/nope   # 404
```
```json
{ "error": { "code": "not_found", "message": "unknown entity" } }
```

## Query the triples directly

If you read the store directly (`danni.sqlite`):

```sql
-- A municipality's parent oblast (forward traversal, served by the PK).
SELECT object_id FROM entity_relations
WHERE subject_id = 'geo:bg-municipality-stolichna' AND predicate = 'part_of';

-- An oblast's child municipalities (reverse traversal, served by idx_entity_relations_object).
SELECT subject_id FROM entity_relations
WHERE object_id = 'geo:bg-oblast-sofia-grad' AND predicate = 'part_of'
ORDER BY subject_id;

-- Total edges (expect 249 on the live mirror).
SELECT COUNT(*) FROM entity_relations;
```

Or via the repo (`src/store/repos/entity-relations.ts`):

```ts
const relations = new EntityRelationsRepo(db);
relations.bySubject('geo:bg-municipality-stolichna', 'part_of'); // → [{ object_id: 'geo:bg-oblast-sofia-grad', … }]
relations.byObject('geo:bg-oblast-sofia-grad', 'part_of');       // → all child municipalities
relations.count();                                               // → 249
```

## Run the tests

```bash
bun test tests/unit/store/repos/entity-relations.test.ts
bun test tests/unit/enrich/relations/register-relations.test.ts
bun test apps/explorer-api/tests/app.test.ts
```
