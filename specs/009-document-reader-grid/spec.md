# Feature Specification: Centre document reader + debounced search + server-side grid

**Feature Branch**: `009-document-reader-grid` (renamed from `009-center-document-reader`)  
**Created**: 2026-06-12  
**Status**: Implemented (shipped in PR #13, merged 2026-06-12; full suite green — all backend/read suites pass with 100% coverage on the new pure modules, plus the Playwright E2E suite)  
**Input**: User description: "UX pass on the explorer's data-reading and search experience (follow-up to 008): open a dataset resource full-size in a centre document reader that overlays the map instead of cramming it into the 340px left panel; promote free-text search to a prominent, debounced search bar; and give tabular resources spreadsheet-style sort + per-column filter applied server-side over the whole resource, not just the loaded page."

## Clarifications

### Session 2026-06-12

- Q: Where is sort/filter applied — on the page the client has loaded, or the whole resource? → A: Server-side over the whole resource. `GET …/rows` accepts `?sort=<col>&dir=asc|desc&filters=<json>`; the read layer (`src/read/resource-grid.ts` via `readResourceRows`) applies filter→sort to all rows before slicing the requested page, and returns the filtered `total`. A scan cap of `MAX_GRID_SCAN`=100,000 rows bounds memory; when the resource is larger the response sets `gridTruncated: true` and the UI shows a "върху първите 100k" warning.
- Q: Does opening the reader unmount the map? → A: No. The reader is an absolute overlay (`z-[5]`) rendered as a sibling of the map inside the centre `<main>`. The map stays mounted underneath, so closing the reader is instant with no MapLibre re-init flash.
- Q: How does the new grid agree with the client on what counts as "numeric"? → A: `resource-grid.ts` re-implements the same `isNumeric`/`cellText` semantics the client uses (`lib/chart.isNumeric`, `lib/table.cellText`) so numeric columns order numerically, blanks sort last, and everything else uses Bulgarian-locale collation (`localeCompare(…, 'bg')`) — identical client and server.
- Q: Does this feature add a database migration or a new portal endpoint? → A: No. It extends the existing `GET …/rows` HTTP endpoint with optional query params and adds a pure read helper. No schema, no migration, no new portal endpoint. The 008 `contracts/http-api.md` is updated in place to document the new params.
- Q: Is the search debounce the same mechanism as the per-column filter debounce? → A: They are two independent 300ms debounces. The dataset search bar debounces the shared `filters.query` (which drives the hybrid keyword+vector dataset search); the grid filter row debounces per-column substring filters before they hit `/rows`. Both reset the relevant pagination on commit.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read a resource full-size in the centre reader (Priority: P1)

A user exploring the map opens a dataset in the left panel, clicks a resource (a table, chart, or document), and the resource opens **full-size in the centre of the screen, overlaying the map**, with a "← Карта" breadcrumb back to the map and the parent dataset's Bulgarian title shown. Wide tables and charts get the full centre width instead of being crushed into the 340px side panel; closing returns to the map instantly.

**Why this priority**: The data itself is the product. In 008 the resource drilldown rendered inside the 340px left panel where wide tables and charts were cramped and competed with the dataset metadata. Reading the actual data is the core job; giving it room is the single highest-value UX change in this pass, and it is independently demonstrable end-to-end.

**Independent Test**: With the explorer running against a fixture/live mirror, select a dataset, click a resource, and verify the resource renders in a centre overlay occupying the map area (not the side panel), that the map is still mounted underneath (no re-init flash on close), that the breadcrumb shows the dataset's Bulgarian title, and that clicking "← Карта" restores the map with the resource closed.

**Acceptance Scenarios**:

1. **Given** a dataset is selected and its resource list is shown in the left panel, **When** the user clicks a resource, **Then** that resource opens in the centre document reader overlaying the map, sized to fill the centre area, and the clicked resource is highlighted as active in the left panel.
2. **Given** a resource is open in the centre reader, **When** the user clicks "← Карта" (or the reader's close control), **Then** the reader closes and the underlying map is shown again with no re-initialisation flash (the map was never unmounted).
3. **Given** a resource is open in the centre reader, **When** the user reads the breadcrumb, **Then** it shows the parent dataset's Bulgarian title (`titleBg`).
4. **Given** no resource is open, **When** the centre area renders, **Then** the reader renders nothing and the map is fully visible.

---

### User Story 2 - Sort and filter a tabular resource over the whole dataset (Priority: P1)

A user reading a tabular resource clicks a column header to sort it (cycling unsorted → ascending → descending → unsorted) and types substrings into a per-column filter row to narrow the rows. The sort and filter apply across the **entire resource on the server**, not just the page already loaded, and the row count updates to the filtered total with a "изчисти филтрите" clear action. Numbers order numerically, blanks sort last, and text uses Bulgarian-locale ordering.

**Why this priority**: A reader that only sorts/filters the loaded page is misleading — the "top" row by value would be the top of the current page, not the resource. Correct, server-side, whole-resource sort/filter is what makes the grid trustworthy for answering real questions (e.g. "which station has the highest PM10"). It is P1 because it is the data-correctness guarantee of the reader.

**Independent Test**: Open a multi-page tabular resource, sort a numeric column descending, and confirm the first row is the global maximum over the whole resource (not just the first loaded page); type a substring into a column filter, confirm the row count drops to the filtered total and only matching rows show; verify the `src/read/resource-grid.ts` unit tests assert numeric/locale ordering, blanks-last, case-insensitive AND'd substring filtering.

**Acceptance Scenarios**:

1. **Given** a tabular resource spanning multiple pages, **When** the user sorts a numeric column descending, **Then** the rows returned start at the global maximum across the whole resource and `total` reflects the (unchanged) row count.
2. **Given** a column header showing no sort, **When** the user clicks it repeatedly, **Then** the sort cycles unsorted → ascending → descending → unsorted, and the active direction is indicated (▲/▼) with `aria-sort` set on the header.
3. **Given** a per-column filter input, **When** the user types a substring, **Then** after the 300ms debounce the server returns only rows where that column contains the substring (case-insensitive), the displayed count reads "N от M реда (филтрирани)", and multiple column filters are AND'd together.
4. **Given** active filters, **When** the user clicks "изчисти филтрите", **Then** all column filters clear and the full (unfiltered) row set is restored.
5. **Given** a resource larger than `MAX_GRID_SCAN` (100,000) rows, **When** a sort or filter is applied, **Then** the response carries `gridTruncated: true` and the UI shows a "върху първите 100k" warning that the operation covered only the first 100k rows.

---

### User Story 3 - Prominent, debounced dataset search (Priority: P2)

A user searches datasets via a dedicated search field at the top of the left panel (search icon, clear button, loading spinner) rather than a free-text box buried in the filter panel that looked identical to the tag input. Typing updates the input instantly but only commits the query after a 300ms pause, so a hybrid keyword+vector search no longer fires on every keystroke. Tags, freshness, and withdrawn remain as refinement filters.

**Why this priority**: Search is the primary way users find datasets, but in 008 it was visually indistinguishable from the tag input and committed on every keystroke — each character fired a relatively expensive hybrid keyword+vector lookup. A prominent, debounced bar is a clear discoverability and efficiency win. It is P2 because the existing search still functioned; this improves prominence and cost, not correctness.

**Independent Test**: Type a multi-character query into the search bar and confirm the dataset list/regions refetch fires once (after the 300ms pause), not once per character; confirm a spinner shows while loading and a clear (✕) button empties the field; confirm "Изчисти всички" (clear-all filters) resets the field text via the external→input sync.

**Acceptance Scenarios**:

1. **Given** the left panel, **When** it renders, **Then** a dedicated search field with a search icon and the placeholder "Търси по дума, тема, издател…" appears above the refinement filters.
2. **Given** the search field, **When** the user types several characters quickly, **Then** the committed query (which drives the fetch) updates only once 300ms after the last keystroke, not on every character.
3. **Given** a search is in flight, **When** the list/regions are loading, **Then** a spinner shows in the field; **When** loading completes, the spinner is replaced by a clear (✕) button if text is present.
4. **Given** text in the search field, **When** the user clicks the clear (✕) button, **Then** the field empties and (after debounce) the query clears.
5. **Given** filters are cleared externally (e.g. "Изчисти всички"), **When** the shared `filters.query` resets, **Then** the search input reflects the empty query.

### Edge Cases

- **Malformed `filters` JSON** on `GET …/rows` — the server ignores the bad `filters` param rather than failing the request (try/catch around `JSON.parse`); only string-valued keys of a plain object are accepted.
- **Resource larger than the scan cap** — sort/filter sees only the first `MAX_GRID_SCAN`=100,000 rows; the response flags `gridTruncated: true` so the UI can warn the result is over a prefix, never silently wrong-by-omission.
- **Blank filter values** — column filters whose trimmed value is empty are dropped client-side (not sent) and ignored server-side, so `isGridActive`/`hasActiveFilters` are false and the cheap page-slice path is used.
- **Non-tabular resource (document/text)** — the reader still renders it full-size (JSON/text `<pre>` grows to fill the reader); sort/filter controls only apply to the tabular view.
- **Sorting equal values** — `sortRows` is stable (decorate-with-index tiebreak), so ties keep their original relative order.
- **Switching resources while the reader is open** — the preview resets sort, instant filters, and applied filters on a `datasetId`/`resourceId` change so state does not leak between resources.
- **Closing the reader vs. selecting a new dataset** — the reader is driven by the store's `reader` target; closing sets it to `null` (map shown) without disturbing the selected dataset/region.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Clicking a resource in the dataset detail list MUST open that resource in a centre **document reader** (`ResourceReader`) that overlays the map area, instead of rendering an inline preview inside the 340px left panel.
- **FR-002**: The centre reader MUST overlay the map without unmounting it (absolute overlay sibling of the map in `<main>`), so closing the reader returns to the map with no re-initialisation flash.
- **FR-003**: The reader MUST show a "← Карта" breadcrumb/close control and the parent dataset's Bulgarian title (`titleBg`); when no resource is open it MUST render nothing (map fully visible).
- **FR-004**: The opened-resource target MUST be held in shared store state (`reader: ReaderTarget | null` with `openReader`/`closeReader`), and the dataset detail list MUST highlight the resource matching the active reader target.
- **FR-005**: The resource preview MUST support a `variant` of `panel` (compact side-panel card) and `reader` (fills the centre reader, scrollable areas grow to fill rather than a fixed cap), reusing one component for both.
- **FR-006**: Tabular resources MUST render a sortable header: clicking a column header cycles its sort unsorted → ascending → descending → unsorted (`cycleSort`), indicates the active direction (▲/▼), and sets `aria-sort` on the header.
- **FR-007**: Tabular resources MUST render a per-column filter row of substring inputs; filter inputs MUST be debounced (300ms) before being applied, and applying a sort or filter MUST reset pagination to offset 0.
- **FR-008**: Sort and per-column filters MUST be applied **server-side over the whole resource** before pagination — `GET …/rows` MUST accept `sort` (column), `dir` (`asc` default | `desc`), and `filters` (URL-encoded JSON `{ "<col>": "<substring>" }`), and `readResourceRows` MUST apply filter→sort to all rows (up to the scan cap) before slicing the requested page.
- **FR-009**: Filtering MUST be case-insensitive substring matching, AND'd across columns, ignoring blank filter values; the response `total` MUST be the filtered row count and the UI MUST show "N от M реда (филтрирани)" with an "изчисти филтрите" clear action when any filter is active.
- **FR-010**: Ordering MUST be numeric-aware: numeric columns order numerically, blank cells sort last, and all other values order by Bulgarian-locale collation (`localeCompare(…, 'bg')`); the server's `isNumeric`/`cellText` MUST mirror the client's `lib/chart.isNumeric` / `lib/table.cellText` so client and server agree.
- **FR-011**: Whole-resource scanning MUST be bounded by `MAX_GRID_SCAN`=100,000 rows; when the resource exceeds the cap the response MUST set `gridTruncated: true` and the UI MUST show a warning that the sort/filter covered only the first 100k rows.
- **FR-012**: A malformed `filters` query value MUST be ignored (not error the request); only string-valued keys of a plain (non-array) JSON object are accepted.
- **FR-013**: Free-text dataset search MUST be promoted to a dedicated, prominent **search bar** (`SearchBar`) at the top of the left panel with a search icon, a clear (✕) button when text is present, and a loading spinner while the list/regions reload — and MUST be removed from the filter panel.
- **FR-014**: The search bar MUST debounce input 300ms before committing the shared `filters.query` (which drives the hybrid keyword+vector dataset search), so the search does not fire on every keystroke; the input MUST reflect external resets of `filters.query`.
- **FR-015**: The sort/filter grid helpers (`cycleSort`, `hasActiveFilters` on the client; `compareCells`, `filterRows`, `sortRows`, `applyGrid`, `isGridActive` on the server) MUST be pure, logic-only modules unit-tested at full coverage.
- **FR-016**: This feature MUST NOT add a database migration, a new portal endpoint, or a new persistent store; it extends the existing `GET …/rows` endpoint with optional query params and reuses the existing read substrate.

### Key Entities *(include if feature involves data)*

- **ReaderTarget** (client store, `apps/explorer-web/src/store/explorerStore.ts`): The resource opened in the centre reader — `{ datasetId, resourceId, name, titleBg }`. `null` when the reader is closed (map shown). Driven by `openReader`/`closeReader`.
- **GridQuery** (client `apps/explorer-web/src/lib/api.ts` + server `src/read/resource-grid.ts`): `{ sort: { col, dir: 'asc'|'desc' } | null, filters: Record<string,string> }`. Serialised onto `/rows` as `sort`/`dir`/`filters` query params; `filters` is a URL-encoded JSON object of column→substring.
- **GridSort** (`apps/explorer-web/src/lib/grid.ts`, `src/read/resource-grid.ts`): `{ col: string, dir: 'asc'|'desc' }`. Header-click state on the client; sort spec on the server.
- **ResourceContent** (`apps/explorer-web/src/types.ts`, `src/read/resource-rows.ts`): Extended with optional `gridTruncated?: boolean` — true when a sort/filter saw only the first `MAX_GRID_SCAN` rows of a larger resource. With a grid, `total` is the filtered count. No other field added; the rest of the read contract is unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Opening a resource renders it in a centre overlay occupying the map area (not the ≤340px side panel), and closing it returns to the map with zero map re-initialisation (the map element is never unmounted) — verified by Playwright E2E.
- **SC-002**: Sorting a numeric column descending on a multi-page resource returns the global maximum row first across the whole resource (verified live against the real mirror on `zaginali_obshto` desc), not merely the maximum of the first loaded page.
- **SC-003**: A per-column filter narrows the result to exactly the rows whose column contains the substring (case-insensitive, AND'd across columns) over the whole resource, and the displayed `total` equals the filtered count (verified live on an age-group filter and by `resource-grid` unit tests).
- **SC-004**: Resources larger than 100,000 rows that are sorted/filtered return `gridTruncated: true` and surface a visible "first 100k" warning, so a truncated result is never presented as complete.
- **SC-005**: Typing an N-character dataset query issues exactly one search fetch (after the 300ms pause), not N fetches — one per keystroke is eliminated.
- **SC-006**: The pure grid logic (`src/read/resource-grid.ts` and `apps/explorer-web/src/lib/grid.ts`) is covered by unit tests asserting numeric ordering, blanks-last, Bulgarian-locale collation, stable sort, case-insensitive AND'd substring filtering, and the header-click cycle; the full suite stays green — all backend/read suites pass with 100% coverage on the new pure modules, plus the Playwright E2E suite — with web typecheck + Biome clean.

## Assumptions

- This is a retrofit: the work is already shipped (PR #13) and verified, so the spec is written in the settled tense and marked Implemented.
- Builds directly on feature 008 (the map data explorer, `apps/explorer-api` + `apps/explorer-web`) and reuses its read substrate (`src/read/resource-rows.ts`, `readResourceRows`) and HTTP API (`GET /api/datasets/:datasetId/resources/:resourceId/rows`).
- No new database migration, no new portal endpoint, and no new persistent store — only an extension of the existing `/rows` endpoint with optional `sort`/`dir`/`filters` query params and a new pure read helper. The 008 `contracts/http-api.md` is updated in place rather than a new contract being introduced.
- Both debounces use the same 300ms window; the dataset-search debounce and the per-column-filter debounce are independent mechanisms operating on different state.
- The scan cap of 100,000 rows is a memory-bound for whole-resource sort/filter, consistent with 008's constraint never to bulk-load million-row resources; beyond it the grid honestly flags truncation.
- WebGL/MapLibre render glue remains covered by 008's sanctioned render-glue exception (Constitution VIII v1.1.1) and behavioral Playwright E2E; this feature adds no new render glue, and all new logic (grid sort/filter, debounce, header-cycle helpers) is pure and covered at 100%.
