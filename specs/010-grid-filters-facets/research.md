# Phase 0 Research: Excel-style grid filters/sort + faceted search panel

**Feature**: 010-grid-filters-facets · **Status**: Implemented (PR #14)

Decisions taken during implementation, recorded retrospectively. Each cites the concrete requirement it serves (Constitution V).

## R1 — Server-side grid sort/filter over the whole resource (not the loaded page)

**Decision**: Evaluate sort and per-column filter on the server over the whole resource (up to a cap), passing `sort`/`dir`/`filters` query params to the existing rows route; the client only renders.

**Why**: Client-side controls operating on the already-paged subset would silently mislead — sorting "ascending" would only sort the first 50 rows, and a filter would miss matches on later pages. For a grid that exists to inspect real data values, that is a correctness bug, not a convenience gap. Server-side evaluation makes the controls truthful (FR-003, SC-001).

**Alternatives rejected**:
- *Client-side sort/filter on loaded rows* — wrong results beyond page 1; rejected outright.
- *Fetch the whole resource then sort/filter in the browser* — resources reach ~1.25M rows; bulk transfer to the browser is a non-starter (Constitution V / scale).

## R2 — 100,000-row scan cap with an honest truncation flag

**Decision**: Scan at most `MAX_GRID_SCAN = 100_000` rows for sort/filter; when the resource exceeds that, operate on the prefix and set `gridTruncated: true`, surfaced in the UI as a "· върху първите 100k" notice.

**Why**: Bounds server memory/CPU for pathological resources while keeping the overwhelmingly common case (resources under 100k rows) exact. Honesty about partial coverage (FR-006) follows the same "no silent staleness / no silent lies" stance as Constitution IX — the user is told the operation was partial rather than being misled.

**Alternatives rejected**: unbounded scan (memory blow-up on the largest resources); pushing sort/filter into SQL (resource rows are stored as NDJSON/JSON blobs with polymorphic per-dataset schemas, not relational columns — there is nothing to index on generically).

## R3 — Filter-then-sort, numeric-aware comparison, Bulgarian collation

**Decision**: `applyGrid` filters first, then sorts. Filtering is case-insensitive substring match on the cell's text form. Sorting compares numerically when both cells look numeric, else by `localeCompare(as, bs, 'bg')`, with blank cells ordered last. The text helper mirrors the surviving client `lib/table.cellText` (the old `lib/chart.ts` home was deleted with the chart view — see R4); the numeric predicate (`isNumeric`) now lives inline in `src/read/resource-grid.ts` as the single source of truth, so client (`cellText`) and server agree on the text/numeric forms.

**Why**: Filter-before-sort is cheaper (sort the smaller set) and matches user mental model (sort the filtered view). Numeric-aware ordering avoids "10 < 2" string surprises; Bulgarian collation is required for Cyrillic text (Constitution X). Blanks-last keeps empty cells from dominating the top of an ascending sort (FR-007).

## R4 — Remove the chart view entirely; decide content kind by shape

**Decision**: Delete the "Графика" chart view, its `lib/chart.ts`/`chart.test.ts`, and the `us8-line-chart` E2E. Render each resource as exactly one of table / JSON-document / text, decided by the resource's **content shape**, not by how many rows are currently loaded.

**Why**: The chart added no value over the table and was dead weight (Constitution V — "dead code is negative value"). Deciding the content kind by shape rather than row count also fixes the latent glitch: previously, a filter that emptied the loaded rows made the view fall back to the document/JSON branch and render raw `[]` (FR-008, FR-009, SC-002, SC-003).

**Alternatives rejected**: keeping the chart behind a feature flag (still dead weight, still maintenance); fixing the `[]` glitch without removing the chart (the shape-vs-row-count fix is the same change that retires the chart's branchiness, so they ship together).

## R5 — `/api/facets` over the existing in-scope set (conjunctive faceting)

**Decision**: Add `GET /api/facets` that parses the shared filter params, takes `scopedLites(filters)` (the same in-scope set the list/region/national endpoints use), and aggregates tag counts, publisher counts (with resolved BG labels, id fallback), and fresh/stale buckets in one pass.

**Why**: Reusing `scopedLites` guarantees the facet counts are consistent with what the rest of the explorer shows for the same filter state (FR-018, SC-007) and avoids a second aggregation source of truth (Constitution V). Computing over the *filtered* set (not the whole catalog) gives conjunctive faceting — counts narrow as the user refines — which matches NN/g and Baymard faceted-search guidance.

**Alternatives rejected**: a precomputed facet index (premature; the bulk `listLite()` projection already scales to ~11k datasets per request, well within the ≤2s budget); disjunctive (independent) facet counts (more complex, and conjunctive matches the AND semantics the explorer already uses for FilterState).

## R6 — Faceted sidebar UX (counts, top-N, search-within, chips)

**Decision**: Rebuild `FilterPanel.tsx` as a faceted sidebar: tag/publisher multi-select checkboxes with per-value counts, top-8 + "Покажи още N", a search-within box for the long tag list, a localized freshness segmented control (Всички/Актуални/Остарели) with bucket counts + a withdrawn toggle, collapsible sections, and active filters as removable chips with localized labels (publisher titles, freshness words, geo labels resolved via an injected `geoLabel`). One "Изчисти всички" clears all.

**Why**: The prior "type the exact tag" input was unusable without insider knowledge of the tag vocabulary. The chosen patterns are the standard, evidence-backed faceted-search affordances (NN/g, Baymard: show result counts, make refinement and removal easy, prioritize the most useful values, avoid jargon). Top-N + search-within keeps a long sidebar scannable while every value stays reachable (FR-011–FR-016, SC-005).

**Alternatives rejected**: free-text-only tag entry (the status quo being replaced); showing all facet values ungated (overwhelming for the long tag vocabulary).
