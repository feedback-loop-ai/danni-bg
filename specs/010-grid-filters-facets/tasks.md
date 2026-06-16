---
description: "Task list for Excel-style grid filters/sort + faceted search panel"
---

# Tasks: Excel-style grid filters/sort + faceted search panel

**Input**: Design documents from `specs/010-grid-filters-facets/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/facets-api.md

**Status**: Implemented — all tasks shipped in PR #14. Marked `[X]` with the real paths touched.

**Tests**: This feature ships pure-logic unit tests (constitution VIII: the server grid logic and client helpers contain logic and must be 100% covered) plus E2E for the user journeys. Test tasks are therefore included.

**Organization**: Grouped by user story so each slice is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (spreadsheet grid), US2 (faceted sidebar), US3 (empty-filter fix)

## Path Conventions

Web-app monorepo: server read substrate under `src/read/`; backend under `apps/explorer-api/src/`; frontend under `apps/explorer-web/src/`; tests under `tests/unit/` and `apps/explorer-web/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Reuse the existing explorer packages from feature 008; no new package needed.

- [X] T001 Confirm explorer packages from feature 008 (`apps/explorer-api`, `apps/explorer-web`, `src/read`) build and the rows route + FilterPanel exist as the baseline to extend.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types/projections both user stories depend on.

**⚠️ CRITICAL**: These block US1 and US2.

- [X] T002 [P] Add `Facets` + `FacetItem` view-model types in `apps/explorer-api/src/schemas.ts`.
- [X] T003 [P] Add client `Facets`/`FacetItem` types and `ResourceContent.gridTruncated` in `apps/explorer-web/src/types.ts`.

**Checkpoint**: Shared shapes exist — US1 and US2 can proceed in parallel.

---

## Phase 3: User Story 1 - Read a resource's rows like a spreadsheet (Priority: P1) 🎯 MVP

**Goal**: Header-click sorting + per-column filter funnels, evaluated server-side over the whole resource, with an honest large-resource truncation indicator.

**Independent Test**: Open a tabular resource, sort by a header (asc→desc→off), filter a column to a substring, confirm rows reflect the whole resource (not just page 1) and the count updates; load more preserves order.

### Tests for User Story 1

- [X] T004 [P] [US1] Unit-test pure server grid logic (`filterRows`, `sortRows`, `compareCells`, `applyGrid`, `isGridActive`, scan cap) in `tests/unit/read/resource-grid.test.ts` (100% line+branch).
- [X] T005 [P] [US1] Unit-test client grid helpers (`cycleSort`, `hasActiveFilters`) in `apps/explorer-web/src/lib/grid.test.ts`.

### Implementation for User Story 1

- [X] T006 [US1] Create pure server-side grid module `src/read/resource-grid.ts`: `GridSort`/`GridQuery` types, `compareCells` (numeric-aware + `localeCompare(..., 'bg')`, blanks last), `filterRows`, `sortRows`, `applyGrid` (filter-then-sort), `isGridActive`, and `MAX_GRID_SCAN = 100_000`.
- [X] T007 [US1] Thread the grid through `src/read/resource-rows.ts`: accept `opts.grid`, apply over up to `MAX_GRID_SCAN` rows before paging, set `gridTruncated` when the resource exceeds the cap.
- [X] T008 [US1] Forward `GridQuery` from `apps/explorer-api/src/read-bridge.ts` `rows()` into `readResourceRows`.
- [X] T009 [US1] Parse optional `sort`/`dir`/`filters` query params on the rows route in `apps/explorer-api/src/app.ts` (malformed `filters` ignored, not fatal).
- [X] T010 [P] [US1] Add client grid helpers in `apps/explorer-web/src/lib/grid.ts` (`GridSort`, `cycleSort`, `hasActiveFilters`).
- [X] T011 [US1] Extend `fetchResourceRows` in `apps/explorer-web/src/lib/api.ts` to send the `GridQuery` (sort/dir/filters) params.
- [X] T012 [US1] Add header-click sort (▲/▼, cycle) and per-column funnel popover with debounced filter input to `apps/explorer-web/src/datasets/ResourcePreview.tsx`; reset paging on sort/filter change; preserve order on "load more"; render the "· върху първите 100k" notice when `gridTruncated`.

**Checkpoint**: Grid sorts/filters server-side and is independently usable.

---

## Phase 4: User Story 2 - Discover and refine filters with a faceted sidebar (Priority: P1)

**Goal**: Faceted sidebar (tag/publisher facets with counts, freshness segmented control, removable chips) backed by `/api/facets`, with conjunctive (filter-aware) counts.

**Independent Test**: Open the sidebar, see tag/publisher facets with counts; tick a value and confirm narrowing + updated counts; confirm chips + "Изчисти всички".

### Tests for User Story 2

- [X] T013 [P] [US2] Contract-test `GET /api/facets` (response shape, in-scope counts consistent with `/api/datasets`, publisher id-fallback label, fresh/stale buckets) over mirror fixtures in `apps/explorer-api`; register in `tests/parity-matrix.json`.
- [X] T014 [P] [US2] Update Playwright journeys `apps/explorer-web/e2e/us2-filters.e2e.ts` and `us5-linked.e2e.ts` to drive the tag facet (replacing the exact-tag input).

### Implementation for User Story 2

- [X] T015 [US2] Implement `GET /api/facets` in `apps/explorer-api/src/app.ts`: parse filters, aggregate tags/publishers/freshness over `scopedLites(f)` in one pass, resolve publisher BG labels with id fallback.
- [X] T016 [US2] Add `fetchFacets(filters)` to `apps/explorer-web/src/lib/api.ts`.
- [X] T017 [US2] Rebuild `apps/explorer-web/src/filters/FilterPanel.tsx` as a faceted sidebar: collapsible `FacetSection`s; tag + publisher multi-select checkboxes with counts, top-8 + "Покажи още N", tag search-within; localized freshness segmented control with bucket counts + withdrawn toggle; active-filter chips (localized labels via `geoLabel`/facets) + "Изчисти всички"; re-fetch facets on filter change (conjunctive).

**Checkpoint**: Faceted sidebar works end-to-end against `/api/facets`.

---

## Phase 5: User Story 3 - Trust an empty filter result (Priority: P2)

**Goal**: A zero-match filter shows an empty table + localized message, never raw `[]`.

**Independent Test**: Apply a column filter matching nothing; confirm headers stay, "Няма съвпадения за филтъра." shows, no `[]`, and clearing restores rows.

### Implementation for User Story 3

- [X] T018 [US3] In `apps/explorer-web/src/datasets/ResourcePreview.tsx`, decide content kind by shape (text / document / table) rather than loaded-row count; persist the column set so the header survives a zero-row filter; render the empty-state message + "изчисти филтрите" instead of the JSON `[]` fallback.

**Checkpoint**: Empty-filter glitch fixed.

---

## Phase 6: Polish & Cross-Cutting Concerns (chart removal)

**Purpose**: Remove the now-dead chart view and keep CI green (Constitution V).

- [X] T019 [P] Delete the chart view and its data layer: `apps/explorer-web/src/lib/chart.ts` and `apps/explorer-web/src/lib/chart.test.ts`; remove the chart/view-selection UI from `ResourcePreview.tsx`.
- [X] T020 [P] Delete the retired E2E `apps/explorer-web/e2e/us8-line-chart.e2e.ts`; touch `us6-drilldown.e2e.ts` as needed for the no-chart drilldown.
- [X] T021 Verify gates: web typecheck + Biome clean; Vitest 100% line+branch on the new pure logic; parity matrix includes `/api/facets` + the grid params; Playwright E2E green; verified live against the real mirror.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T003)** block both stories.
- **US1 (T004–T012)** and **US2 (T013–T017)** are independent after Foundational and were developed as two stacked commits.
- **US3 (T018)** rides on US1's grid (same file).
- **Polish (T019–T021)** depends on US1/US3 (chart removal touches the same grid component).

### Parallel Opportunities

- T002 ‖ T003 (different files).
- T004 ‖ T005 (separate test files); T010 ‖ T011 within US1.
- T013 ‖ T014 (contract vs E2E).
- T019 ‖ T020 (different files).

---

## Notes

- [P] = different files, no dependency.
- Shipped as PR #14 in three commits (two grid commits signed; the faceted-panel commit unsigned due to an expired GPG/YubiKey PIN cache — re-signable once unlocked).
- The constitution's render-glue coverage exception is **not** used here (no new WebGL); all new logic is fully covered.
