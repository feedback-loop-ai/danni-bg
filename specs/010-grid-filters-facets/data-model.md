# Phase 1 Data Model: Excel-style grid filters/sort + faceted search panel

**Feature**: 010-grid-filters-facets · **Status**: Implemented (PR #14)

These are view-model / request shapes, not persisted entities — this feature adds no storage. Types are defined in `apps/explorer-api/src/schemas.ts` (Facets/FacetItem), `src/read/resource-grid.ts` (GridQuery/GridSort, the server source of truth), and mirrored on the client in `apps/explorer-web/src/lib/grid.ts` and `apps/explorer-web/src/types.ts`.

## GridSort

The active column sort on a resource grid.

| Field | Type | Notes |
|-------|------|-------|
| `col` | `string` | The column being sorted (a key of the row record). |
| `dir` | `'asc' \| 'desc'` | Sort direction. |

Header-click cycle (client `cycleSort`): `null` → `{col, 'asc'}` → `{col, 'desc'}` → `null`. Clicking a different column starts that column at `asc`.

## GridQuery

A per-resource sort/filter request, applied server-side before pagination.

| Field | Type | Notes |
|-------|------|-------|
| `sort` | `GridSort \| null` | `null` = original order. |
| `filters` | `Record<string, string>` | column → substring; blank values are ignored. |

**Semantics** (`src/read/resource-grid.ts`):
- `filterRows`: keep rows where, for every active (non-blank) filter, the cell's text form (`cellText`) contains the substring, case-insensitively.
- `sortRows`: stable sort; `compareCells` is numeric when both cells are numeric (`isNumeric`), else `localeCompare(..., 'bg')`; blank cells sort last; ties broken by original index.
- `applyGrid` = `sortRows(filterRows(rows, filters), sort)` (filter then sort).
- `isGridActive` = a sort is set OR any filter is non-blank (lets the cheap page-slice path stay when no grid is requested).
- `MAX_GRID_SCAN = 100_000`: rows scanned beyond this are not seen by the grid; the reader sets `gridTruncated`.

## ResourceContent (grid-relevant fields)

The rows-route payload (`src/read/resource-rows.ts`, mirrored in `apps/explorer-web/src/types.ts`). Only the grid-relevant additions are shown; the rest (freshness, kind, document/text variants) is unchanged from feature 008.

| Field | Type | Notes |
|-------|------|-------|
| `rows` | `unknown[]` | The current page of (filtered, sorted) rows. |
| `total` | `number` | Total matching rows (post-filter) for the pager. |
| `limit` / `offset` | `number` | Pagination window. |
| `gridTruncated` | `boolean?` | True when sort/filter saw only the first `MAX_GRID_SCAN` rows of a larger resource. |

Content kind is decided by shape: `text` present → text; else `document` present → JSON document; else → table (even when `rows` is empty). This is what prevents the zero-match `[]` fallback (FR-009).

## FacetItem

One selectable facet value (`apps/explorer-api/src/schemas.ts`).

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` | Stable id. For tags this equals the BG label string; for publishers it is the org id. |
| `labelBg` | `string` | Bulgarian display label (verbatim; publisher falls back to id when title missing — FR-019). |
| `labelEn` | `string \| null?` | Optional English label. |
| `count` | `number` | In-scope dataset count carrying this value. |

## Facets

The `/api/facets` projection (`apps/explorer-api/src/schemas.ts`).

| Field | Type | Notes |
|-------|------|-------|
| `tags` | `FacetItem[]` | Tag facets with in-scope counts (id = labelBg = tag string). |
| `publishers` | `FacetItem[]` | Publisher facets with in-scope counts. |
| `freshnessBuckets` | `{ id: string; count: number }[]` | `{id:'fresh'}` and `{id:'stale'}` counts over the in-scope set. |

All counts are computed over `scopedLites(filterState)` — the same in-scope set the dataset/region/national endpoints use — giving conjunctive faceting (counts narrow as filters are added) and cross-endpoint consistency (FR-014, FR-018, SC-007).

## FilterState (reused, unchanged)

The shared filter object from feature 008 (`filterStateSchema`, `apps/explorer-api/src/schemas.ts`): `tags: string[]`, `publisherIds: string[]`, `geoUnitIds: string[]`, `freshness: 'fresh'|'stale'|'any'`, `query: string`, `includeWithdrawn: boolean`. `/api/facets` validates and counts against it; the sidebar reads/writes it via the Zustand `explorerStore`. The tag facet ticks values into `tags` by their BG label string.

## Filter Chip (client-only)

A removable representation of one active filter in the sidebar (`apps/explorer-web/src/lib/filters.ts` `toChips` / `removeChip`). Each chip has a `kind` (`tag` | `publisher` | `freshness` | `geo`) and a `value`; the panel localizes the label (publisher id → title via facets, freshness → BG word, geo id → region label via injected `geoLabel`). Not persisted.
