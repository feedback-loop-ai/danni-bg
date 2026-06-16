# Feature Specification: Hierarchical region roll-up (municipality → oblast, via the part_of graph)

**Feature Branch**: `013-region-rollup`  
**Created**: 2026-06-16  
**Status**: Implemented (shipped via PRs #18, #24, #25)  
**Input**: User description: "An oblast's dataset count on the map should be the de-duplicated union of datasets linked directly to the oblast plus datasets linked to any of its municipalities — so the parts add up to the whole and a dataset placed on both is counted once, at its strongest confidence."

## Overview

The map data explorer (spec 008) renders a choropleth of Bulgaria weighted by how
many public datasets each administrative unit holds. Before this feature, every
region's count was a **flat, per-entity tally**: a dataset contributed to a region
only if one of its extracted geographic links named that exact entity. Because
municipality-level geo extraction has far higher recall than oblast-level extraction
(~5.1k municipality placements vs. ~1.9k oblast placements on the live mirror), the
municipalities of an oblast routinely held *more* datasets than the oblast itself — a
dataset tagged `Аксаково` never counted toward `Варна` unless the text *also* literally
named the province. The map lied: zooming from an oblast into its municipalities made the
data appear to grow, and the national/non-georeferenced bucket looked larger than it was.

This feature makes an oblast's count the **de-duplicated union** of (a) datasets linked
directly to the oblast and (b) datasets linked to any municipality that is administratively
part of that oblast. A dataset linked to both an oblast and one of its municipalities is
counted **once**, at its **strongest** placement confidence. The municipality→oblast parent
relation is read from the `part_of` knowledge graph (spec 016), not from a hand-maintained
crosswalk field. Municipality-level counts are unchanged (municipalities are leaves of the
hierarchy). This spec does not change geo extraction, recall, or the national bucket — only
how already-extracted placements are *bucketed* into region counts and detail lists.

**Magnitudes glossary** (so the numbers below don't appear to conflict): *total datasets* in the
mirror is ~11k; of those, *geo-linked datasets* (carrying at least one region placement) are ~5k;
those datasets carry ~5.1k *municipality placements* + ~1.9k *oblast placements* (a dataset can
carry several placements, which is why placements exceed geo-linked datasets). This feature
re-buckets those placements; it does not change how many exist.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An oblast's count includes its municipalities (Priority: P1)

A citizen viewing the national map sees each oblast shaded by its dataset volume. The shading
now reflects everything geolocated *inside* that province — datasets placed directly on the
oblast plus everything placed on any of its municipalities — so the province is never shown as
holding less data than the towns within it.

**Why this priority**: This is the core correctness fix and the entire point of the feature.
Without it the choropleth is actively misleading (parts exceed the whole). It delivers
standalone value: the national/oblast view becomes trustworthy even before drill-down lists
are reconciled.

**Independent Test**: Query the oblast-level region summary on the live mirror and confirm that
for every municipality, its dataset count is less than or equal to its parent oblast's count
(no municipality exceeds its parent), and that an oblast whose municipalities carry datasets has
a count at least as large as the largest of them.

**Acceptance Scenarios**:

1. **Given** a dataset linked only to the municipality `geo:bg-municipality-aksakovo`, **When** the oblast-level region summary is computed, **Then** that dataset is counted under its parent oblast `geo:bg-oblast-varna` (and not under any other oblast).
2. **Given** the live mirror, **When** oblast counts are computed, **Then** every municipality's dataset count is less than or equal to the count of the oblast it is part of.
3. **Given** an oblast with no direct links and no municipality links, **When** its summary is computed, **Then** its count is 0 and `hasData` is false (it is still emitted, so the map can render it as empty).
4. **Given** one dataset whose only geo link is an unknown id in the `geo:` namespace (e.g. `geo:bg-municipality-doesnotexist`, with no `part_of` parent) and another dataset whose only geo link is a non-`geo:` id (e.g. `topic:health`), **When** oblast counts are computed, **Then** neither dataset rolls into any oblast — the unknown-but-`geo:` id has no resolvable parent and the non-geo id is in neither region namespace, so both are ignored identically (neither lands on a region it does not belong to).

---

### User Story 2 - A dataset on both oblast and municipality is counted once (Priority: P1)

A dataset whose text names both `Варна` (the oblast) and `Аксаково` (a municipality within it)
carries two geo links that both roll up to the same oblast. The oblast's count must not
double-count it; it contributes exactly one to the oblast tally, recorded at the higher of its
two link confidences.

**Why this priority**: De-duplication is inseparable from the union semantics in US1 — a union
that double-counts overlapping placements produces inflated counts that again break the
"parts add up to the whole" invariant. It is independently testable from US1's roll-up direction.

**Independent Test**: Place one dataset on both an oblast and one of its municipalities at
differing confidences, compute the oblast summary, and confirm the dataset adds exactly 1 to the
count and the oblast's reported `maxConfidence` is the stronger of the two link confidences.

**Acceptance Scenarios**:

1. **Given** one dataset linked to both `geo:bg-oblast-varna` (confidence 0.6) and `geo:bg-municipality-aksakovo` (confidence 0.9, parent = Varna), **When** the Varna oblast summary is computed, **Then** the dataset contributes a count of 1 (not 2).
2. **Given** the same dataset, **When** the summary is computed, **Then** the oblast's `maxConfidence` reflects the strongest contributing placement (0.9), not the weaker direct link.
3. **Given** two distinct datasets each linked to a different municipality of the same oblast, **When** the summary is computed, **Then** the oblast count is 2 (distinct datasets are not collapsed).

---

### User Story 3 - The oblast detail list matches its count and drills down (Priority: P2)

A user clicks an oblast and opens its dataset list. The list contains exactly the datasets the
choropleth counted — the oblast's direct datasets plus all of its municipalities' datasets,
each appearing once — and the count shown equals the list length. The summary also carries the
oblast's own entity id for municipalities so the map can drive drill-down (which municipality
belongs to which oblast) without a second lookup.

**Why this priority**: It makes the count *auditable* — a user can see the datasets behind the
number — and powers the map's zoom-to-children interaction. It depends on US1/US2 semantics
existing but adds the list-parity and drill-down value on top.

**Independent Test**: Request an oblast's region detail and confirm the returned dataset count
equals the returned list length, that each municipality dataset appears once under its parent
oblast, and that a municipality summary carries its parent oblast entity id.

**Acceptance Scenarios**:

1. **Given** the oblast detail endpoint for `geo:bg-oblast-varna`, **When** it is requested, **Then** the returned `datasetCount` equals the total number of distinct datasets in the returned list and equals the choropleth count for that oblast.
2. **Given** a dataset linked to a municipality of Varna, **When** the Varna detail list is requested, **Then** that dataset appears in the list exactly once, recorded at the strongest confidence among its rolling-up links.
3. **Given** a municipality region summary, **When** it is emitted, **Then** it carries the parent oblast entity id (`oblastEntityId`), sourced from the `part_of` graph, so the map can associate the municipality with its parent.

---

### User Story 4 - The hierarchy source of truth is the part_of graph (Priority: P3)

The municipality→oblast parent mapping that drives the roll-up is read from the `part_of`
knowledge graph (spec 016) at runtime, not from a duplicated field on the gazetteer crosswalk.
The crosswalk is reduced to pure entity↔boundary/code joins; the administrative hierarchy is the
graph's responsibility, with a single source of truth.

**Why this priority**: A refactor/cleanup that consolidates two copies of the same hierarchy
mapping into one. It is observationally equivalent when the graph is materialised, so it is the
lowest user-facing priority, but it removes a class of drift bug (the two copies disagreeing).

**Independent Test**: Materialise the `part_of` edges, place a dataset on a municipality, and
confirm it rolls into the parent oblast **only after** the edge exists — proving the parent is
read from the graph and not from any crosswalk field; then confirm the crosswalk schema no
longer carries an `oblastEntityId` field.

**Acceptance Scenarios**:

1. **Given** a municipality dataset and **no** `part_of` edge for that municipality, **When** the oblast roll-up runs, **Then** the dataset does not roll into any oblast (the graph is the only parent source).
2. **Given** the same dataset **after** the `part_of` edge is materialised, **When** the roll-up runs, **Then** the dataset rolls into its parent oblast.
3. **Given** the gazetteer crosswalk schema, **When** an entry is validated, **Then** it contains only entity↔boundary/code join fields and no `oblastEntityId` hierarchy field.

---

### Edge Cases

- **Orphan municipality (no `part_of` parent)**: A municipality with no `part_of` edge contributes to no oblast in the roll-up (its datasets are not silently attributed to a wrong oblast). It still aggregates its own count at the municipality level.
- **Dataset reaching one oblast via several municipalities**: A dataset linked to two municipalities of the same oblast counts once toward that oblast (de-dup is per dataset per target, not per link).
- **Link to an unknown-but-`geo:` id vs. a non-geo id**: An entity id in the `geo:` namespace that resolves to no known oblast and has no `part_of` parent rolls up to nothing; a link whose id is outside both region namespaces (`geo:bg-oblast-*` / `geo:bg-municipality-*`) — e.g. a `topic:` id — is also ignored. Both are dropped identically by the roll-up (neither can land on a region it does not belong to), but for different reasons: the first has no resolvable parent, the second is not a region link at all.
- **Municipality level requested**: At municipality level the roll-up is identity for municipalities and drops oblast-only links — municipalities are leaves and never inherit oblast-direct datasets downward.
- **Same dataset, differing confidences across links**: The region records the **maximum** confidence among the links that roll up to it, never an average or the first-seen value.
- **Empty graph (un-materialised hierarchy)**: With no `part_of` edges, oblast roll-up falls back to direct links only (no municipality contributions) — counts are smaller but never wrong, and no crash.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST compute an oblast's dataset count as the de-duplicated union of datasets linked directly to the oblast and datasets linked to any municipality that is `part_of` that oblast.
- **FR-002**: A dataset that rolls up to a given region via more than one link (e.g. the oblast directly and one of its municipalities, or two municipalities of the same oblast) MUST contribute at most 1 to that region's count.
- **FR-003**: When a dataset rolls up to a region via multiple links, the region MUST record the **maximum** placement confidence among those contributing links as its `maxConfidence`.
- **FR-004**: The system MUST resolve each municipality's parent oblast from the `part_of` knowledge-graph edges (predicate `part_of`, subject = municipality entity id, object = oblast entity id), not from a crosswalk hierarchy field.
- **FR-005**: The system MUST classify a geo link as oblast vs. municipality by its entity-id namespace (`geo:bg-oblast-*` vs. `geo:bg-municipality-*`) and ignore links in neither namespace for region roll-up.
- **FR-006**: At the municipality level, the roll-up MUST be identity for municipality links and MUST exclude oblast-direct links (municipalities are leaves; data is never pushed down the hierarchy).
- **FR-007**: The oblast detail endpoint MUST return a dataset list whose distinct-dataset count equals the oblast's choropleth count, with each rolling-up dataset present exactly once.
- **FR-008**: Each region summary MUST always carry the `oblastEntityId` field, sourced from the `part_of` graph, to drive map drill-down: it is the parent oblast entity id for a municipality with a `part_of` parent, and is explicitly `null` for oblast rows and for any region without a parent (e.g. orphan municipalities). The field is always present; the "no parent" case is represented as `null`, never as an absent key.
- **FR-009**: The aggregation MUST remain a pure, store-free function over its inputs (crosswalk entries, label lookup, dataset geo-links, an injected `rollup` mapping, and an injected `parentOf` resolver) so the bucketing rules are unit-testable in isolation.
- **FR-010**: The roll-up MUST default to flat per-entity behavior when no `rollup` mapping is supplied, so callers that do not opt into hierarchy are unaffected.
- **FR-011**: An oblast with no direct and no municipality-rolled-up datasets MUST still be emitted with count 0 and `hasData` false, so the map renders every region.
- **FR-012**: The gazetteer crosswalk schema MUST NOT carry a municipality→oblast hierarchy field; the crosswalk MUST be limited to entity↔boundary-feature↔administrative-code joins.
- **FR-013**: The oblast detail endpoint MUST paginate its dataset list (`limit`, default 50, max 200; `offset`) while reporting `total` as the full distinct-dataset count that rolls up to the region, independent of the returned page slice. The list↔count parity asserted by FR-007 and SC-003 MUST hold against `total` (the full distinct count), not against the length of the returned page.

### Key Entities *(include if feature involves data)*

- **Region (administrative unit)**: An oblast or municipality, identified by its entity id (`geo:bg-oblast-*` / `geo:bg-municipality-*`), the level it sits at, and a join to its boundary feature. Oblasts are internal nodes; municipalities are leaves.
- **part_of edge**: A directed knowledge-graph relation (predicate `part_of`) from a municipality entity to its parent oblast entity. The sole runtime source of the administrative hierarchy used by the roll-up. Owned by spec 016 (entity-knowledge-graph).
- **Dataset geo-link**: A placement of a dataset onto a region entity, carrying a confidence. A dataset may carry several. Roll-up maps each link's entity id to the region ids it counts toward.
- **RegionSummary**: The per-region projection returned to the map: entity id, level, bilingual label, boundary feature id, de-duplicated `datasetCount`, `hasData`, `maxConfidence`, and the parent `oblastEntityId` for drill-down.
- **Geo crosswalk entry**: A pure join row mapping a region entity id to its boundary feature id and administrative codes (EKATTE/LAU for municipalities, ISO-3166-2 for oblasts) — no hierarchy field after this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the live mirror, every municipality's dataset count is less than or equal to its parent oblast's count — 243/243 municipalities-with-data (of 265 total) satisfy the invariant, 0 violations (before the feature, the invariant was routinely violated).
- **SC-002**: A dataset linked to both an oblast and one of its municipalities contributes exactly 1 to the oblast's count (0% double-counting across the overlap set).
- **SC-003**: For every oblast detail response, the returned distinct-dataset count equals the returned list length and equals the choropleth count for that oblast (100% list/count parity).
- **SC-004**: An oblast's count is the de-duplicated union of its own and its municipalities' datasets, so it grows to include its municipalities — e.g. `Варна`: **111** (direct links only, no roll-up) → **243** right after the roll-up shipped (#18, before publisher-derived recall was materialised) → **516** on the current live mirror, once publisher-derived recall (spec 014) and the entities-only re-curate populated more of its municipalities — with no double-counting at any stage.
- **SC-005**: The municipality→oblast parent used by the roll-up is sourced entirely from the `part_of` graph: a municipality dataset rolls into its oblast only after the `part_of` edge exists (verified by a test that fails against the prior crosswalk-sourced path).
- **SC-006**: The gazetteer crosswalk schema carries 0 hierarchy fields; validation rejects nothing it accepted before except the removed `oblastEntityId` key, and all 293 crosswalk entries load clean without it.
- **SC-007**: The full backend + shared-logic test suite is green with lint and typecheck clean, satisfying the 100% line+branch coverage gate on the changed logic.

## Assumptions

- **Hierarchy from the graph (dependency on spec 016)**: The `part_of` knowledge-graph layer that supplies the municipality→oblast parent map is built and materialised by spec 016 (entity-knowledge-graph). This feature **depends on** that layer and does not re-specify it; it only reads `part_of` edges. When the graph is not materialised, oblast roll-up degrades to direct links only.
- **Entity-id namespaces are authoritative for level**: A region's level is derivable from its entity-id prefix (`geo:bg-oblast-` / `geo:bg-municipality-`); the gazetteer assigns these consistently.
- **Equivalence of the two hierarchy sources at migration time**: The `part_of` graph and the previously-used crosswalk `oblastEntityId` field both derive from the same gazetteer, so moving the roll-up onto the graph (PR #24) is behaviorally identical when the graph is materialised; only the runtime source of truth changes.
- **Read-only / projection scope**: This feature changes how already-extracted geo placements are bucketed into counts and lists in the explorer API. It does not change geo extraction, municipality/oblast recall, the curate/index pipeline, or the national/non-georeferenced bucket (those gaps are addressed separately, e.g. spec for publisher-org region inference).
- **Map drill-down consumer**: The web map consumes `oblastEntityId` on municipality summaries to associate municipalities with their parent oblast; the API only needs to emit it.
