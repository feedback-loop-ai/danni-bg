# Contract: Resource rows endpoint — server-side grid (sort + filter)

**Feature**: 009-document-reader-grid | **Status**: Implemented (PR #13)

This feature extends the existing 008 endpoint rather than adding a new one. The authoritative contract lives in `specs/008-map-data-explorer/contracts/http-api.md` (updated in PR #13); this file restates the grid-specific surface for traceability.

## GET /api/datasets/:datasetId/resources/:resourceId/rows

Paginated/sampled resource rows. Thin pass-through to `readResourceRows` (`src/read/resource-rows.ts`). Never bulk-loads million-row resources.

### Query parameters

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | int | 100 | Clamped 1–1000. |
| `offset` | int | 0 | Page offset into the (filtered/sorted) result. |
| `sort` | string | — | Column name to sort by. Omit for no sort. |
| `dir` | `asc` \| `desc` | `asc` | Sort direction. Any value other than `desc` is treated as `asc`. |
| `filters` | JSON string | — | URL-encoded JSON object `{ "<col>": "<substring>" }`. Case-insensitive substring match, AND'd across columns. |

**Server-side grid semantics** (applied to the whole resource *before* pagination, so sort/filter cover the full dataset — not just the requested page):

- Ordering is **numeric-aware**: numeric columns order numerically, blank cells sort last, everything else uses Bulgarian-locale collation (`localeCompare(value, 'bg')`). The sort is stable.
- Filtering is **case-insensitive substring**, AND'd across the supplied columns; blank filter values are ignored.
- The scan is capped at `MAX_GRID_SCAN` = **100,000** rows. For larger resources the sort/filter sees only the first 100k rows and the response sets `gridTruncated: true`.
- `filters` is parsed in a try/catch: **malformed JSON is ignored** (the request still succeeds with no filtering). Only string-valued keys of a plain (non-array) object are accepted.
- When neither `sort` nor any non-blank `filter` is present, the cheap unmodified page-slice path is used and `gridTruncated` is omitted.

### Response 200

```jsonc
{
  "kind": "tabular",            // or "document" | "text"
  "rows": [ /* page of objects, after server-side filter+sort */ ],
  "document": { /* ... */ },    // non-tabular
  "text": "…",                  // non-tabular
  "total": 1234,                // FILTERED row count when a grid is active
  "limit": 100,
  "offset": 0,
  "truncated": true,            // more rows exist beyond this page within the result
  "gridTruncated": true,        // OPTIONAL: sort/filter saw only the first 100k rows
  "freshness": { /* last_synced_at, source_last_modified?, is_stale */ }
}
```

`gridTruncated` is absent unless a grid was active over a resource larger than the scan cap.

### Examples

Sort a column descending over the whole resource:

```
GET /api/datasets/<id>/resources/<rid>/rows?limit=50&offset=0&sort=zaginali_obshto&dir=desc
```

Filter two columns (substring, AND'd):

```
GET /api/datasets/<id>/resources/<rid>/rows?filters=%7B%22vazrastova_grupa%22%3A%2218%22%2C%22pol%22%3A%22%D0%BC%22%7D
```

(decoded `filters` = `{"vazrastova_grupa":"18","pol":"м"}`)

### Internal pass-through

`apps/explorer-api/src/app.ts` parses `sort`/`dir`/`filters` into a `GridQuery` and calls `ReadBridge.rows(datasetId, resourceId, limit, offset, grid)` → `readResourceRows(db, storeRoot, datasetId, resourceId, { limit, offset, grid })`, which delegates filter→sort to `applyGrid` in `src/read/resource-grid.ts`.

## Traceability

- Pure server logic + tests: `src/read/resource-grid.ts`, `tests/unit/read/resource-grid.test.ts`.
- Endpoint wiring: `apps/explorer-api/src/app.ts`, `apps/explorer-api/src/read-bridge.ts`, `src/read/resource-rows.ts`.
- Client serialisation: `apps/explorer-web/src/lib/api.ts` (`fetchResourceRows`).
- This feature consumes no new data.egov.bg portal endpoint, so no new portal-parity contract test is required (Constitution VIII parity applies to portal endpoints; this is an internal HTTP read endpoint covered by the read-layer unit tests + Playwright E2E).
