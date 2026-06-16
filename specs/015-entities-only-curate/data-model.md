# Data Model — 015-entities-only-curate

**Date**: 2026-06-16
**Status**: Implemented
**Scope**: **No database schema change and no new migration.** This feature adds one boolean
option (`RunCurateOptions.entitiesOnly`) and one CLI flag (`danni curate --entities-only`) that
together gate which parts of the existing curate pipeline run. It writes to the **same tables** a
full curate writes — it simply skips two of them (`curated_artifacts`, `translations`) and
re-asserts the other three (`dataset_entities`, `dataset_links`, `entity_relations`). The
`RunCurateResult` shape is unchanged. There is no new published schema; the only external-surface
change is the documented CLI flag (`contracts/cli.md`).

> **Naming convention** (inherited from 001): `snake_case` SQL identifiers; `kebab-case` file
> paths; `camelCase` TypeScript fields. Timestamps are ISO-8601 UTC `TEXT`.

---

## 1. No schema change / no migration

The last applied migration is unchanged by this feature. Entities-only adds **no** `migrations/*.sql`
file. Confirmation that nothing in the data layer changed:

- No new table, column, or index. The entity tables (`entities`, `dataset_entities`,
  `dataset_links`, `migrations/002_curate_enrich.sql`), the relation table (`entity_relations`,
  `migrations/007_entity_relations.sql`), the curated-artifact table (`curated_artifacts`), and the
  translation table (`translations`) are all read/written as-is.
- The change is entirely in `src/curate/run-curate.ts` (which steps it runs) and `src/cli/curate.ts`
  (whether it builds a translator), plus a comment correction in
  `src/enrich/extractors/bg-admin-publisher.ts`.

---

## 2. What a full curate writes vs what entities-only writes

`runCurate` performs five kinds of writes. Entities-only **skips two** and **re-asserts three**.

| Table | Written by | Full curate | Entities-only | Why |
|---|---|---|---|---|
| `curated_artifacts` | `CuratedArtifactsRepo.upsert` (after `CuratorRegistry.curate` parses each captured resource) | ✅ writes | ⛔ **skipped** | The per-resource parse loop is the memory hog (≈20 GB RSS on the live mirror). Extraction does not read parsed artifacts, so the parse is unnecessary for an extractor/gazetteer change. The loop is short-circuited with `if (opts.entitiesOnly) break;` before any file is touched. |
| `translations` | `translateSubjects` (BG→EN title/description) | ✅ writes (if a translator is supplied) | ⛔ **skipped** | Translation needs the LAN-hosted translator; an extractor change does not change source BG text, so prior translations are still valid. Guarded by `opts.translator && !opts.entitiesOnly`; the CLI also declines to construct a translator. |
| `dataset_entities` | `registerEntities` (the registered extractors over dataset/resource **metadata**) | ✅ writes | ✅ **re-asserted** | This is the point of the mode — refresh dataset→entity edges after an extractor/gazetteer change. Reads metadata rows, not artifacts. |
| `dataset_links` | `linkAllSharedEntities` (over the touched entity ids) | ✅ writes | ✅ **re-asserted** | Cheap, operates over the entity graph, reconciles the recall's new entities into cross-dataset links. |
| `entity_relations` | `registerEntityRelations` (global, over all entities) | ✅ writes | ✅ **re-asserted** | Global + idempotent; materializes the part_of hierarchy over whatever entities are now present. |

### `RunCurateResult` (unchanged shape)

```ts
interface RunCurateResult {
  curated: number;            // entities-only: 0 (no parse loop)
  uncurated: number;          // entities-only: 0
  entitiesAttached: number;   // entities-only: > 0 (the refreshed edges)
  linksCreated: number;       // entities-only: links re-asserted over touched entities
  translationsWritten: number;// entities-only: 0 (translation skipped)
  relationsCreated: number;   // entities-only: relations re-asserted
}
```

Callers and the CLI's `JSON.stringify(result)` stdout line are unaffected (FR-007): entities-only
returns the same object, with the parse/translation-derived counts at 0.

---

## 3. The skipped tables (entities-only writes NONE of these)

### 3.1 `curated_artifacts` (`migrations/002_curate_enrich.sql`)

Per-resource parsed output: `id` PK, `dataset_id`, `resource_id`, `kind`
(`tabular|json|geojson|xml|text|uncurated`), `path`, `schema_json`, `transform_rules_json`,
`curator_version`, `UNIQUE (resource_id, curator_version)`. In entities-only mode the
resource-parse loop never executes, so **no new rows** are written for any dataset (FR-002,
SC-002). The test asserts `new CuratedArtifactsRepo(s.db).byDataset('d1').length === 0`.

### 3.2 `translations` (`migrations/002_curate_enrich.sql`)

BG→EN derived helpers: `subject_kind` (`dataset_title|dataset_description|…`), `subject_id`,
`text_bg`, `text_en`, `translator`, `confidence`, `UNIQUE (subject_kind, subject_id, translator)`.
**Skipped** in entities-only mode even when a translator is supplied (FR-003). The test passes a
`LocalMarianMtTranslator` and asserts `translationsWritten === 0`.

---

## 4. The re-asserted tables (entities-only writes these idempotently)

### 4.1 `dataset_entities` (`migrations/002_curate_enrich.sql`) — PK `(dataset_id, entity_id, extractor)`

Dataset→entity edges with provenance and confidence. Written by `registerEntities` via a PK-guarded
`INSERT OR REPLACE`. The PK **includes the extractor**, which is the load-bearing detail this
feature's comment correction documents:

| Aspect | Settled behavior |
|---|---|
| One row per extractor | A dataset that matches a place both in-content (`BgAdminGazetteerExtractor`) and via its publisher org (`BgAdminPublisherExtractor`) gets **two rows** — `(dataset, entity, bg_admin_gazetteer)` and `(dataset, entity, bg_admin_publisher)` — not one row overwritten by the other. |
| Confidence per extractor | In-content matches carry the stronger 0.95/0.75; the publisher signal carries the weaker 0.7/0.6. |
| Read-layer resolution | The read layer takes the **max confidence** per `(dataset, entity)`, so the stronger in-content match wins downstream. This is **not** an `INSERT OR REPLACE` "last writer wins" between extractors (the prior comments wrongly said so; they were corrected in `run-curate.ts` and `bg-admin-publisher.ts`). |
| Idempotency | Re-running entities-only re-asserts the same `(dataset, entity, extractor)` rows — no duplicates, no growth (FR-006). |

The test confirms the publisher-derived place is attached: a `Столична община` publisher yields
`geo:bg-municipality-stolichna` among the dataset's `geo:` entities (FR-005).

### 4.2 `dataset_links` (`migrations/002_curate_enrich.sql`) — PK `(dataset_a_id, dataset_b_id, via_entity_id, heuristic)`

Cross-dataset links via a shared entity, with `CHECK (dataset_a_id < dataset_b_id)`. Written by
`linkAllSharedEntities` over the entity ids touched in the run. PK-guarded → idempotent re-assert.

### 4.3 `entity_relations` (`migrations/007_entity_relations.sql`) — PK `(subject_id, predicate, object_id)`

Entity↔entity edges (e.g. municipality `part_of` oblast), materialized globally by
`registerEntityRelations` over all entities present. Idempotent by construction ("reconciles
regardless of which datasets ran").

---

## 5. Control-flow data dependency (why the parse is safe to skip)

```
per dataset:
  ┌─ phase 1: parse each captured resource → curated_artifacts   ← entities-only SKIPS (break)
  └─ phase 2: registerEntities(dataset + resource METADATA)      ← reads metadata rows, not phase-1 output
              ↓ touchedEntityIds
after loop:
  linkAllSharedEntities(touchedEntityIds) → dataset_links        ← over the entity graph
  registerEntityRelations(all entities)   → entity_relations     ← global, idempotent
  (translateSubjects → translations)                             ← entities-only SKIPS (guard)
```

Phase 2's inputs are the dataset/resource **metadata rows**, which are independent of phase 1's
on-disk parsed output. Skipping phase 1 therefore does not change phase 2's result — the formal
justification for the OOM-relieving `break` (research.md R2).

---

## 6. Validation rules

Consistent with data-model 001 (typed boundaries):

1. **No new persisted-record load and no new config**: every table read/written by this feature
   already had its contract defined by 001/002 (`migrations/007` for relations). Entities-only adds
   no new row interface.
2. **No published contract schema change**: the only external-surface change is the CLI flag,
   documented in `contracts/cli.md`. No JSON schema, MCP tool, or portal endpoint changes shape.
3. **Idempotency is enforced by the existing PKs**: `dataset_entities`,
   `dataset_links`, and `entity_relations` are all PK-guarded `INSERT OR REPLACE`, so the
   whole-catalog re-run cannot duplicate rows (FR-006, SC-004).
