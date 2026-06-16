# Data Model: Centre document reader + debounced search + server-side grid

**Feature**: 009-document-reader-grid | **Status**: Implemented (PR #13)

No database schema or migration changes. This feature adds in-memory client state and pure value shapes, plus one optional field on the existing rows read contract. All shapes below are the actual TypeScript shipped in PR #13.

## Client state

### ReaderTarget (`apps/explorer-web/src/store/explorerStore.ts`)

The resource currently opened in the centre document reader. `null` when the reader is closed (map shown).

```ts
export interface ReaderTarget {
  datasetId: string;
  resourceId: string;
  name: string;
  /** Parent dataset title, shown as the reader's breadcrumb. */
  titleBg: string;
}
```

Store additions:

- `reader: ReaderTarget | null` — the active reader target (initial `null`).
- `openReader: (target: ReaderTarget) => void` — `set({ reader })`.
- `closeReader: () => void` — `set({ reader: null })`.

`DatasetDetail` calls `openReader({ datasetId, resourceId, name, titleBg })` on resource click and highlights the resource whose `reader.datasetId`/`reader.resourceId` match.

### Grid header state (local to `ResourcePreview`)

- `sort: GridSort | null` — current column sort (header-click cycle).
- `colFilters: Record<string,string>` — instant per-column filter inputs (updates on keystroke).
- `appliedFilters: Record<string,string>` — debounced filters actually sent to the server (300ms after the last keystroke); applying resets `offset` to 0.

### Search input state (local to `SearchBar`)

- `text: string` — the instant input value, seeded from and re-synced to the shared `filters.query`.
- Debounced commit (300ms) writes `text` into the shared `filters.query` via `updateFilters`.

## Pure value shapes

### GridSort / SortDir

Defined identically (by structure) on client (`apps/explorer-web/src/lib/grid.ts`) and server (`src/read/resource-grid.ts`):

```ts
export type SortDir = 'asc' | 'desc';
export interface GridSort { col: string; dir: SortDir; }
```

### GridQuery

Client (`apps/explorer-web/src/lib/api.ts`) and server (`src/read/resource-grid.ts`):

```ts
export interface GridQuery {
  sort: GridSort | null;
  filters: Record<string, string>; // column -> substring
}
```

Client → server serialisation (in `fetchResourceRows`): `sort.col` → `sort`, `sort.dir` → `dir`; non-blank `filters` → `filters` as URL-encoded JSON. The route parses these back into a `GridQuery` (tolerating malformed `filters`).

## Pure functions

### Client helpers (`apps/explorer-web/src/lib/grid.ts`)

- `cycleSort(current: GridSort | null, col: string): GridSort | null` — header-click cycle: unsorted → asc → desc → unsorted; resets to asc when a different column is clicked.
- `hasActiveFilters(filters: Record<string,string>): boolean` — true when any filter value is non-blank (trimmed).

### Server helpers (`src/read/resource-grid.ts`)

- `MAX_GRID_SCAN = 100_000` — largest number of rows scanned for a sort/filter.
- `compareCells(a, b): number` — numbers numerically; else by `cellText`, blanks last, otherwise `localeCompare(…, 'bg')`.
- `filterRows(rows, filters): unknown[]` — keeps rows where every non-blank column filter is a case-insensitive substring of the cell text (AND across columns); returns the input array when no active filters.
- `sortRows(rows, sort): unknown[]` — stable sort by `compareCells` on the sort column; returns the input array when `sort` is `null`.
- `applyGrid(rows, query): unknown[]` — `sortRows(filterRows(rows, query.filters), query.sort)` (filter then sort).
- `isGridActive(query): boolean` — true when a sort or any non-blank filter is requested (so the cheap page-slice path can be skipped only when needed).

Helper internals (mirror the client): `isNumeric(value)` (finite number, or non-blank numeric string) and `cellText(value)` (`''` for null/undefined, `JSON.stringify` for objects, else `String`).

## Read contract change

### ResourceContent (`src/read/resource-rows.ts`, mirrored in `apps/explorer-web/src/types.ts`)

One optional field added; everything else unchanged.

```ts
export interface ResourceContent {
  // …existing: kind, rows?, document?, text?, total, limit, offset, truncated, freshness…
  /** True when a sort/filter saw only the first MAX_GRID_SCAN rows of a larger resource. */
  gridTruncated?: boolean;
}
```

`ReadResourceOptions` gains an optional `grid?: GridQuery`.

### readResourceRows behaviour

For `kind === 'tabular'` when `isGridActive(grid)`:

1. Take the first `MAX_GRID_SCAN` lines, parse each JSON row.
2. `view = applyGrid(all, grid)` (filter → sort over the whole scanned set).
3. Return `rows = view.slice(offset, offset + limit)`, `total = view.length`, `truncated = offset + limit < view.length`, `gridTruncated = lines.length > MAX_GRID_SCAN`.

When no grid is active, the existing cheap page-slice path is used unchanged.

## Relationships

- `DatasetDetail` (resource list) → `openReader` → store `reader` → `ResourceReader` (centre overlay) → renders `ResourcePreview variant="reader"`.
- `ResourcePreview` header/filter state → `fetchResourceRows(..., { sort, filters })` → `/rows` → `ReadBridge.rows(..., grid)` → `readResourceRows(..., { grid })` → `applyGrid` in `resource-grid.ts`.
- `SearchBar` → debounced `updateFilters(query)` → shared `filters.query` → dataset list/regions refetch in `App`.
