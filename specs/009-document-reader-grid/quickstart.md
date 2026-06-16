# Quickstart: Centre document reader + debounced search + server-side grid

**Feature**: 009-document-reader-grid | **Status**: Implemented (PR #13)

Builds on the 008 explorer. Assumes a populated mirror store (see `specs/008-map-data-explorer/quickstart.md` and the crawl pipeline: sync → curate → index).

## Run the explorer

```bash
# Backend (Hono API) + web (Vite SPA) — same dev flow as 008.
bun run --cwd apps/explorer-api dev      # serves /api/* incl. the /rows grid endpoint
bun run --cwd apps/explorer-web dev      # serves the SPA
```

Open the SPA, ensure the map has data (the map fills only after `index`).

## Try it

### 1. Centre document reader

1. Pick a region/dataset; the left panel shows dataset metadata + a resource list.
2. Click a resource. It opens **full-size in the centre, overlaying the map**, with a "← Карта" breadcrumb and the dataset's Bulgarian title.
3. Click "← Карта". The reader closes and the map reappears **instantly** (it was never unmounted).

### 2. Debounced dataset search

1. Type a query into the prominent search bar at the top of the left panel.
2. Watch the network panel: the dataset/regions fetch fires **once** 300ms after you stop typing, not per keystroke. A spinner shows while loading; a ✕ clears the field.

### 3. Server-side grid sort + filter

1. Open a tabular resource in the reader.
2. Click a numeric column header to cycle sort: unsorted → ▲ asc → ▼ desc → unsorted. The first row is the global max/min across the **whole** resource, not just the loaded page.
3. Type a substring into a column's filter input. After the 300ms debounce the count reads "N от M реда (филтрирани)" and "изчисти филтрите" appears. Filters across columns are AND'd.
4. On a resource larger than 100k rows, a "· върху първите 100k" warning shows when sorting/filtering.

### Verify the endpoint directly

```bash
# Sort a column descending over the whole resource:
curl 'http://localhost:<port>/api/datasets/<id>/resources/<rid>/rows?limit=50&sort=zaginali_obshto&dir=desc'

# Filter (URL-encoded JSON {"col":"substr"}); response.total is the filtered count:
curl 'http://localhost:<port>/api/datasets/<id>/resources/<rid>/rows?filters=%7B%22pol%22%3A%22%D0%BC%22%7D'
```

## Tests

```bash
# Pure server-side grid logic (numeric/locale ordering, blanks-last, substring AND filter, scan cap):
bun test tests/unit/read/resource-grid.test.ts

# Pure client grid helpers (header-click cycle, active-filter check):
bun test apps/explorer-web/src/lib/grid.test.ts

# Full read + backend suites and web checks (as run for PR #13):
bun test                                  # all backend/read suites pass (100% coverage on the new pure modules)
bun run --cwd apps/explorer-web typecheck # clean
bunx biome check apps/explorer-web        # clean
# Playwright E2E (full suite green): reader open/close, sort/filter behaviour
bun run --cwd apps/explorer-web e2e
```

## Manual verification done for PR #13

Verified live against the real mirror: sorting `zaginali_obshto` descending and applying an age-group (`vazrastova_grupa`) filter both produced correct results over the full resource (not just the loaded page).
