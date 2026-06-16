# Specification Quality Checklist: SVG choropleth + oblast→municipality drill-down

**Purpose**: Validate specification completeness and quality (retrospective — verifying the shipped spec against the implemented work)
**Created**: 2026-06-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details leak into the requirements/success criteria (FRs say "declarative SVG / no GPU", "real boundary dataset" as capabilities, not framework choices; framework names confined to plan.md/research.md)
- [x] Focused on user value and observable behaviour (drill-down, headless verifiability, correct first-click counts)
- [x] Written so a non-implementer can judge each requirement
- [x] All mandatory sections completed (User Scenarios, Requirements, Success Criteria, Assumptions)

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous (each FR maps to shipped code and/or a test)
- [x] Success criteria are measurable (e.g. "all 265 municipalities have geometry", "zero unmatched", "renders headlessly in Playwright", "counts on first click")
- [x] Success criteria are technology-agnostic (counts, coverage, headless verifiability — not "SVG" or "d3-geo")
- [x] All acceptance scenarios are defined (Given/When/Then for US1 and US2)
- [x] Edge cases are identified (zero-count municipality, skewed counts, centroid-outside-polygon fallback, slug collision, selection-while-drilled, degenerate scale)
- [x] Scope is clearly bounded (map layer + boundary/gazetteer data; filter/chat/list reused; only `oblastEntityId` + `lauId` shape changes)
- [x] Dependencies and assumptions identified (LAU 2021 source, spatial parent derivation, curate/index pass for counts, reused oblast geometry)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria (FR-001…FR-016 trace to scenarios/SC)
- [x] User scenarios cover the primary flows (P1 drill-down, P2 selection-independence)
- [x] Feature meets the measurable outcomes defined in Success Criteria (SC-001…SC-007 verified by the cited tests/PRs)
- [x] No implementation details leak into the specification

## Constitution Alignment (this feature)

- [x] Constitution X (Bulgarian-Locale): Cyrillic municipality names preserved verbatim; English labels are clearly derived; gazetteer↔boundary join by official `lauId`/EKATTE/ISO codes, never names (FR-005, FR-008)
- [x] Constitution VIII (Coverage/Parity): all map decision/computation logic extracted to pure, fully-covered modules; SVG render glue validated by E2E and recorded as the sanctioned exception in plan Complexity Tracking
- [x] Constitution VII (Type Safety): bundled crosswalk + GeoJSON Zod-validated at load; `lauId` regex/non-empty checked
- [x] Real-geometry/official-code grounding (closes the 008 placeholder gap): 265/265 municipalities with real LAU geometry, joined by official code

## Notes

- This checklist is retrospective: every item is verified against merged work in PRs #16 (map overhaul), #17 (test repair), and #21 (selection-independence fix).
- Two API/data shapes changed: `RegionSummary.oblastEntityId` and crosswalk `lauId` — both documented in `contracts/regions-api.md` and `data-model.md` and Zod-validated.
