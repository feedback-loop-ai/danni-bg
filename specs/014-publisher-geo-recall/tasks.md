---
description: "Task list for publisher-derived geographic recall (retrospective — shipped in PR #19)"
---

# Tasks: Publisher-derived geographic recall (shrink the national bucket)

**Input**: Design documents from `/specs/014-publisher-geo-recall/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Included — the feature shipped with dedicated unit tests and an
updated integration guarantee. All tasks below are **done** (`[X]`); this file
documents the as-built work merged in PR #19.

**Organization**: Grouped by the user stories in spec.md (US1 recall, US2
in-content precedence, US3 national stays national).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Could run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 from spec.md

## Path Conventions

Single project: `src/`, `tests/` at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the reuse surface — no new infrastructure was needed.

- [X] T001 Confirm the existing gazetteer `findGazetteerMatches()` and the `Extractor` interface can be reused as-is for a publisher-name scan (`src/enrich/gazetteer/bg-admin.ts`, `src/enrich/extractor.ts`).
- [X] T002 Confirm `OrganizationsRepo.get(id)` resolves a publisher id to its `title_bg`, and `EntitiesRepo.attach` keys provenance by `(dataset_id, entity_id, extractor)` (`src/store/repos/organizations.ts`, `src/store/repos/entities.ts`).

**Checkpoint**: Reuse surface verified — no new tables, columns, or interfaces required.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None. The feature builds entirely on existing curation
infrastructure (extractor pipeline, gazetteer, organisation/entity repos); there
is no blocking foundational work.

**Checkpoint**: Proceed directly to user-story implementation.

---

## Phase 3: User Story 1 - Regional datasets appear on their region (Priority: P1) 🎯 MVP

**Goal**: Derive a dataset's administrative unit from its publisher's name and attach it, so municipal/regional datasets that name no place themselves leave the national bucket.

**Independent Test**: Curate a dataset that names no place but is published by an org naming a municipality; confirm it is attached to that municipality (and rolls up to the parent oblast) and appears under that region.

### Tests for User Story 1

- [X] T003 [P] [US1] Unit test: a municipal publisher whose title names a place yields the place candidate with `evidence.source = 'publisher'` and `evidence.publisherId` set — `tests/unit/enrich/extractors/bg-admin-publisher.test.ts`.
- [X] T004 [US1] Integration test: extend the Sofia cohort to include datasets that name no place but are published by org-sofia (d07/d08/d11), asserting cohort 3→6 and shared-municipality clique 3→15 links — `tests/integration/enrichment-guarantees.test.ts` (SC-011).

### Implementation for User Story 1

- [X] T005 [US1] Implement `BgAdminPublisherExtractor` (id `bg_admin_publisher`): resolve `ctx.dataset.publisher_id` via `OrganizationsRepo`, run `findGazetteerMatches(org.title_bg)`, emit `geographic_unit` candidates with `evidence = { source: 'publisher', publisherId, matchType, kind }` — `src/enrich/extractors/bg-admin-publisher.ts`.
- [X] T006 [US1] Register `BgAdminPublisherExtractor(orgsRepo)` in the curation extractor list — `src/curate/run-curate.ts`.
- [X] T007 [US1] Confirm composition with the oblast roll-up: a publisher-derived municipality rolls up to its parent oblast via the existing `registerEntityRelations` step (no code change needed; asserted by the Sofia cohort aggregation in T004).

**Checkpoint**: Publisher-named municipal/regional datasets are placed on their region (MVP).

---

## Phase 4: User Story 2 - In-content placement still wins (Priority: P2)

**Goal**: Guarantee that an explicit in-content place match governs the placement confidence; the weaker publisher signal never supersedes it.

**Independent Test**: Curate a dataset that names a place AND is published by an org naming a place; confirm the in-content confidence (0.95/0.75) governs the (dataset, entity) pair and the publisher row (0.7/0.6) never outranks it.

### Tests for User Story 2

- [X] T008 [P] [US2] Unit test: every publisher-derived candidate is emitted at confidence ≤ 0.7, and `max(publisher confidences) < 0.75` (strictly below the in-content alias floor) — `tests/unit/enrich/extractors/bg-admin-publisher.test.ts`.

### Implementation for User Story 2

- [X] T009 [US2] Set publisher confidence to 0.7 (canonical) / 0.6 (alias), strictly below in-content 0.95/0.75 — in `src/enrich/extractors/bg-admin-publisher.ts`.
- [X] T010 [US2] Register the publisher extractor BEFORE `BgAdminGazetteerExtractor` so that, combined with the `(dataset, entity, extractor)` key + max-confidence read, the stronger in-content placement governs downstream; document the ordering inline — `src/curate/run-curate.ts`.

**Checkpoint**: In-content placements are never downgraded by publisher placements.

---

## Phase 5: User Story 3 - Genuinely national datasets stay national (Priority: P2)

**Goal**: Attach nothing when the publisher names no place (or there is no/unknown publisher), keeping the residual national bucket meaningful.

**Independent Test**: Curate a dataset published by a national org (e.g. "Министерство на финансите") that names no place; confirm zero geographic attachments.

### Tests for User Story 3

- [X] T011 [P] [US3] Unit test: a national publisher whose name names no place yields `[]` — `tests/unit/enrich/extractors/bg-admin-publisher.test.ts`.
- [X] T012 [P] [US3] Unit test: a dataset with no `publisher_id`, and one whose publisher id does not resolve, both yield `[]` (no error) — `tests/unit/enrich/extractors/bg-admin-publisher.test.ts`.

### Implementation for User Story 3

- [X] T013 [US3] Fail-closed guards: return `[]` when `publisher_id` is absent, when `orgs.get(id)` returns nothing, or when the gazetteer matches nothing — `src/enrich/extractors/bg-admin-publisher.ts`.

**Checkpoint**: National publishers produce no false placements; residual national bucket ≈ 1,776.

---

## Phase 6: Polish & Validation

- [X] T014 [P] Lint + typecheck clean (Biome + tsc); strict TypeScript, no `any` in source.
- [X] T015 Full suite green: 986 pass, 0 fail.
- [X] T016 Document the materialization path (`danni curate --entities-only`) for the live mirror — `specs/014-publisher-geo-recall/quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Verify reuse surface — no build work.
- **Foundational (Phase 2)**: None (no blocking prerequisites).
- **User Stories (Phase 3–5)**: US1 delivers the MVP (the extractor + registration). US2 and US3 are guarantees enforced by the same extractor file + registration ordering and are validated by additional unit tests; they share `bg-admin-publisher.ts` with US1 so are not independently *implementable* in separate files, but are independently *testable*.
- **Polish (Phase 6)**: After all stories.

### Within Each User Story

- Tests written alongside implementation (T003/T004 with T005–T007; T008 with T009/T010; T011/T012 with T013).

### Parallel Opportunities

- The three unit-test branches (T003, T008, T011, T012) live in one test file and were authored together; marked [P] as logically independent cases.

---

## Notes

- **Dependency on feature 015**: materializing the recall corpus-wide uses `danni curate --entities-only`, the entities-only curate path (feature 015), to avoid re-parsing every captured resource file.
- **Composition with feature 013**: publisher-derived municipalities roll up to their parent oblast via the existing relation step — no change to 013 was needed.
- All tasks are `[X]` (done) — this is a retrospective task list for work merged in PR #19.
