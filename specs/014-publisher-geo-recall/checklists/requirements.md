# Requirements Quality Checklist: Publisher-derived geographic recall

**Purpose**: Validate that the spec for publisher-derived geographic recall is complete, unambiguous, measurable, and technology-agnostic before (retrospectively: against) implementation.
**Created**: 2026-06-15
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [X] CHK001 Every functional requirement (FR-001…FR-009) names a single, testable behavior.
- [X] CHK002 The recall behavior (derive place from publisher name) is captured (FR-001, FR-002).
- [X] CHK003 The confidence-ordering guarantee (publisher < in-content) is captured (FR-003) with concrete values.
- [X] CHK004 The precedence guarantee (in-content placement governs) is captured (FR-004).
- [X] CHK005 The fail-closed behavior (no/unknown publisher, no place named → nothing) is captured (FR-005).
- [X] CHK006 Composition with the oblast roll-up is captured (FR-006).
- [X] CHK007 Coexistence of both provenance rows is captured (FR-007).
- [X] CHK008 Locale safety (authoritative org names preserved) is captured (FR-008).
- [X] CHK009 The materialization path requirement is captured (FR-009).

## Requirement Clarity & Measurability

- [X] CHK010 No `[NEEDS CLARIFICATION]` markers remain.
- [X] CHK011 Success criteria are measurable with real numbers (SC-001: 56.7%→15.0%; SC-002: +9,899 placements / 5,133→10,078; SC-003: 73.6%).
- [X] CHK012 Success criteria are technology-agnostic (no class names, table names, or SQL in SC items).
- [X] CHK013 Each FR is verifiable by a test or an observable corpus metric.

## User Story Quality

- [X] CHK014 Each user story has a priority (P1/P2/P2).
- [X] CHK015 Each user story has a "Why this priority" rationale.
- [X] CHK016 Each user story has an "Independent Test".
- [X] CHK017 Each user story has Given-When-Then acceptance scenarios.
- [X] CHK018 The P1 story is a standalone MVP (recall) that delivers value without the guard stories.

## Edge Cases & Boundaries

- [X] CHK019 No-publisher and unknown-publisher edge cases are listed.
- [X] CHK020 National-publisher (no place) edge case is listed and tied to keeping the bucket meaningful (SC-005).
- [X] CHK021 Same-place-both-ways and different-place-both-ways cases are listed.
- [X] CHK022 Roll-up composition edge case is listed.

## Consistency & Traceability

- [X] CHK023 Key Entities match the data model (EntityCandidate, dataset_entities provenance, publisher org, admin unit).
- [X] CHK024 Spec numbers (56.7%→15.0%, 73.6%, 4,945, 9,899) are consistent with research.md and the PR #19 measurement.
- [X] CHK025 Assumptions list the dependency on the entities-only curate path (feature 015) and the oblast roll-up (feature 013).
- [X] CHK026 Status reflects shipped reality ("Implemented", PR #19).

## Scope Boundaries

- [X] CHK027 The spec does not change sync/freshness behavior (enrichment-only).
- [X] CHK028 The spec adds no MCP tool or portal endpoint (no contract surface) — consistent with empty `contracts/`.

## Notes

- This is a retrospective checklist for already-merged work (PR #19); all items are validated against the shipped spec and code.
