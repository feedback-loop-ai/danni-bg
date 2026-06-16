# Specification Quality Checklist: Entities-only curate mode (re-extract without re-parsing)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- This is a RETROSPECTIVE spec for already-shipped, merged work (PR #20, merged 2026-06-16 from branch `feat/curate-entities-only`); it is written in the settled tense and marked **Implemented**.
- Clarifications resolved in the `### Session 2026-06-16` block of spec.md:
  - Q1 (schema/contract impact) → No schema change, no migration; one CLI flag added (documented in `contracts/cli.md`); `RunCurateResult` shape reused.
  - Q2 (whole-catalog safety) → Safe: `dataset_entities` / `dataset_links` / `entity_relations` writes are PK-guarded `INSERT OR REPLACE`, so re-runs re-assert the same rows without duplication.
  - Q3 (why skip translation too) → Translation needs the LAN translator and source BG text is unchanged by an extractor/gazetteer change, so prior translations stay valid; skipping it lets the mode run with no LAN access.
- Success criteria are stated technology-agnostically where it matters (e.g. "entities-only completes the full catalog without OOM at a footprint roughly two orders of magnitude below the full re-curate"), with the concrete ≈140 MB vs ≈20 GB figures as the measured evidence from the live mirror.
- All checklist items pass.
