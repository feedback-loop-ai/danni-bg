# Feature Specification: Entity knowledge graph (typed entity↔entity relations)

**Feature Branch**: `016-entity-knowledge-graph`  
**Created**: 2026-06-16  
**Status**: Implemented (shipped in PR #23, "feat(graph): entity_relations — typed entity↔entity knowledge graph")  
**Input**: User description: "We had canonical typed entities plus dataset→entity edges, but the only entity↔entity relation we knew about — a municipality belonging to its parent oblast — lived solely in the bundled gazetteer crosswalk JSON, read ad-hoc by the region roll-up. Promote that implicit administrative hierarchy into a formal, queryable knowledge-graph layer: a table of directed, typed, provenanced triples between canonical entities, a closed predicate vocabulary, a materialiser that asserts the `part_of` hierarchy at curate time, and an HTTP endpoint that returns an entity's graph node (its labels, its incoming/outgoing typed relations, its direct dataset count)."

## Clarifications

### Session 2026-06-16

- Q: Property graph in SQLite vs. an RDF/triple-store? → A: A single relational triple table (`entity_relations`) in the existing `danni.sqlite` store. The graph is small (hundreds of edges) and read via simple subject/object/predicate lookups; adding a triple-store engine would violate Simplicity & YAGNI (Constitution V) and the locked single-store stack. The triple shape (subject, predicate, object) is preserved so the model reads as a graph.
- Q: Why not just add these edges to `dataset_entities`? → A: `dataset_entities` is the **dataset→entity** layer (a dataset links to a place/org/topic, typed by the entity's `kind`). Entity↔entity edges are a different relation kind and would pollute that table with rows that have no `dataset_id`. The two layers stay separate so neither duplicates the other.
- Q: Open or closed predicate set? → A: **Closed and documented** (`src/enrich/relations/vocabulary.ts`). A "formal" graph means every edge's meaning is defined, not inferred. The vocabulary currently has exactly one predicate, `part_of`; new predicates are added by editing the vocabulary, not by free-text writes.
- Q: Should the materialiser create oblast nodes that no dataset referenced? → A: Yes. For every municipality entity present in the corpus it upserts the parent oblast node first, so the hierarchy is complete (an oblast resolves to its children) even when no dataset linked the oblast directly.
- Q: Is this a write to the corpus or a derived layer? → A: A **derived** layer. Edges carry provenance (`evidence_json`, currently `{ "source": "gazetteer" }`) and confidence; authoritative portal data is untouched (Constitution I/X).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Traverse the administrative hierarchy as a graph (Priority: P1)

A consumer (an AI agent or the explorer UI) asks for one entity's node in the knowledge graph and gets back its canonical labels plus its typed relations in both directions: from a municipality it sees the outgoing `part_of` edge to its parent oblast; from an oblast it sees the incoming `part_of` edges from every child municipality. It also sees how many datasets link to the entity directly.

**Why this priority**: This is the headline capability the feature exists to ship — turning the previously-implicit hierarchy into something a consumer can actually query. Without it the relations would be invisible. It is P1 because it is the user-facing read surface that gives the whole graph its value.

**Independent Test**: Seed a municipality entity, a `part_of` edge to its oblast, and a dataset link; `GET /api/entities/:id` for the municipality returns the `part_of` edge outgoing with the resolved oblast node and `datasetCount: 1`; `GET /api/entities/:id` for the oblast returns the same edge as an incoming relation. Unknown id returns 404.

**Acceptance Scenarios**:

1. **Given** a municipality entity with a `part_of` edge to its oblast and one linked dataset, **When** `GET /api/entities/geo:bg-municipality-stolichna` is called, **Then** the response has `entity.kind = "geographic_unit"`, exactly one `out` edge with `predicate = "part_of"` whose `entity.entityId` is the parent oblast, and `datasetCount = 1`.
2. **Given** the same edge, **When** `GET /api/entities/geo:bg-oblast-sofia-grad` is called, **Then** the oblast's `in` array contains an edge whose `entity.entityId` is the child municipality.
3. **Given** an id that matches no entity, **When** `GET /api/entities/nope` is called, **Then** the response is `404` with the `not_found` error envelope.

---

### User Story 2 - A formal, typed, provenanced relation store (Priority: P1)

The hierarchy is stored as directed triples — `(subject_id) --predicate--> (object_id)` — between canonical entities, each carrying a confidence and a provenance record, in a dedicated `entity_relations` table that is queryable by subject, by object, and by predicate. Predicates are drawn from a closed, documented vocabulary.

**Why this priority**: The endpoint (US1) is only trustworthy if the relations underneath it are well-typed, deduplicated, and provenanced. The triple table plus the controlled vocabulary are the load-bearing substrate; both forward and reverse traversal must be cheap. It is P1 because US1 cannot stand without it.

**Independent Test**: Assert two `part_of` triples into `EntityRelationsRepo`; read them back by subject (one edge) and by object (both child municipalities); re-assert a triple with a new confidence and confirm the row count is unchanged and the confidence refreshed (idempotent on the triple PK).

**Acceptance Scenarios**:

1. **Given** an empty store, **When** two distinct `(subject, part_of, object)` triples are upserted, **Then** `bySubject` returns the subject's one edge with its `evidence_json` preserved, `byObject` returns both children, and `count()` is 2.
2. **Given** an existing triple, **When** the same `(subject, predicate, object)` is upserted with a different confidence, **Then** the row count is unchanged and the stored confidence is the new value (the triple is the primary key).
3. **Given** the predicate vocabulary, **When** it is inspected, **Then** it is a closed set documented in one module, currently `{ part_of }`, with a type guard that rejects any string outside the set.

---

### User Story 3 - Hierarchy materialised automatically at curate time (Priority: P2)

When curate runs (full or `--entities-only`), the `part_of` graph is (re)built from the bundled administrative gazetteer over the entities currently present in the corpus: for every municipality entity that surfaced, the edge to its parent oblast is asserted and the parent oblast node is upserted. The pass is global and idempotent, so it reconciles the whole graph regardless of which datasets ran.

**Why this priority**: A graph nobody populates is empty. Wiring materialisation into curate is what makes the relations exist on the live mirror and stay correct as new datasets bring new municipalities into scope. It is P2 because the substrate and read surface (US1/US2) define the contract; this keeps it filled.

**Independent Test**: Seed only one municipality entity; run `registerEntityRelations`; assert it created exactly one edge, upserted the parent oblast as a node (even though no dataset referenced it), and that a second run leaves the edge count unchanged. With no municipality entities present, it creates zero edges.

**Acceptance Scenarios**:

1. **Given** exactly one municipality entity is present, **When** `registerEntityRelations` runs, **Then** it creates exactly one `part_of` edge and the parent oblast now exists as an entity node.
2. **Given** no municipality entities are present, **When** the materialiser runs, **Then** it creates zero edges and the relation count stays 0 (only municipalities surfaced in the corpus are related).
3. **Given** the materialiser has already run, **When** it runs again over the same corpus, **Then** the relation count is unchanged (idempotent).

---

### Edge Cases

- An entity id that exists but has no relations — `GET /api/entities/:id` returns the node with empty `out` and `in` arrays and its `datasetCount` (a valid, non-error response).
- A relation whose far endpoint is not a known entity — `entityGraph` resolves it to a placeholder node (`kind: "unknown"`, `labelBg` = the id) rather than dropping the edge, so traversal never silently loses an edge. (In practice the materialiser always upserts both endpoints, so this is a defensive fallback.)
- A municipality in the gazetteer that never appeared in any dataset — it is skipped: only municipalities present in the corpus get a `part_of` edge.
- An oblast referenced by no dataset directly — it still exists as a node and resolves to its child municipalities, because the materialiser upserts it.
- Re-running curate after new datasets bring a new municipality into scope — the global, idempotent pass adds the new edge without duplicating existing ones.
- A confidence outside `(0, 1]` — rejected by the table's CHECK constraint at write time.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The store MUST persist directed, typed relations between canonical entities as triples `(subject_id, predicate, object_id)` with a `confidence`, an `evidence_json` provenance record, and a `created_at` timestamp; the triple MUST be the primary key (a relation is unique on subject+predicate+object).
- **FR-002**: Both `subject_id` and `object_id` MUST reference existing rows in `entities` (foreign keys); a relation MUST NOT exist between non-entities.
- **FR-003**: The relation store MUST support forward traversal (edges by subject), reverse traversal (edges by object), and predicate-scoped lookups, each optionally filtered to a single predicate, and MUST expose a total `count`.
- **FR-004**: Predicates MUST be drawn from a single, closed, documented controlled vocabulary; the vocabulary MUST currently contain exactly `part_of` and MUST expose a type guard that rejects any string outside the set.
- **FR-005**: Dataset→entity relationships MUST remain in `dataset_entities` (typed by the linked entity's `kind`); `entity_relations` MUST hold only entity↔entity edges, so the two layers do not duplicate each other.
- **FR-006**: A materialiser MUST assert, for every municipality entity present in the corpus, the edge `municipality --part_of--> parent oblast` derived from the bundled administrative gazetteer, with `confidence = 1` and `evidence = { source: "gazetteer" }`.
- **FR-007**: The materialiser MUST upsert the parent oblast as an entity node before asserting the edge, so the hierarchy is complete even when no dataset referenced the oblast directly; it MUST skip gazetteer municipalities not present in the corpus.
- **FR-008**: The materialiser MUST run at the end of curate (both the full run and `--entities-only`) and MUST be global and idempotent — re-running over the same corpus leaves the relation count unchanged.
- **FR-009**: `GET /api/entities/:id` MUST return the entity's graph node: its canonical labels and kind, its outgoing typed relations (`out`), its incoming typed relations (`in`) with the far-end entity resolved on each edge, and its direct dataset count (`datasetCount`).
- **FR-010**: `GET /api/entities/:id` MUST return `404` with the `not_found` error envelope for an id that matches no entity.
- **FR-011**: Each edge in the endpoint response MUST carry its `predicate` and `confidence` and the resolved far-end entity node; an unresolvable far endpoint MUST resolve to a placeholder node (`kind: "unknown"`) rather than being dropped.
- **FR-012**: The curate result MUST report the number of relations asserted (`relationsCreated`) and the materialised count MUST be observable in the `curate.completed` log.

### Key Entities

- **entity_relations (triple)**: a directed, typed edge between two canonical entities — `subject_id`, `predicate`, `object_id`, `confidence` (`0 < c ≤ 1`), `evidence_json` (provenance, e.g. `{ "source": "gazetteer" }`), `created_at`. PK = (subject_id, predicate, object_id). FKs on both endpoints into `entities`. Indexed for reverse traversal (`object_id, predicate`) and predicate scans (`predicate`); forward traversal is served by the PK's leading column.
- **Predicate (controlled vocabulary)**: a closed, documented set of relation types (`src/enrich/relations/vocabulary.ts`). Currently `{ part_of }` — "subject (municipality) is administratively part of object (oblast)". Exposes `ENTITY_PREDICATES`, `ALL_ENTITY_PREDICATES`, and an `isEntityPredicate` type guard.
- **EntityNode**: a node in the graph — `entityId`, `kind`, `labelBg`, `labelEn`. The canonical view of one entity returned both as the queried entity and as the far end of every edge.
- **EntityRelationEdge**: a typed edge in the endpoint response — `predicate`, `confidence`, and the resolved far-end `entity` (an `EntityNode`).
- **EntityGraphView**: one entity's neighbourhood, returned by `GET /api/entities/:id` — `{ entity, out[], in[], datasetCount }`. `out` = edges where the entity is the subject; `in` = edges where it is the object.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the live mirror, 249 `part_of` edges are materialised (one per municipality entity present in the corpus).
- **SC-002**: An oblast resolves to its child municipalities via a single `GET /api/entities/:id` call (the children appear as `in` edges with `predicate = "part_of"`), and a municipality resolves to its parent oblast as an `out` edge — without reading the gazetteer JSON.
- **SC-003**: Re-running the materialiser over the same corpus produces zero net new edges (idempotent): the relation count is identical before and after.
- **SC-004**: A municipality not present in the corpus produces no edge; only municipalities that surfaced in ≥1 dataset are related.
- **SC-005**: Every edge carries a defined predicate from the closed vocabulary and a provenance record; no edge has an undocumented predicate.
- **SC-006**: `GET /api/entities/:id` returns 404 for an unknown id and a node with empty `out`/`in` for a known entity with no relations.
- **SC-007**: Dataset→entity edges are not duplicated into `entity_relations`; that table contains only entity↔entity rows.

## Assumptions

- This is a retrospective spec: the work is already shipped and verified (PR #23), so the spec is written in the settled tense and marked Implemented.
- The canonical `entities` table and the `dataset_entities` (dataset→entity) layer already exist from prior features; this feature adds the entity↔entity layer on top of them.
- The bundled administrative gazetteer (`src/enrich/gazetteer/bg-admin.ts`, `OBLASTS` + `MUNICIPALITIES` with `oblastId` crosswalk) is the authoritative source for the `part_of` hierarchy and is the same data the region roll-up already used.
- "Present in the corpus" means the municipality entity exists in `entities` (i.e. it was linked to ≥1 dataset by an earlier extraction pass); the materialiser does not create municipality nodes, only parent oblast nodes.
- Out of scope: predicates beyond `part_of`; org→org or topic hierarchies; inference of new edges from data (all current edges are gazetteer-derived); a graph-query language or multi-hop traversal endpoint; moving dataset→entity edges out of `dataset_entities`.
