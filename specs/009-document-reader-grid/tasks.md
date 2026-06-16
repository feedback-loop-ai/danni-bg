---
description: "Task list for 009-document-reader-grid (retrospective; shipped in PR #13)"
---

# Tasks: Centre document reader + debounced search + server-side grid

**Input**: Design documents from `/specs/009-document-reader-grid/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rows-grid.md

**Status (2026-06-12)**: Implemented. All tasks below shipped in PR #13 (`feat(009): centre document reader, debounced search, server-side grid sort/filter`), merged 2026-06-12. Boxes are checked against the merged code; file paths are the real paths.

**Tests**: This feature's new logic is pure and was delivered with unit tests; reader/search behaviour is validated by the existing Playwright E2E suite.

**Organization**: Tasks grouped by user story (US1, US2, US3) so each slice is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Could run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3 (foundational tasks unlabelled)

## Phase 1: Foundational (shared state + reused component plumbing)

**Purpose**: Store target and the one-component-two-variants plumbing every story builds on.

- [X] T001 Add `ReaderTarget` interface + `reader` state and `openReader`/`closeReader` actions to the explorer store in `apps/explorer-web/src/store/explorerStore.ts`.
- [X] T002 Add the `variant: 'panel' | 'reader'` prop to `apps/explorer-web/src/datasets/ResourcePreview.tsx` (fill-vs-fixed layout: `min-h-0 flex-1` in reader, `max-h-80` in panel; flex-column container in reader). This covers the FR-005 non-tabular case too: in `reader` the document/text view (JSON/text `<pre>`) grows to fill the reader rather than being capped, so charts, tables, and documents all fill the centre.

**Checkpoint**: Shared reader state + reusable preview variant ready.

---

## Phase 2: User Story 1 - Read a resource full-size in the centre reader (Priority: P1) 🎯 MVP

**Goal**: Open a dataset resource full-size in a centre overlay over the (still-mounted) map.

**Independent Test**: Select a dataset, click a resource; it renders in a centre overlay over the map area; closing via "← Карта" restores the map with no re-init flash; breadcrumb shows the dataset's Bulgarian title.

- [X] T003 [US1] Create the centre document reader `apps/explorer-web/src/datasets/ResourceReader.tsx`: absolute overlay (`absolute inset-0 z-[5]`) sibling of the map, driven by store `reader`; renders `ResourcePreview variant="reader"`; "← Карта" breadcrumb + dataset `titleBg`; returns `null` when no resource open.
- [X] T004 [US1] Mount `<ResourceReader />` inside the centre `<main>` (after the map, kept mounted underneath) in `apps/explorer-web/src/App.tsx`.
- [X] T005 [US1] Rewire `apps/explorer-web/src/datasets/DatasetDetail.tsx`: resource click calls `openReader({ datasetId, resourceId, name, titleBg })` instead of local `openResource` state; highlight the resource matching the active `reader` target; remove the inline `ResourcePreview` render and its `ResourcePreview` import.

**Checkpoint**: US1 fully functional — resources read full-size over the map.

---

## Phase 3: User Story 2 - Server-side sort + per-column filter over the whole resource (Priority: P1)

**Goal**: Tabular resources get spreadsheet-style sort + per-column filter applied server-side over the whole resource (capped at 100k rows, flagged when truncated).

**Independent Test**: Sort a numeric column desc on a multi-page resource → first row is the global max; type a column filter → count drops to the filtered total; unit tests assert numeric/locale ordering, blanks-last, AND'd substring filtering.

### Pure server logic + tests

- [X] T006 [P] [US2] Create the pure server-side grid module `src/read/resource-grid.ts`: `GridSort`/`SortDir`/`GridQuery` types, `MAX_GRID_SCAN=100_000`, `compareCells` (numeric / blanks-last / `localeCompare(…, 'bg')`), `filterRows` (case-insensitive substring, AND'd, ignore blanks), `sortRows` (stable), `applyGrid` (filter→sort), `isGridActive`, plus mirrored `isNumeric`/`cellText` helpers.
- [X] T007 [P] [US2] Add unit tests `tests/unit/read/resource-grid.test.ts` covering numeric vs. locale compare, blanks-last, stable sort, case-insensitive AND'd substring filter, `applyGrid` order (filter then sort), and `isGridActive`.

### Read layer + endpoint wiring

- [X] T008 [US2] Extend `src/read/resource-rows.ts`: add `grid?: GridQuery` to `ReadResourceOptions` and `gridTruncated?: boolean` to `ResourceContent`; when `isGridActive(grid)` on a tabular resource, scan the first `MAX_GRID_SCAN` lines, `applyGrid`, slice the page, set `total` to the filtered length and `gridTruncated` when the resource exceeded the cap.
- [X] T009 [US2] Thread the grid param through `apps/explorer-api/src/read-bridge.ts` (`ReadBridge.rows(..., grid?: GridQuery)` → `readResourceRows({ …, grid })`).
- [X] T010 [US2] Parse `sort`/`dir`/`filters` query params into a `GridQuery` in the `/rows` route in `apps/explorer-api/src/app.ts` — `dir` defaults to `asc`, `filters` parsed in try/catch (malformed ignored; only string-valued plain-object keys kept) — and pass it to `bridge.rows`.

### Client grid controls

- [X] T011 [P] [US2] Create pure client grid helpers `apps/explorer-web/src/lib/grid.ts`: `GridSort`/`SortDir` types, `cycleSort` (unsorted→asc→desc→unsorted, reset on new column), `hasActiveFilters`.
- [X] T012 [P] [US2] Add unit tests `apps/explorer-web/src/lib/grid.test.ts` for `cycleSort` cycle/reset and `hasActiveFilters`.
- [X] T013 [US2] Add `GridQuery` to `apps/explorer-web/src/lib/api.ts` and extend `fetchResourceRows` to serialise `sort`/`dir` and non-blank `filters` (URL-encoded JSON) onto the request.
- [X] T014 [US2] Add `gridTruncated?: boolean` to `ResourceContent` in `apps/explorer-web/src/types.ts`.
- [X] T015 [US2] In `apps/explorer-web/src/datasets/ResourcePreview.tsx`: add sortable header row (`cycleSort` on click, ▲/▼ + `aria-sort`), a per-column filter input row, instant `colFilters` debounced (300ms) into `appliedFilters` (resetting offset to 0), send `{ sort, filters: appliedFilters }` to `fetchResourceRows`, show "N от M реда (филтрирани)" + "изчисти филтрите" when filtering and the "· върху първите 100k" warning when `gridTruncated`; reset sort/filters on resource change.

**Checkpoint**: US2 fully functional — whole-resource sort/filter, correct and bounded.

---

## Phase 4: User Story 3 - Prominent, debounced dataset search (Priority: P2)

**Goal**: A dedicated, debounced search bar at the top of the left panel; remove the buried free-text input.

**Independent Test**: Typing fires one search after a 300ms pause (not per keystroke); spinner while loading; ✕ clears; external "Изчисти всички" resets the input.

- [X] T016 [US3] Create `apps/explorer-web/src/filters/SearchBar.tsx`: search-icon input with placeholder "Търси по дума, тема, издател…", instant local `text` state, 300ms-debounced commit to shared `filters.query` via `updateFilters`, re-sync from external `filters.query`, loading spinner (`loading` prop) and a clear (✕) button when text present.
- [X] T017 [US3] Remove the free-text search `Input` from `apps/explorer-web/src/filters/FilterPanel.tsx` (tags/freshness/withdrawn remain as refinement filters).
- [X] T018 [US3] Mount `<SearchBar loading={loading} />` at the top of the left panel and add `loading` state around the regions/datasets fetch (`setLoading(true)` before, `finally(setLoading(false))`) in `apps/explorer-web/src/App.tsx`.

**Checkpoint**: US3 fully functional — prominent debounced search.

---

## Phase 5: Docs & cross-cutting

- [X] T019 Document the new `/rows` grid query params (`sort`/`dir`/`filters`) and the `gridTruncated` response field in `specs/008-map-data-explorer/contracts/http-api.md`.
- [X] T020 Validate the full suite for PR #13: all backend/read suites pass with 100% coverage on the new pure modules; web typecheck + Biome clean; the Playwright E2E suite green; live verification (sort `zaginali_obshto` desc + an age-group filter over the full resource).

---

## Dependencies & Execution Order

- **Foundational (Phase 1)**: T001 (store) and T002 (preview variant) precede the stories that use them.
- **US1 (Phase 2)**: T003→T004→T005 depend on T001 (store) and T002 (variant).
- **US2 (Phase 3)**: server (T006/T007 → T008 → T009 → T010) and client (T011/T012 → T013/T014 → T015) legs; T015 depends on T013/T014 and T002.
- **US3 (Phase 4)**: T016 → T017/T018 (independent of US1/US2).
- **Docs (Phase 5)**: T019 follows T010; T020 follows all.

### Parallel Opportunities

- T006/T007 (server grid + tests) ∥ T011/T012 (client grid helpers + tests) — different files.
- US3 (Phase 4) is independent of US1/US2 and could run in parallel.

---

## Notes

- Retrospective: all boxes checked against merged PR #13; file paths are the actual shipped paths.
- No database migration, no new portal endpoint, no new persistent store — the `/rows` endpoint gained optional params and one optional response field.
- All new logic (`resource-grid.ts`, `grid.ts`, debounces, header cycle) is pure/logic and covered at 100%; reader/search render behaviour is validated by Playwright E2E.
