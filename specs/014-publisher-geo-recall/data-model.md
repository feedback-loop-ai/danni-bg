# Data Model: Publisher-derived geographic recall

**Feature**: `014-publisher-geo-recall` | **Date**: 2026-06-15 | **Status**: Implemented (PR #19)

This feature introduces **no new tables or columns**. It adds a new producer of
the existing `EntityCandidate` shape and a new provenance row in the existing
`dataset_entities` table. The model below documents the shapes involved and the
provenance / precedence semantics.

## 1. EntityCandidate (existing shape, new producer)

`BgAdminPublisherExtractor.extract()` returns `EntityCandidate[]`, the same type
emitted by every extractor (`src/enrich/extractor.ts`):

```ts
interface EntityCandidate {
  id: string;                 // gazetteer canonical id, e.g. "geo:bg-municipality-burgas"
  kind: 'organization' | 'geographic_unit' | 'time_period' | 'named_subject' | 'tag' | 'group';
  canonicalLabelBg: string;   // e.g. "Бургас"
  canonicalLabelEn?: string | null;
  attributes?: Record<string, unknown>;  // gazetteer attributes (oblastId, lauId, …)
  evidence: Record<string, unknown>;
  confidence: number;
}
```

Publisher-derived candidates are distinguished only by their **confidence** and
their **evidence**, never by a different type:

| Field | In-content (`bg_admin_gazetteer`) | Publisher (`bg_admin_publisher`) |
|-------|-----------------------------------|----------------------------------|
| `kind` | `geographic_unit` | `geographic_unit` |
| `confidence` (canonical) | `0.95` | `0.70` |
| `confidence` (alias) | `0.75` | `0.60` |
| `evidence` | `{ matchType, kind }` | `{ source: 'publisher', publisherId, matchType, kind }` |

The `evidence.source = 'publisher'` marker makes a publisher-derived placement
auditable and lets the read layer / UI explain *why* a dataset was placed in a
region.

> **FR-003 invariant, concretely.** The confidence values above are the HOW
> that realizes spec FR-003's invariant ("a publisher-derived placement's
> confidence is strictly below any in-content placement's confidence"): the
> publisher *alias* ceiling (`0.60`) sits strictly below the in-content *alias*
> floor (`0.75`), so no publisher match can outrank any in-content match for the
> same place.

## 2. Inputs

- **DatasetRow.publisher_id** (`string | null`): the publishing organisation id.
  When null, the extractor returns `[]`.
- **OrganizationRow.title_bg** (`string`): the authoritative Bulgarian
  organisation name, fed verbatim to `findGazetteerMatches()`. Resolved via
  `OrganizationsRepo.get(publisher_id)`; an unresolved id returns `[]`.
- **Gazetteer match** (`findGazetteerMatches(text)` → `{ id, labelBg, labelEn,
  attributes, matchType: 'canonical' | 'alias', kind }[]`): the existing
  Bulgarian administrative gazetteer (oblasts + municipalities), reused
  unchanged.

## 3. dataset_entities provenance row

Persisted by `EntitiesRepo.attach` via `INSERT OR REPLACE`:

```sql
-- dataset_entities (existing table)
-- PRIMARY KEY (dataset_id, entity_id, extractor)
INSERT OR REPLACE INTO dataset_entities
  (dataset_id, entity_id, extractor, confidence, evidence_json, attached_at)
VALUES (?, ?, ?, ?, ?, ?);
```

Key property: **the PK includes `extractor`.** A dataset placed in the same
administrative unit both ways therefore has *two* rows:

| dataset_id | entity_id | extractor | confidence | evidence_json |
|------------|-----------|-----------|-----------:|---------------|
| d42 | geo:bg-municipality-burgas | `bg_admin_gazetteer` | 0.95 | `{"matchType":"canonical","kind":"municipality"}` |
| d42 | geo:bg-municipality-burgas | `bg_admin_publisher` | 0.70 | `{"source":"publisher","publisherId":"org-burgas",…}` |

Both provenance rows are retained — no information is lost.

## 4. Read-side precedence (max confidence per (dataset, entity))

The map / region read layer dedupes membership with
`SELECT DISTINCT dataset_id FROM dataset_entities WHERE entity_id = ?`, so the
two rows above collapse to a single dataset under Бургас, and the effective
confidence for the `(dataset, entity)` pair is the **maximum** of the two
(0.95). Consequences:

- A dataset that names a place in its own content keeps full in-content
  confidence; the weaker publisher row never downgrades it (FR-004, SC-004).
- A dataset placed **only** via its publisher contributes at the publisher
  confidence (0.70 / 0.60) — still placed, just flagged as a weaker signal.

## 5. Composition with the oblast roll-up (feature 013)

A publisher-derived **municipality** entity is an ordinary `geographic_unit`
with an `oblastId` attribute. The relation registration step
(`registerEntityRelations`) materializes `municipality part_of oblast` over all
present municipality entities, so the publisher-derived municipality rolls up to
its parent oblast exactly like an in-content municipality (FR-006, SC-006). No
schema or relation-layer change was required.

## 6. State / lifecycle

- **Idempotent**: re-running curation re-derives the same candidates and
  re-`INSERT OR REPLACE`s the same `(dataset, entity, extractor)` rows.
- **Fail-closed**: missing `publisher_id`, unresolved organisation, or a
  publisher name that matches nothing all yield `[]` — no row, no error.
- **Additive across places**: if the publisher names a different place than the
  content, both placements are attached; a dataset may belong to more than one
  administrative unit.
