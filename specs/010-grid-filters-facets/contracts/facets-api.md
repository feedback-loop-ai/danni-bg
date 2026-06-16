# Contract: Facets endpoint + resource-grid query params

**Feature**: 010-grid-filters-facets · **Service**: `apps/explorer-api` (Bun + Hono)

Contract-first per Constitution III. Each endpoint/param here has Vitest contract coverage over mirror fixtures, registered in `tests/parity-matrix.json` (Constitution VIII). Inputs are validated with Zod `filterStateSchema` (`.strict()`, Constitution VII). Responses are UTF-8 JSON. Authoritative Bulgarian tag/publisher labels are returned verbatim (Constitution X).

Shared error envelope (unchanged from feature 008):
```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```
Codes used here: `bad_request` (400, Zod failure), `not_found` (404, unknown dataset/resource), `internal` (500).

---

## GET /api/facets

Returns the available filter options with in-scope counts; drives the faceted sidebar.

**Query** (all optional — the shared FilterState params, identical to `/api/datasets`):

| param | type | repeatable | notes |
|-------|------|-----------|-------|
| `tags` | string | yes | tag label strings |
| `publisherIds` | string | yes | publisher/org ids |
| `geoUnitIds` | string | yes | geo entity ids |
| `freshness` | `fresh \| stale \| any` | no | default `any` |
| `q` | string | no | free-text query |
| `includeWithdrawn` | `true` | no | include withdrawn datasets when `true` |

Counts reflect the supplied filters (conjunctive faceting): they are computed over the same in-scope dataset set (`scopedLites`) used by `/api/datasets`, `/api/regions`, and `/api/national`, so they are consistent across those views (FR-018, SC-007).

**200**:
```json
{
  "tags": [
    { "id": "въздух", "labelBg": "въздух", "count": 12 }
  ],
  "publishers": [
    { "id": "org:egov-org-61", "labelBg": "Изпълнителна агенция по околна среда", "count": 7 }
  ],
  "freshnessBuckets": [
    { "id": "fresh", "count": 980 },
    { "id": "stale", "count": 41 }
  ]
}
```

Notes:
- Tag `id` equals its `labelBg` (the BG tag string); the sidebar ticks this value into `FilterState.tags`.
- A publisher with no source title falls back to its id as `labelBg` (FR-019); it is never blank.
- `freshnessBuckets` always contains exactly `fresh` and `stale` entries (counts may be 0).
- A facet value with zero in-scope datasets given the current filters does not appear.

**400**: `bad_request` when a filter param fails `filterStateSchema` (e.g. an unknown extra key under `.strict()`), with the Zod issues under `details`.

---

## GET /api/datasets/:datasetId/resources/:resourceId/rows — grid query params

The existing resource-rows route (feature 008) gains **optional** server-side grid params. Absent params preserve the prior behavior exactly (a plain page slice).

| param | type | default | notes |
|-------|------|---------|-------|
| `limit` | int | 100 | clamped to [0, 1000] |
| `offset` | int | 0 | clamped to ≥ 0 |
| `sort` | string | — | column to sort by; absent = original order |
| `dir` | `asc \| desc` | `asc` | only meaningful with `sort`; any non-`desc` value is treated as `asc` |
| `filters` | JSON string | — | `{ "<col>": "<substring>" }`; blank values ignored; **malformed JSON is ignored, not an error** |

**Semantics**:
- Sort + filter are applied server-side over the whole resource up to `MAX_GRID_SCAN = 100_000` rows, then paginated (filter-then-sort).
- Filtering is case-insensitive substring match on the cell's text form. Sorting is numeric when both compared cells are numeric, else Bulgarian-collated (`localeCompare(..., 'bg')`), blanks last.
- Applying a sort/filter is expected to be requested with `offset=0` (the client resets paging); subsequent `offset>0` requests append in the same order.

**200** (`ResourceContent`, grid-relevant fields):
```json
{
  "datasetId": "…",
  "resourceId": "…",
  "kind": "tabular",
  "rows": [ { "…": "…" } ],
  "total": 1234,
  "limit": 50,
  "offset": 0,
  "truncated": false,
  "gridTruncated": false
}
```
- `total` is the post-filter matching row count (drives the pager and the "N от total реда (филтрирани)" label).
- `gridTruncated: true` when the resource exceeds `MAX_GRID_SCAN`, so the sort/filter saw only the first 100k rows (UI shows a "· върху първите 100k" notice — FR-006).
- A filter matching zero rows returns `rows: []` with the table `kind` preserved; the client renders an empty table, never a raw `[]` JSON fallback (FR-009).

**404**: `not_found` when the dataset or resource does not exist.
