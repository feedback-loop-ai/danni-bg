# Specification Quality Checklist: Centre document reader + debounced search + server-side grid

**Purpose**: Validate specification completeness and quality (retrospective; spec documents shipped PR #13)
**Created**: 2026-06-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details leak into the user-facing requirements beyond what is load-bearing for a retrospective spec (file/symbol references are intentional here, anchoring the record to shipped code)
- [x] Focused on user value (read data with room; trustworthy whole-resource sort/filter; prominent efficient search)
- [x] Written so a non-technical stakeholder can follow the user stories and acceptance scenarios
- [x] All mandatory sections completed (User Scenarios & Testing, Requirements → Functional Requirements, Success Criteria)

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable (one search fetch per debounce vs. per-keystroke; global-max-first sort; filtered total; `gridTruncated` over 100k; full suite green with 100% coverage on the new pure modules)
- [x] Success criteria reference observable outcomes, not internal mechanics, where possible
- [x] All acceptance scenarios are defined (Given/When/Then for US1–US3)
- [x] Edge cases are identified (malformed `filters` JSON, >100k scan cap, blank filters, non-tabular resource, equal-value stability, resource switch, close-vs-reselect)
- [x] Scope is clearly bounded (no migration, no new portal endpoint, no new store; extends 008's `/rows`)
- [x] Dependencies and assumptions identified (builds on 008; reuses `src/read`; both debounces 300ms; 100k scan cap)

## Feature Readiness

- [x] All functional requirements (FR-001…FR-016) have clear acceptance criteria via the user-story scenarios and success criteria
- [x] User scenarios cover the primary flows (read in reader, sort/filter whole resource, debounced search)
- [x] Feature meets the measurable outcomes (SC-001…SC-006) — verified by unit tests, Playwright E2E, and live mirror checks recorded in PR #13
- [x] User stories are prioritised (US1 P1, US2 P1, US3 P2), each with Why-this-priority, Independent Test, and Given/When/Then scenarios

## Constitution Alignment (retrospective)

- [x] Read-only/faithful (I): grid sorts/filters, never mutates or fabricates
- [x] Contract-First (III): `/rows` grid params + `gridTruncated` documented in 008 `http-api.md` and this feature's `contracts/rows-grid.md`
- [x] Type Safety (VII): `GridQuery`/`GridSort`/`ReaderTarget` typed; route guards `dir`/`filters`
- [x] 100% Coverage (VIII): all new logic pure + unit-tested; render behaviour via E2E; no new render glue
- [x] Freshness honesty (IX): existing freshness block preserved; `gridTruncated` flags partial scans
- [x] Bulgarian-locale (X): `localeCompare(…, 'bg')` ordering; case-insensitive Cyrillic substring filter; authoritative fields verbatim

## Notes

- This is a retrofit checklist: every box reflects the merged state of PR #13, not pre-implementation intent.
- The task description mentioned making "the dataset list a grid"; PR #13's diff does **not** change `DatasetList.tsx` — the only grid added is the resource-rows data grid (sort + per-column filter). The spec is grounded in the actual diff and therefore scopes US2 to the resource grid, not a dataset-list grid. Recorded here for traceability.
