# Quickstart: Excel-style grid filters/sort + faceted search panel

**Feature**: 010-grid-filters-facets · **Status**: Implemented (PR #14)

This refines the explorer from feature 008; the dev/run setup is the same. Below is how to exercise the grid sort/filter, the `/api/facets` endpoint, and the faceted sidebar, plus how to run this feature's tests.

## Prerequisites

- Bun 1.x; a populated local mirror (`bun:sqlite` store) — the explorer reads from it (crawl pipeline: sync → curate → index).
- From the repo root: `bun install`.

## Run the explorer

```bash
# Backend API (Hono) — serves /api/facets, /api/datasets/:id/resources/:rid/rows, etc.
cd apps/explorer-api && bun run dev

# Frontend SPA (React + Vite) — serves the grid + faceted sidebar
cd apps/explorer-web && bun run dev
```

Open the SPA, pick a region or dataset, and open a tabular resource to reach the grid.

## Exercise the resource grid (US1, US3)

In the open resource grid:

1. **Sort**: click a column header — rows reorder ascending (▲), click again for descending (▼), a third click clears the sort. Sorting acts over the whole resource, not just the loaded page.
2. **Filter**: click the funnel icon on a header, type a substring; after a ~300ms debounce only matching rows remain and the funnel highlights. The footer shows `N от <total> реда (филтрирани)`.
3. **Load more**: with a sort/filter active, click "Зареди още" — the next page appends in the same order.
4. **Empty result (US3)**: type a filter that matches nothing — the header stays and "Няма съвпадения за филтъра." is shown (never a raw `[]`); click "изчисти филтрите" to restore.
5. **Large resource**: on a resource over 100k rows, sort/filter shows a "· върху първите 100k" notice.

## Hit `/api/facets` directly (US2)

```bash
# All facets over the full catalog
curl 'http://localhost:3000/api/facets'

# Facets narrowed by an active tag (counts reflect conjunctive faceting)
curl 'http://localhost:3000/api/facets?tags=въздух'

# Facets within a publisher + freshness scope
curl 'http://localhost:3000/api/facets?publisherIds=org:egov-org-61&freshness=fresh'
```

Expect `{ tags: [...], publishers: [...], freshnessBuckets: [{id:'fresh',count},{id:'stale',count}] }`. Counts must match what `/api/datasets` returns for the same filter params.

## Exercise the resource-grid query params directly

```bash
# Sort a resource by a column, descending
curl 'http://localhost:3000/api/datasets/<dsId>/resources/<rid>/rows?sort=<col>&dir=desc&limit=50'

# Filter a resource by a column substring
curl 'http://localhost:3000/api/datasets/<dsId>/resources/<rid>/rows?filters={"<col>":"софия"}&limit=50'

# Malformed filters are ignored (returns the plain page, not an error)
curl 'http://localhost:3000/api/datasets/<dsId>/resources/<rid>/rows?filters=not-json'
```

## Exercise the faceted sidebar (US2)

- Tag/publisher facets list values with counts, top-8 + "Покажи още N"; the tag facet has a "намери таг…" search-within box.
- Tick values — the map/list narrows and facet counts update.
- Freshness is a segmented control (Всички / Актуални / Остарели) with bucket counts + an "Включи оттеглени набори" toggle.
- Active filters appear as removable chips; "Изчисти всички" clears all.

## Tests

```bash
# Pure server-side grid logic (filter/sort/compare, scan cap) — 100% line+branch
bun test tests/unit/read/resource-grid.test.ts

# Client grid helpers (sort cycle, hasActiveFilters)
bun test apps/explorer-web/src/lib/grid.test.ts

# Contract test for /api/facets + grid query params (mirror fixtures), per parity matrix
bun test apps/explorer-api

# E2E journeys (faceted filter + linked map); the line-chart E2E (us8) was removed with the chart
bun run --cwd apps/explorer-web e2e
```

## Notes

- No new persistent storage; grid/facet UI state is session-scoped client state.
- The chart ("Графика") view, `lib/chart.ts`/`chart.test.ts`, and `e2e/us8-line-chart.e2e.ts` were deleted in this feature — there is no chart toggle to find.
