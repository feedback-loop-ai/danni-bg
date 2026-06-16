# Research: Entity knowledge graph (typed entity↔entity relations)

**Feature**: 016-entity-knowledge-graph · **Status**: Implemented (PR #23)

This records the design decisions taken for the entity↔entity relation layer. The work is shipped; this is the retrospective rationale.

## Decision 1 — Property graph in SQLite vs. RDF / a triple-store engine

**Decision**: Store relations as a single relational triple table (`entity_relations`) inside the existing `danni.sqlite` store. Keep the canonical triple shape — `(subject_id, predicate, object_id)` — so the model reads as a directed graph, but query it with ordinary SQL over indexes.

**Rationale**:
- **Scale doesn't warrant an engine.** The graph is the Bulgarian administrative hierarchy: 265 municipalities under 28 oblasts, 249 edges live. Traversal is shallow (one hop: municipality ↔ oblast) and is served by single indexed lookups. A SPARQL/triple-store engine (or a property-graph DB) buys nothing at this size.
- **Simplicity & YAGNI (Constitution V).** Every architectural decision must cite a concrete requirement and complexity must be justified in writing. There is no requirement for multi-hop graph queries, inference, or a query language today, so none was added. Adding a second storage engine would also break the locked single-store stack (Technology Stack: "single durable, queryable local store with migrations").
- **One store, one transaction model.** `entity_relations` lives beside `entities` and `dataset_entities`, shares migrations, foreign keys, and the same backup/restore path. The materialiser can upsert an entity node and its edge in the same store with no cross-system consistency problem.
- **The triple shape is still honest.** PK on `(subject_id, predicate, object_id)`, an index on `(object_id, predicate)` for reverse traversal, and an index on `(predicate)` for predicate scans. Forward traversal uses the PK's leading column. This is a property graph expressed relationally — the directed-typed-edge semantics are intact.

**Alternatives rejected**:
- *RDF triple-store (e.g. an embedded SPARQL engine)*: operational weight, a second query language, and a second store to keep in sync — for a one-hop hierarchy of a few hundred edges. Rejected on Simplicity and on the locked-stack constraint.
- *Property-graph DB (e.g. an embedded graph engine)*: same objection; no traversal depth justifies it.
- *Adjacency columns on `entities` (a nullable `parent_id`)*: would model only a single parent-pointer hierarchy, with no predicate, no provenance, no confidence, and no clean reverse query for "all children". It cannot generalise to other predicates and discards the provenance the project values. Rejected.

## Decision 2 — Why entity↔entity is a separate table from `dataset_entities`

**Decision**: Keep dataset→entity edges in `dataset_entities` (typed by the linked entity's `kind` — publishedBy / locatedIn / about / etc.), and put entity↔entity edges in the new `entity_relations` table. The two layers do not overlap.

**Rationale**:
- **They are different relations.** `dataset_entities` answers "which datasets touch this place/org/topic" — every row has a `dataset_id`. An entity↔entity edge (municipality `part_of` oblast) has no dataset; forcing it into `dataset_entities` would require a null `dataset_id` and a redefinition of that table's meaning.
- **No duplication.** A municipality→oblast hierarchy is intrinsic to the entities; it is not a fact about any dataset. Storing it once, in the entity layer, keeps a single source of truth and avoids fan-out duplication across every dataset that mentions the municipality.
- **Clean read semantics.** `entityGraph` composes the node from two clearly separated sources: `dataset_entities` gives the `datasetCount` (dataset→entity), `entity_relations` gives the `in`/`out` typed edges (entity↔entity). Each layer stays single-purpose.

This separation is documented in both the migration header and the vocabulary module so future contributors don't re-merge the layers.

## Decision 3 — A closed, documented controlled vocabulary for predicates

**Decision**: Predicates come from a closed set defined in one module (`src/enrich/relations/vocabulary.ts`): `ENTITY_PREDICATES = { PART_OF: 'part_of' }`, with `ALL_ENTITY_PREDICATES` and an `isEntityPredicate(value): value is EntityPredicate` type guard. `UpsertRelationInput.predicate` is typed to `EntityPredicate`.

**Rationale**:
- **"Formal" means defined, not inferred.** A knowledge graph is only formal if every edge's meaning is fixed. A closed vocabulary documents the meaning of each predicate (`part_of` = "a municipality is administratively part of its parent oblast") rather than letting callers write arbitrary strings whose semantics drift.
- **Type Safety (Constitution VII).** The closed union plus type guard makes an invalid predicate a compile-time (and, at the guard, runtime) error rather than a silent bad row. The repo's typed `upsert` cannot be called with an off-vocabulary predicate.
- **Start with one (YAGNI).** Only `part_of` is materialised today because it is the only entity↔entity relation the data actually has. New predicates (e.g. org hierarchies) are added deliberately, by editing the vocabulary — not by opening the field to free text.
- **Discoverability.** Keeping the set, its docs, and the explicit note that dataset→entity predicates live elsewhere in one file gives a single place to understand the graph's vocabulary.

**Alternatives rejected**:
- *Free-text predicate column*: no guarantee of meaning, no type safety, invites drift and typo-variants of the same relation. Rejected.
- *An enum in the database (CHECK on predicate values)*: would duplicate the vocabulary in SQL and force a migration for every new predicate; the TypeScript closed union + guard is the single source of truth and is enforced before the write. (The DB still enforces the structural invariants that matter there: confidence range and FK existence.)

## Decision 4 — Materialise the parent oblast node even with no direct dataset link

**Decision**: For every municipality entity present in the corpus, `registerEntityRelations` upserts the parent oblast as an entity node *before* asserting the `part_of` edge.

**Rationale**: The hierarchy must be complete from either direction. If an oblast appears in no dataset directly, it would otherwise be absent as a node and `GET /api/entities/:oblast` could not resolve its children. Upserting it makes "an oblast resolves to its child municipalities" hold unconditionally (SC-002). The pass only relates municipalities that surfaced in the corpus, so it does not flood the entity table with unused gazetteer rows — it adds exactly the oblast parents needed to complete present subtrees. The whole pass is idempotent (entity upsert + relation upsert are both INSERT-OR-REPLACE on their keys), so it is safe to re-run at the end of every curate.
