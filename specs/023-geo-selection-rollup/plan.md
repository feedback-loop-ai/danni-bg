# Implementation Plan: Region multi-select + hierarchical geo-filter roll-up

**Spec**: [spec.md](./spec.md) · **Status**: Implemented (retrospective for PRs #66/#67 + the chat
geo-scope change). Stack unchanged: Bun + TypeScript monorepo, Hono API, React/Vite/Tailwind SPA,
zustand store, SQLite via the read-only `ReadBridge`. Locked test runner `bun:test`.

## Architecture

Two layers, one new pure module shared between them.

### 1. Selection (frontend — PR #66)

- The selection **is** `filters.geoUnitIds` (no separate `selectedRegionId`). The store exposes
  `selectRegions(ids: string[])` which only rewrites `geoUnitIds`, leaving the other filter arrays'
  refs intact so the choropleth layers (memoized on those refs in `App.tsx`) are not refetched.
- `MapView` computes the next set with full layer context and calls `onSelect(ids)`:
  - country view: Shift = toggle the oblast into the union (no drill); plain = `setFocus` + `[oblast]`.
  - drill-down: start from `selectedGeoIds` minus the focused oblast (FR-096); Shift = toggle the
    municipality; plain = single-select, re-clicking the sole one → `[]`.
- Multi highlight (`selectedBoundaries` set), a single/multi info card, and a `Shift+клик` hint.
- Because selection *is* the filter, the existing filter chips stay in sync for free.

### 2. Roll-up expansion (backend — PR #67 + this change)

- New pure `expandGeoUnitIds(ids, childrenOf)` (`apps/explorer-api/src/geo-rollup.ts`): for each id,
  emit it plus its children from `childrenOf`; leaves/unknowns pass through; de-duplicated. The empty
  input is returned as-is (no work).
- `ReadBridge.partOfChildren()` builds the inverse of `partOfParents()` (oblast → child municipality
  ids) from the `part_of` edges — the same graph that powers the choropleth roll-up (spec 013).
- **Explorer** (`app.ts`): `childrenOf()` is memoized per process (the graph is static at runtime).
  `expandGeo(f)` returns `f` unchanged when `geoUnitIds` is empty, else expands. It is applied inside
  `scopedLites` (covering the list, facets, national, and regions) and once in the keyword-search
  branch of `/api/datasets`.
- **Chat** (`routes/chat.ts`): the request `scope.geoUnitIds` is expanded once at the entry point
  (before `runChatTurn`), so both the hard scope filter (`inScope` → `scope-filter.matchesFilters`)
  and the region-datasets fallback in `run.ts` consume the expanded set.

## Why this shape

- **Single source of truth for selection** avoids the stale-`selectedRegionId` class of bug and makes
  the chips/highlight consistency automatic.
- **Expand at the boundary, not in the matcher.** The matchers (`matchesFiltersLite`,
  `scope-filter.matchesFilters`) stay pure and unchanged; only the `geoUnitIds` they receive grows.
  This keeps the roll-up in exactly one tested place and out of every hot per-dataset comparison.
- **Mirror the count source.** Filtering uses the same `part_of` graph the choropleth roll-up uses, so
  the count and the filter can't drift.

## Testing

- Pure unit: `geo-rollup.test.ts` (expand oblast→children, leaf/unknown pass-through, de-dup union,
  empty-array identity). Store: `explorerStore.test.ts` (selectRegions set/clear/union).
- Live verification (hermetic suite stays offline per Constitution VI; these are manual `:8790`
  checks): explorer list 128→638 for an oblast, 33 for a municipality; headless multi-select unions;
  chat under an oblast scope grounding on a municipality's datasets.
- Full suites green: 181 explorer-api `bun:test`, web unit tests, tsc + biome.

## Risks / tradeoffs

- The `childrenOf` memo assumes a static graph for the process lifetime (true for the read-only
  explorer; a curate pass requires a restart, already the norm).
- Recall under a tight chat scope is unchanged (see spec Out of scope): the expansion corrects filter
  semantics, not the tool-loop's global-ranking recall.
