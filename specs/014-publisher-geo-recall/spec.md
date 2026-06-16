# Feature Specification: Publisher-derived geographic recall (shrink the national bucket)

**Feature Branch**: `014-publisher-geo-recall`  
**Created**: 2026-06-15  
**Status**: Implemented  
**Input**: Backfilled (retrospective) specification for shipped work merged in PR #19 — "feat(enrich): infer region from publisher org (shrink national bucket)" (<https://github.com/feedback-loop-ai/danni-bg/pull/19>).

## Overview

The map explorer (feature 008) places each curated `data.egov.bg` dataset onto a Bulgarian administrative unit using geographic entities the curation pipeline extracts. Datasets that carry no geographic entity have nowhere to sit on the map: they collapse into a single non-georeferenced "national" grouping. On the live mirror that bucket was enormous — 56.7% of all datasets (6,721 of 11,854) had no geographic entity at all — which made the map look sparse and hid the fact that most of those datasets are, in reality, regional.

The cause was a scoping gap, not a data gap: the existing gazetteer extractor only scanned a dataset's *own* title, description, and resource names. It never looked at the **publisher organisation's name** — yet for a municipal or regional publisher the name itself names the place ("Община Бургас", "Регионално управление на образованието - Пловдив"). Measuring the live national bucket showed 73.6% of it (4,945 datasets) is published by an org whose name names a place.

This feature adds a second geographic extractor, `BgAdminPublisherExtractor`, that runs the existing gazetteer over the publisher organisation's name and attaches the matched administrative unit at a *lower* confidence than an in-content match (because publisher affiliation is a weaker placement signal than the dataset naming the place itself), tagged with `evidence.source = 'publisher'`. It composes with the oblast roll-up (feature 013) so a publisher-derived municipality also rolls up to its parent oblast. After re-curating the live mirror, the national bucket fell from 6,721 to 1,776 datasets (56.7% → 15.0%) and the georeferenced set grew from 5,133 to 10,078 (~85% of the mirror).

This spec describes *what* the recall change must guarantee and how its success is measured. It does not change how datasets are synced; it changes only what geographic entities curation attaches and at what confidence.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Regional datasets appear on their region instead of in the national bucket (Priority: P1)

A citizen opens the map explorer and clicks their own municipality (say, Бургас). Many datasets published by "Община Бургас" never name "Бургас" in their own title — they are titled generically ("Обществени поръчки 2024", "Регистър на земеделските земи"). Before this feature those datasets were invisible on the map: they fell into the undifferentiated national grouping. After it, because the publishing organisation's name names the place, those datasets are attached to the Бургас administrative unit and surface when the user clicks that region.

**Why this priority**: This is the entire point of the feature and the largest single recall win for the map. Recovering the place of regional datasets is what makes the map representative of the corpus rather than dominated by a single opaque "national" pile. It delivers standalone value: even with no further work, the map becomes dramatically more populated and trustworthy.

**Independent Test**: Curate a dataset that names no place in its own title/description/resources but is published by an organisation whose name names a municipality; confirm the dataset is attached to that municipality's geographic entity (and, via roll-up, to the parent oblast) and therefore appears under that region in the map, rather than only in the national grouping.

**Acceptance Scenarios**:

1. **Given** a dataset whose own title/description/resources name no place, published by an organisation named "Община Бургас", **When** curation runs entity extraction, **Then** the dataset is attached to the Бургас municipality geographic entity with evidence marking the source as the publisher.
2. **Given** the same dataset, **When** the map aggregates datasets per region, **Then** the dataset counts toward Бургас (and its parent oblast) rather than the national grouping.
3. **Given** a dataset published by "Регионално управление на образованието - Пловдив" that names no place itself, **When** curation runs, **Then** it is attached to the Пловдив administrative unit derived from the publisher name.

---

### User Story 2 - In-content placement still wins over publisher placement (Priority: P2)

A researcher trusts that when a dataset *itself* names a place, that explicit signal — not a weaker inference from who published it — governs how confident the system is about the placement. A dataset titled "Качество на въздуха в Пловдив" published by a Sofia-based ministry must be placed in Пловдив at full in-content confidence; the publisher signal must never override or dilute that.

**Why this priority**: Preserving the precedence of the stronger, explicit signal protects placement quality. Without it, adding a second weaker source could degrade the confidence of placements that were previously unambiguous. It depends on Story 1 (the publisher extractor must exist) but guards its correctness.

**Independent Test**: Curate a dataset that names a place in its own content *and* is published by an org naming a (different or same) place; confirm the in-content placement is recorded at the higher in-content confidence and that the publisher-derived placement never outranks it for the same (dataset, entity) pair.

**Acceptance Scenarios**:

1. **Given** a dataset that names a place in its own title, **When** both the publisher extractor and the in-content gazetteer extractor run, **Then** the in-content match is recorded at confidence 0.95 (canonical) / 0.75 (alias) and the publisher match at the lower 0.7 / 0.6.
2. **Given** both extractors attach the same (dataset, entity) pair, **When** the map reads region membership, **Then** the pair is counted once at the higher (in-content) confidence — the weaker publisher row never supersedes the stronger one.

---

### User Story 3 - Genuinely national datasets correctly stay national (Priority: P2)

A journalist relies on the national grouping continuing to mean "data that is genuinely national" — ministries, the National Statistical Institute (НСИ), the Court of Audit (Сметна палата), national parks. The publisher extractor must not invent a region for an organisation whose name names no place; those datasets must remain in the national grouping.

**Why this priority**: Recall is only valuable if it does not manufacture false placements. A national publisher whose name contains no administrative place name must produce no geographic attachment, keeping the national bucket meaningful (the residual ~1,776 datasets).

**Independent Test**: Curate a dataset published by "Министерство на финансите" (or НСИ, Сметна палата) that names no place itself; confirm no geographic entity is attached and the dataset stays in the national grouping.

**Acceptance Scenarios**:

1. **Given** a dataset published by an organisation whose name names no administrative place, **When** the publisher extractor runs, **Then** it attaches no geographic entity.
2. **Given** a dataset with no publisher, or whose publisher organisation cannot be resolved, **When** the publisher extractor runs, **Then** it attaches no geographic entity and raises no error.

---

### Edge Cases

- **No publisher**: A dataset whose `publisher_id` is absent yields no publisher-derived placement (returns nothing, no error).
- **Unknown publisher**: A `publisher_id` that does not resolve to a stored organisation yields nothing.
- **Publisher names no place**: A national publisher (ministry, НСИ, Сметна палата, national park) yields nothing; the dataset stays national.
- **Same place named both ways**: When a dataset both names a place and is published by an org naming that same place, both extractors attach the same (dataset, entity) pair; the read layer counts it once at the higher in-content confidence.
- **Publisher names a different place than the content**: Both placements are attached (each at its own confidence and source); placement is additive — the dataset can legitimately belong to more than one region.
- **Composition with oblast roll-up**: A publisher-derived *municipality* must also roll up to its parent oblast exactly as an in-content municipality does (feature 013).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The curation pipeline MUST attempt to derive a geographic administrative unit from the publishing organisation's name for every dataset, using the same Bulgarian administrative gazetteer used for in-content extraction.
- **FR-002**: A publisher-derived geographic match MUST be attached to the dataset as a geographic-unit entity, with evidence that records the source as the publisher and identifies the publisher organisation.
- **FR-003**: A publisher-derived match MUST be recorded at a lower confidence than an in-content match of the same match type — canonical publisher matches at 0.7 and alias publisher matches at 0.6, versus in-content 0.95 (canonical) / 0.75 (alias).
- **FR-004**: When a dataset matches the same administrative unit both in its own content and via its publisher, the in-content (higher) confidence MUST govern the placement the map reads; the publisher row MUST NOT supersede it.
- **FR-005**: The system MUST attach nothing when the dataset has no publisher, when the publisher organisation cannot be resolved, or when the publisher's name names no administrative place.
- **FR-006**: A publisher-derived municipality MUST compose with the oblast roll-up so that it also contributes to its parent oblast, identically to an in-content municipality.
- **FR-007**: Publisher-derived and in-content geographic attachments MUST be able to coexist for the same dataset and entity without one destroying the other (both provenance rows are retained, keyed by their extractor).
- **FR-008**: The change MUST preserve published Bulgarian organisation names exactly as stored; it reads `title_bg` and matches against the gazetteer without rewriting any authoritative field.
- **FR-009**: Materializing the recall on an existing mirror MUST be possible by re-running only entity extraction (without re-parsing captured resource files), so a gazetteer/extractor change can be applied cheaply to the whole corpus.

### Key Entities *(include if feature involves data)*

- **EntityCandidate (publisher-derived)**: A geographic-unit placement proposed for a dataset, carrying the matched administrative unit's canonical id and Bulgarian/English labels, a confidence (0.7 canonical / 0.6 alias), and evidence `{ source: 'publisher', publisherId, matchType, kind }`. Distinguished from an in-content candidate only by its lower confidence and `source = 'publisher'` evidence.
- **Dataset–Entity attachment (provenance row)**: The persisted link between a dataset and a geographic entity, keyed by `(dataset_id, entity_id, extractor)`. Because the key includes the extractor, a publisher-derived row (`bg_admin_publisher`) and an in-content row (`bg_admin_gazetteer`) for the same dataset and entity coexist; the read layer takes the maximum confidence per `(dataset, entity)` and counts the pair once.
- **Publisher organisation**: The `data.egov.bg` organisation that published the dataset (`title_bg`, id), referenced by the dataset's `publisher_id` and used as the placement signal source.
- **Administrative unit (oblast / municipality)**: The gazetteer geographic entity matched from the organisation name; municipalities roll up into their parent oblast (feature 013).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The non-georeferenced national grouping shrinks from 56.7% of the mirror (6,721 of 11,854 datasets) to 15.0% (1,776 datasets) after re-curating with publisher-derived recall.
- **SC-002**: Publisher-derived placement recovers 9,899 dataset placements that previously had no geographic entity (georeferenced datasets grow from 5,133 to 10,078, ~85% of the mirror).
- **SC-003**: At least 73% of datasets that previously fell into the national bucket because their own content named no place are recovered to a region (measured: 73.6%, 4,945 of 6,721, are published by an org whose name names a place).
- **SC-004**: A dataset that names a place in its own content retains its in-content placement confidence unchanged; no in-content placement is downgraded by the addition of publisher-derived placement.
- **SC-005**: A dataset published by an organisation whose name names no administrative place receives zero publisher-derived geographic attachments, so the residual national bucket continues to represent genuinely national data.
- **SC-006**: A publisher-derived municipality contributes to its parent oblast in the map's regional aggregation, identical to an in-content municipality.

## Assumptions

- The publishing organisation's name (`title_bg`) is a reliable place signal for municipal and regional publishers in Bulgaria — confirmed empirically: 73.6% of the national bucket is published by an org whose name names a place.
- The existing Bulgarian administrative gazetteer (oblasts + municipalities, with canonical/alias matching) is sufficient to extract the place from organisation names; no new gazetteer entries are required by this feature.
- Placement is additive: a dataset may legitimately belong to more than one administrative unit (e.g. content names one place, publisher names another); the map and read layer already handle multi-entity datasets.
- The oblast roll-up (feature 013) is already in place and applies to any municipality entity regardless of which extractor attached it.
- Materialization onto the live mirror is performed by re-running entity extraction only (`danni curate --entities-only`), which reads dataset/organisation metadata rather than re-parsing captured resource files. This depends on the entities-only curate capability (feature 015).
- The change is code-only at merge time; the live recall figures (SC-001 / SC-002) are realized after a re-curate of the mirror.
