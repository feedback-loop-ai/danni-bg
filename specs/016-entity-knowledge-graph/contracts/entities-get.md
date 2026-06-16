# Contract: GET /api/entities/:id (entity knowledge-graph node)

**Feature**: 016-entity-knowledge-graph · **Service**: `apps/explorer-api` (Bun + Hono)

Contract-first per Constitution III. The endpoint has a contract test (`apps/explorer-api/tests/app.test.ts`) registered in the parity matrix before/with implementation (Constitution VIII). Responses are UTF-8 JSON; authoritative Bulgarian labels are returned verbatim (Constitution X). Errors use the shared envelope and codes defined in the 008 HTTP API contract:

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

Base path: `/api`.

---

## GET /api/entities/:entityId

Returns one entity's node in the knowledge graph: its canonical labels and kind, its outgoing and incoming typed entity↔entity relations (e.g. a municipality's parent oblast, an oblast's child municipalities), and how many datasets link to it directly. Backed by `ReadBridge.entityGraph`.

**Path**

| param | type | notes |
|-------|------|-------|
| `entityId` | string | canonical entity id, e.g. `geo:bg-municipality-stolichna`, `geo:bg-oblast-sofia-grad` |

**200** — `EntityGraphView`:

```json
{
  "entity": {
    "entityId": "geo:bg-municipality-stolichna",
    "kind": "geographic_unit",
    "labelBg": "Столична",
    "labelEn": null
  },
  "out": [
    {
      "predicate": "part_of",
      "confidence": 1,
      "entity": {
        "entityId": "geo:bg-oblast-sofia-grad",
        "kind": "geographic_unit",
        "labelBg": "София (град)",
        "labelEn": "Sofia (city)"
      }
    }
  ],
  "in": [],
  "datasetCount": 1
}
```

The reverse view — `GET /api/entities/geo:bg-oblast-sofia-grad` — returns the same edge as an **incoming** relation:

```json
{
  "entity": { "entityId": "geo:bg-oblast-sofia-grad", "kind": "geographic_unit", "labelBg": "София (град)", "labelEn": "Sofia (city)" },
  "out": [],
  "in": [
    { "predicate": "part_of", "confidence": 1, "entity": { "entityId": "geo:bg-municipality-stolichna", "kind": "geographic_unit", "labelBg": "Столична", "labelEn": null } }
  ],
  "datasetCount": 0
}
```

Field semantics:
- `entity` — the queried entity as a graph node.
- `out` — edges where the queried entity is the **subject** (e.g. municipality `part_of` oblast). Each edge carries `predicate`, `confidence`, and the resolved far-end `entity`.
- `in` — edges where the queried entity is the **object** (e.g. an oblast's child municipalities).
- `datasetCount` — number of datasets linked directly to this entity (from `dataset_entities`, the dataset→entity layer).
- An edge whose far endpoint is not a known entity resolves to a placeholder node `{ "kind": "unknown", "labelBg": "<id>", "labelEn": null }` rather than being dropped.

A known entity with no relations returns `200` with empty `out` and `in` arrays (not an error).

**404** — unknown entity id → `not_found`:

```json
{ "error": { "code": "not_found", "message": "unknown entity" } }
```

Schema: see [`entities-get.schema.json`](./entities-get.schema.json).
