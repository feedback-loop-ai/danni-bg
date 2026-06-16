# Research: Centre document reader + debounced search + server-side grid

**Feature**: 009-document-reader-grid | **Status**: Implemented (PR #13) | **Date**: 2026-06-12

Phase 0 decisions. This is a retrospective record: each decision is stated as shipped, with the rationale and the alternative that was rejected.

## R1 — Reader overlays the map (map stays mounted) rather than replacing/unmounting it

**Decision**: Render the centre document reader (`ResourceReader`) as an absolute overlay (`absolute inset-0 z-[5]`) inside the existing centre `<main>`, as a sibling of the MapLibre container. The map is **kept mounted underneath**; the reader returns `null` when no resource is open.

**Rationale**: MapLibre re-initialisation (GL context, style load, layer/source wiring) is expensive and visibly flashes. Keeping the map mounted makes closing the reader instant and avoids re-fetching boundaries. An overlay also keeps the left/right panels and their state intact.

**Rejected alternative**: Conditionally swapping the map for the reader (unmount map → mount reader). Rejected because it reintroduces the GL re-init flash and discards map state on every open/close.

## R2 — One `ResourcePreview` component, two variants (`panel` | `reader`)

**Decision**: Reuse the existing `ResourcePreview` for both the compact side-panel card and the full-size centre reader, switching layout via a `variant: 'panel' | 'reader'` prop. In `reader` mode the scrollable data areas grow (`min-h-0 flex-1`) instead of the fixed `max-h-80` cap, and the container becomes a flex column.

**Rationale**: The data-rendering logic (table/chart/document detection, sort, filter, CSV/chart controls) is identical in both contexts; duplicating it into a second component would double the surface to maintain and risk drift. A single layout switch (Constitution V, Simplicity) is the minimal change.

**Rejected alternative**: A separate `ReaderBody` component duplicating the render branches. Rejected as redundant and drift-prone.

## R3 — Sort/filter applied server-side over the whole resource, not on the loaded page

**Decision**: Sort and per-column filter are applied in the read layer (`src/read/resource-grid.ts` invoked by `readResourceRows`) to **all** rows of the resource before the requested page is sliced. `GET …/rows` accepts `?sort=<col>&dir=asc|desc&filters=<json>`; the response `total` is the filtered count.

**Rationale**: Client-side sort/filter over only the loaded page is misleading — the "top" row would be the top of the current page, not the resource, producing silently wrong answers (Constitution I/IX: faithful, honest data). Doing it server-side over the whole resource is the only correct behaviour for questions like "highest PM10 station".

**Rejected alternative**: Sort/filter the rows already fetched in the browser. Rejected because it gives incorrect global results and breaks pagination semantics.

## R4 — Bounded scan (100k) with an explicit `gridTruncated` flag

**Decision**: Whole-resource sort/filter scans at most `MAX_GRID_SCAN`=100,000 rows. When the resource is larger, the response sets `gridTruncated: true` and the UI shows a "върху първите 100k" warning.

**Rationale**: Resources can reach ~1.25M rows; an unbounded in-memory sort would blow memory and violate 008's "never bulk-load million-row resources" constraint. A bounded scan keeps it cheap, and the truncation flag keeps it honest — a partial result is never presented as complete (Constitution IX, no silent staleness/omission).

**Rejected alternative**: Unbounded scan, or silent truncation with no flag. Rejected for memory and honesty reasons respectively.

## R5 — Two independent 300ms debounces (dataset search; per-column filter)

**Decision**: Both the dataset search bar and the grid filter row debounce input by 300ms via local `useEffect`+`setTimeout` timers. The search bar commits the shared `filters.query`; the grid commits per-column `appliedFilters` and resets the page offset to 0. They are independent mechanisms on different state.

**Rationale**: The dataset search is a hybrid keyword+vector lookup that is relatively expensive per call; firing it on every keystroke wastes work. The grid filter hits the server too. A short debounce collapses a burst of keystrokes into one request while keeping the input responsive (the input updates instantly; only the committed value lags). 300ms is a standard, barely-perceptible pause.

**Rejected alternative**: A shared debounce hook/util. Rejected as premature abstraction (Constitution V) for two call sites with slightly different commit logic (one resets pagination, one syncs from external query state).

## R6 — Client/server numeric + locale parity for ordering

**Decision**: `src/read/resource-grid.ts` re-implements `isNumeric` and `cellText` to mirror the client's `lib/chart.isNumeric` and `lib/table.cellText`. Comparison: numbers numerically, blank cells last, everything else by `localeCompare(…, 'bg')`. Sort is stable (decorate with original index, tiebreak on it).

**Rationale**: The grid header and chart controls on the client already classify columns as numeric; the server must agree or the sort would reorder columns the user thinks are numbers as text (and vice versa). Bulgarian-locale collation is required for correct Cyrillic ordering (Constitution X). Stability keeps equal rows in a deterministic order across pages.

**Rejected alternative**: Default `Array.sort` lexical compare, or importing the client helpers into the server. Rejected because lexical compare mis-orders numbers and Cyrillic, and the client `lib/*` modules live in the web package (not importable from `src/read`); a tiny mirrored copy with a comment noting the parity requirement is simpler than a shared package for two ~5-line functions.

## Cross-cutting notes

- **No new persistence/contract surface**: the change extends the existing `/rows` endpoint with optional query params and adds an optional `gridTruncated` response field. No migration, no new portal endpoint, no new store. The 008 `contracts/http-api.md` was updated in place.
- **Malformed input tolerance**: the `filters` param is parsed in a try/catch; bad JSON is ignored rather than failing the request, and only string-valued keys of a plain object are accepted (Constitution IV, actionable/robust boundaries).
