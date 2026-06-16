# Implementation Plan: Excel-style grid filters/sort + faceted search panel

**Branch**: `010-grid-filters-facets` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/010-grid-filters-facets/spec.md`

**Status**: Implemented — shipped in PR #14 (`feat: spreadsheet grid (sort/filter, no charts) + faceted search panel`). This is a retrospective plan documenting merged work.

## Summary

Two stacked UX improvements to the map data explorer (feature 008), both delivered in PR #14:

1. **Spreadsheet resource grid** — the tabular drilldown gains header-click sorting (cycle asc → desc → off) and Excel-style per-column filter funnels. Sort and filter run **server-side over the whole resource** (up to a 100k-row scan cap) so the controls are correct beyond the loaded page. The chart ("Графика") view is **removed** entirely (Constitution V: dead code is negative value), leaving table / JSON-document / text rendering chosen by content shape — which also fixes a glitch where a zero-match filter rendered raw `[]` JSON instead of an empty table.

2. **Faceted search panel** — the "type an exact tag" filter is replaced with a faceted sidebar (tag + publisher multi-select facets with per-value counts, top-N + "show more" + search-within, a localized freshness segmented control with bucket counts, collapsible sections, and removable active-filter chips). It is backed by a new **`GET /api/facets`** endpoint that computes in-scope counts over the same dataset set the list/region/national endpoints use (conjunctive faceting).

**Technical approach**: Pure sort/filter logic added server-side in `src/read/resource-grid.ts` (filter-then-sort, numeric-aware, Bulgarian collation, 100k scan cap) and threaded through `readResourceRows` → the explorer `ReadBridge.rows` → the existing `GET /api/datasets/:id/resources/:rid/rows` route via new optional `sort`/`dir`/`filters` query params. The web grid (`ResourcePreview.tsx`) gains header sort + funnel popovers, debounced filter input, and a content-shape decision that no longer depends on row count. A new `GET /api/facets` route aggregates tags/publishers/freshness over `scopedLites(filters)`. The `FilterPanel.tsx` sidebar is rebuilt against `fetchFacets`. No new persistent store; all UI state is session-scoped.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x (backend + tooling); same TS for the React frontend
**Primary Dependencies**: Backend — Hono (HTTP), Zod (`filterStateSchema` boundary validation), reuse of in-repo `src/read` (`resource-rows.ts`, new `resource-grid.ts`). Frontend — React + Vite, Zustand (shared filter store `explorerStore`), lucide-react icons (Filter/ArrowUp/ArrowDown/ChevronDown), Tailwind UI primitives
**Storage**: Read-only reuse of the existing `bun:sqlite` mirror store via `src/read`. No new persistent storage. Grid/facet UI state is in-memory, session-scoped
**Testing**: Vitest (+ @vitest/coverage-v8) at 100% line+branch for the pure grid logic (`tests/unit/read/resource-grid.test.ts`) and the client grid helpers (`apps/explorer-web/src/lib/grid.test.ts`); Playwright E2E for the filter/grid journeys (`us2-filters`, `us5-linked`, `us6-drilldown`; `us8-line-chart` retired with the chart view)
**Target Platform**: Self-hostable Linux service (Bun backend serving the static SPA), desktop-first modern browsers
**Project Type**: Web application (React SPA `apps/explorer-web` + Hono API `apps/explorer-api`) layered on the existing MCP-mirror monorepo
**Performance Goals**: Facet/filter updates reflected ≤2s for typical combinations (SC-004); server-side grid sort/filter bounded by a 100,000-row scan cap so even ~1.25M-row resources stay responsive (with a truncation indicator)
**Constraints**: Read-only and faithful to authoritative data (no fabrication, no rewriting of authoritative BG tag/publisher labels — Constitution X); Cyrillic-safe substring filter + collation (`localeCompare(..., 'bg')`); honest about partial coverage on huge resources (`gridTruncated`); malformed grid query ignored, not fatal
**Scale/Scope**: Whole-catalog facets over the ~11k-dataset mirror via the bulk `listLite()` projection (not per-dataset fan-out); resources up to ~1.25M rows; 3 user stories (P1, P1, P2), 19 functional requirements

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. AI-Native / read-only, faithful | ✅ Pass | Grid + facets only read the mirror via `src/read`; no mutation; authoritative tag/publisher labels passed through verbatim |
| II. Spec-Driven Development | ✅ Pass | spec → plan → tasks → implementation; WHAT/HOW/VALIDATION separated across these artifacts (this set is retrospective for shipped PR #14) |
| III. Contract-First | ✅ Pass | `GET /api/facets` response shape and the grid query params (`sort`/`dir`/`filters`) documented in `contracts/`; `Facets`/`FacetItem` typed in `apps/explorer-api/src/schemas.ts`; `filterStateSchema` validates input |
| IV. Operational Excellence | ✅ Pass | Reuses the existing route error envelope; malformed `filters` param degrades gracefully (ignored) rather than crashing the rows request |
| V. Simplicity & YAGNI | ✅ Pass | Chart view + its data layer (`chart.ts`/`chart.test.ts`) and the `us8-line-chart` E2E deleted as negative-value; facets reuse the existing `scopedLites` set rather than a new aggregation store |
| VI. Fast Feedback Loops | ✅ Pass | Pure grid logic unit-tested in <5s; Bun + Vite HMR; Playwright E2E for journeys |
| VII. Type Safety & Validation | ✅ Pass | TS strict; `filterStateSchema` (`.strict()`) validates `/api/facets` input; `Facets`/`FacetItem`/`GridQuery` typed end-to-end; malformed `filters` JSON guarded |
| VIII. 100% Coverage & Parity | ✅ Pass | Pure server grid logic (`resource-grid.ts`) and client helpers (`grid.ts`) at 100% line+branch; `/api/facets` and the grid query params have contract coverage and are registered in the parity matrix; no render-glue exception needed (no new WebGL) |
| IX. Data Freshness & Sync Integrity | ✅ Pass | Freshness buckets in `/api/facets` derive from each dataset's `freshness.isStale`; resource row payloads keep their freshness block; no new staleness path |
| X. Bulgarian-Locale Awareness | ✅ Pass | Cyrillic substring filter is case-folded via `toLowerCase`; sort uses `localeCompare(..., 'bg')`; tag/publisher labels shown verbatim; all UI strings localized to Bulgarian |
| XI. Respectful Crawling | ➖ N/A | This feature performs no portal crawling; it reads only the local mirror |

**Gate result**: PASS (no deviations; Complexity Tracking empty).

## Project Structure

### Documentation (this feature)

```text
specs/010-grid-filters-facets/
├── plan.md              # This file
├── research.md          # Phase 0 decisions (R1–R6)
├── data-model.md        # Phase 1: GridQuery / Facets view models
├── quickstart.md        # Phase 1: run/dev/test instructions
├── contracts/
│   ├── facets-api.md     # GET /api/facets response shape + grid query params
│   └── .gitkeep
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 task breakdown (marked done — shipped)
```

### Source Code (repository root)

This feature edits existing explorer packages and adds one pure server module; no new package is introduced.

```text
src/read/
├── resource-grid.ts            # NEW: pure server-side sort/filter (filter-then-sort,
│                               #      numeric-aware compareCells, MAX_GRID_SCAN = 100k)
└── resource-rows.ts            # EDIT: accept opts.grid, applyGrid before paging, set gridTruncated

apps/explorer-api/src/
├── app.ts                      # EDIT: GET /api/facets route; grid query params on the rows route
├── schemas.ts                  # EDIT: Facets + FacetItem view-model types
└── read-bridge.ts              # EDIT: rows() forwards GridQuery to readResourceRows

apps/explorer-web/src/
├── datasets/ResourcePreview.tsx  # EDIT: header sort, per-column funnel popover, empty-state,
│                                 #       chart view removed; content kind by shape not row count
├── filters/FilterPanel.tsx       # REWRITE: faceted sidebar (tags/publishers/freshness, chips)
├── lib/grid.ts                   # NEW: cycleSort, hasActiveFilters, GridSort (client helpers)
├── lib/api.ts                    # EDIT: fetchFacets, fetchResourceRows GridQuery params
├── lib/chart.ts                  # DELETED with the chart view
└── types.ts                      # EDIT: Facets/FacetItem, ResourceContent.gridTruncated

tests/unit/read/resource-grid.test.ts          # NEW: pure grid logic coverage
apps/explorer-web/src/lib/grid.test.ts          # NEW: client sort-cycle / filter-active helpers
apps/explorer-web/e2e/{us2-filters,us5-linked}.e2e.ts  # EDIT: tag facet
apps/explorer-web/e2e/us8-line-chart.e2e.ts     # DELETED with the chart view
```

**Structure Decision**: Web-application layout from feature 008 (React SPA `apps/explorer-web` + Hono API `apps/explorer-api`) reused unchanged. The only structural addition is the pure `src/read/resource-grid.ts` module, kept in the shared read substrate (not in the API app) so it is reusable and unit-testable in isolation — consistent with how `resource-rows.ts` lives there.

## Complexity Tracking

> No constitution violations. No render-glue exception used (this feature adds no WebGL/canvas code). Table empty.
