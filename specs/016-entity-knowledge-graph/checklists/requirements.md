# Requirements Quality Checklist: Entity knowledge graph (typed entity↔entity relations)

**Purpose**: Validate that the spec for the entity↔entity relation layer is complete, unambiguous, testable, and consistent before (retrospectively: against) implementation.
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [X] CHK001 Is there a requirement defining the relation as a directed, typed triple between two canonical entities with provenance + confidence? (FR-001)
- [X] CHK002 Is the uniqueness of a relation specified (the triple is the primary key)? (FR-001)
- [X] CHK003 Is referential integrity required — both endpoints must be existing entities? (FR-002)
- [X] CHK004 Are forward, reverse, and predicate-scoped traversals all required? (FR-003)
- [X] CHK005 Is the predicate vocabulary required to be closed and documented, with a type guard? (FR-004)
- [X] CHK006 Is the layer separation (dataset→entity stays in `dataset_entities`) stated as a requirement, not just an aside? (FR-005)
- [X] CHK007 Is the materialisation source (bundled gazetteer) and the asserted edge shape (`part_of`, confidence 1, gazetteer evidence) specified? (FR-006)
- [X] CHK008 Is parent-node upsert and the present-only filter required? (FR-007)
- [X] CHK009 Is the materialiser's run point (curate, full + `--entities-only`) and idempotency required? (FR-008)
- [X] CHK010 Is the endpoint response shape (entity, out, in with resolved far ends, datasetCount) fully specified? (FR-009, FR-011)
- [X] CHK011 Is the unknown-id behaviour (404 + `not_found` envelope) specified? (FR-010)
- [X] CHK012 Is observability of the asserted count required (`relationsCreated` + log)? (FR-012)

## Requirement Clarity & Testability

- [X] CHK013 Are all functional requirements stated in MUST terms and individually verifiable?
- [X] CHK014 Does each user story carry a priority, a Why, an Independent Test, and Given-When-Then acceptance scenarios?
- [X] CHK015 Are success criteria measurable and technology-agnostic (e.g. "249 part_of edges"; "an oblast resolves to its child municipalities")? (SC-001…SC-007)
- [X] CHK016 Is "present in the corpus" defined unambiguously (entity exists in `entities`)? (Assumptions)
- [X] CHK017 Are the edge cases (no relations, unresolvable far endpoint, absent municipality, oblast with no direct dataset, re-run, out-of-range confidence) enumerated?

## Consistency & Traceability

- [X] CHK018 Do the Key Entities (triple, predicate vocabulary, EntityNode, EntityRelationEdge, EntityGraphView) match data-model.md and the API schema?
- [X] CHK019 Does the endpoint contract (`contracts/entities-get.md` + `.schema.json`) match FR-009/FR-010/FR-011 and the response in quickstart.md?
- [X] CHK020 Are all FRs traceable to at least one task in tasks.md, and all tasks to a real shipped path?
- [X] CHK021 Is the closed-vocabulary scope consistent across spec, research, data-model (currently exactly `part_of`)?

## Constitution Alignment

- [X] CHK022 Is the graph a derived, provenanced layer that does not alter authoritative portal data (Constitution I/IX/X)? Confirmed: edges carry `evidence_json`; BG labels verbatim, EN labels separate/nullable.
- [X] CHK023 Is the storage choice (single SQLite triple table vs. RDF/triple-store) justified against Simplicity & YAGNI (Constitution V) in research.md?
- [X] CHK024 Is the endpoint contract-first with a parity-matrix-registered contract test (Constitution III/VIII)?
- [X] CHK025 Is predicate typing enforced via a closed union + guard, and confidence/FK invariants enforced at the store boundary (Constitution VII)?

## Scope Boundaries

- [X] CHK026 Is out-of-scope explicit (no predicates beyond `part_of`, no inference, no multi-hop query endpoint, no moving dataset→entity edges)?
- [X] CHK027 Are dependencies on prior features (canonical `entities`, `dataset_entities`, the gazetteer) stated as assumptions, not silently relied on?

## Notes

- Retrospective checklist: all items verified against the merged PR #23 implementation and the companion artifacts.
- FR ↔ source code: FR-001/002 → `migrations/007_entity_relations.sql`; FR-003 → `EntityRelationsRepo`; FR-004/005 → `vocabulary.ts`; FR-006/007/008 → `register-relations.ts` + `run-curate.ts`; FR-009/010/011 → `read-bridge.ts` + `app.ts` + `schemas.ts`; FR-012 → `run-curate.ts`.
