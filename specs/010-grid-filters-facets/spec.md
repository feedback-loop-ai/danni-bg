# Feature Specification: Excel-style grid filters/sort + faceted search panel

**Feature Branch**: `010-grid-filters-facets`
**Created**: 2026-06-16
**Status**: Implemented
**Input**: User description: "Make the resource grid read like a spreadsheet (per-column filter funnels + header-click sorting), remove the chart view that added no value, fix the empty-filter `[]` JSON glitch, and replace the type-an-exact-tag filter with a world-class faceted search sidebar (tag + publisher facets with result counts, localized freshness buckets, active-filter chips) backed by a `/api/facets` endpoint."

## Overview

This feature is the second UX overhaul pass on the map data explorer (a follow-up to the explorer foundation shipped in feature 008). It sharpens two surfaces that users touch constantly: the **resource grid** (the tabular drilldown into a dataset's rows) and the **filter panel** (the sidebar that scopes the whole map/list view).

The resource grid gains spreadsheet ergonomics — click a header to sort, click a per-column funnel to filter that column — with sort and filter evaluated server-side over the whole resource, not just the page the browser happens to have loaded. The chart ("Графика") view is removed: it added no value over the table and is deleted rather than carried as dead weight (Constitution V). A latent glitch where a filter matching no rows fell back to rendering raw `[]` JSON is fixed so an empty result shows an empty table with a localized "no matches" message.

The filter panel is replaced with a faceted sidebar: **tag** and **publisher** facets rendered as multi-select checkboxes with per-value result counts, a localized freshness segmented control with bucket counts, and active filters shown as removable chips. The facets and their counts are computed by a new `/api/facets` endpoint over the in-scope dataset set, so counts narrow as the user refines (conjunctive faceting).

This spec documents shipped behavior; it does not change how the mirror is synced or curated, nor the underlying filter semantics defined in feature 008 (logical-AND combination across filter types). It refines how those filters are *presented and discovered*, and how the row grid is *read*.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read a resource's rows like a spreadsheet (Priority: P1)

A researcher opens a dataset, expands one of its tabular resources, and wants to make sense of a wide table with thousands of rows. They click a column header to sort the whole resource by that column (ascending, then descending, then back to unsorted), and they click the funnel icon on a column header to open a small filter popover and type a substring to keep only matching rows. Sort and filter apply across the entire resource on the server, so the answer is correct even though only the first page is loaded; loading more rows preserves the active sort and filter.

**Why this priority**: The grid is the primary way users inspect actual data values behind a dataset. Without server-side sort/filter, the controls would silently lie (operating on only the loaded page), so this is the core deliverable of the grid work and stands alone as usable value.

**Independent Test**: Open a tabular resource, click a header and confirm the rows reorder (▲/▼ indicator appears and cycles asc → desc → off); open a column funnel, type a substring, and confirm the visible rows are exactly those whose value in that column contains the substring — including rows not on the first loaded page — and that the row count reflects the filtered total.

**Acceptance Scenarios**:

1. **Given** a tabular resource is open, **When** the user clicks a column header, **Then** the resource is sorted ascending on that column server-side, an up-arrow indicator appears, and the first page of the sorted order is shown.
2. **Given** a column is sorted ascending, **When** the user clicks the same header again, **Then** the sort flips to descending; a third click clears the sort and restores the original order.
3. **Given** a tabular resource is open, **When** the user clicks a column's funnel icon and types a substring, **Then** after a short debounce only rows whose value in that column contains the substring (case-insensitive) remain, the funnel is highlighted as active, and the displayed total reflects the filtered count.
4. **Given** a sort and a column filter are both active, **When** the user clicks "Зареди още" (load more), **Then** the next page is appended in the same sorted/filtered order rather than resetting.
5. **Given** a very large resource (beyond the server scan cap), **When** the user sorts or filters it, **Then** the grid indicates the operation applied to the first portion of the resource (a "first 100k" notice) rather than silently implying it covered the whole table.

---

### User Story 2 - Discover and refine filters with a faceted sidebar (Priority: P1)

A journalist wants environment datasets from a specific publisher but does not know the exact tag string to type. They open the filter sidebar and see **Тагове** and **Издатели** facets listing the available values with a count beside each, ordered by frequency, capped to the top values with a "show more" affordance, plus a search-within box for the long tag list. They tick a tag and a publisher; the lists update so each remaining facet count reflects what is still reachable given the active selection. The freshness control (Всички / Актуални / Остарели) shows bucket counts. Their active selections appear as removable chips with localized labels, and one action clears everything.

**Why this priority**: The previous "type an exact tag" filter was effectively unusable without insider knowledge of the tag vocabulary. Faceted discovery with counts is the difference between a filter that works at the scale of thousands of datasets and one that does not — making it equal-priority with the grid.

**Independent Test**: Open the sidebar with no filters and confirm tag/publisher facets render with counts and a top-N cap; tick a facet value and confirm the result set narrows and the other facets' counts update; confirm the active selection appears as a removable chip and that "Изчисти всички" clears all filters.

**Acceptance Scenarios**:

1. **Given** the sidebar is open with no active filters, **When** it loads, **Then** tag and publisher facets are listed with a per-value result count, ordered by frequency and capped to the top values with a "Покажи още N" control.
2. **Given** the tag facet has more than the cap, **When** the user types in the tag search-within box, **Then** the visible tag values are narrowed to those matching the typed text.
3. **Given** no filter is active, **When** the user ticks a tag value, **Then** the map/list set narrows to matching datasets and every facet's counts update to reflect the new in-scope set (conjunctive faceting).
4. **Given** one or more filters are active, **When** the user views the sidebar, **Then** each active filter is shown as a removable chip with a localized, human-readable label (publisher names resolved, freshness localized).
5. **Given** several filters are active, **When** the user clicks "Изчисти всички", **Then** all filters are removed and the view returns to the full scope.
6. **Given** the freshness control, **When** the user selects "Актуални" or "Остарели", **Then** the control shows the count for each bucket and the result set is constrained to that freshness state.

---

### User Story 3 - Trust an empty filter result (Priority: P2)

A user applies a column filter that happens to match no rows. Instead of a confusing raw `[]` JSON dump (the prior glitch), they see the table header preserved and a clear localized message that nothing matched, with a one-click way to clear the column filters.

**Why this priority**: It is a correctness/trust fix rather than new capability — small in scope but it removes a jarring, confidence-destroying glitch. It depends on the grid (US1) existing.

**Independent Test**: Apply a column filter known to match nothing and confirm the table chrome (column headers) stays, an empty-state message ("Няма съвпадения за филтъра.") is shown instead of `[]`, and the "изчисти филтрите" action restores the rows.

**Acceptance Scenarios**:

1. **Given** a tabular resource is open, **When** a column filter matches zero rows, **Then** the column headers remain and a localized "no matches" message is shown in place of any rows.
2. **Given** a filter matched zero rows, **When** the user clears the column filters, **Then** the rows reappear.
3. **Given** a filter matches zero rows, **When** the empty state is shown, **Then** no raw JSON (`[]`) fallback is rendered.

---

### Edge Cases

- **Removed chart view**: The grid no longer offers any view selection (no "Графика"/chart toggle). Resources render as exactly one of: a table (tabular), a JSON document (GeoJSON/JSON), or text — decided by the resource's content shape, not by how many rows are loaded.
- **Empty table vs. empty document**: A tabular resource that filters down to zero rows MUST still render as a table (empty), never as the document/text fallback, because the content kind is decided by shape, not row count.
- **Mixed-type column sort**: Columns mixing numbers and text MUST sort deterministically — numeric values compared numerically when both look numeric, otherwise Bulgarian-collated string comparison, with blank cells sorted last.
- **Very large resources**: Sort/filter scans up to a fixed cap (100,000 rows); beyond that the grid operates on the prefix and surfaces a "first 100k" indicator so the user is not misled about coverage.
- **Malformed grid query**: A malformed `filters` query parameter MUST be ignored (treated as no column filters) rather than failing the rows request.
- **Facets reflect filters, not the whole catalog**: Facet counts MUST be computed over the currently in-scope (already-filtered) set, so they narrow as filters are added; a facet value that would yield zero results given current filters does not appear.
- **Publishers without a Bulgarian title**: A publisher facet/chip whose source title is missing MUST still render (falling back to its id) rather than showing a blank label.
- **Long tag vocabulary**: With many tags, only the top values are shown by default; the rest are reachable via "show more" and the search-within box, so the sidebar stays scannable.

## Requirements *(mandatory)*

### Functional Requirements

**Resource grid — sort & filter**
- **FR-001**: Users MUST be able to sort a tabular resource by clicking a column header, cycling unsorted → ascending → descending → unsorted, with a visible ▲/▼ indicator on the active column.
- **FR-002**: Users MUST be able to filter a tabular resource per column via a funnel control on the column header that opens a substring-filter popover; an active column filter MUST be visually highlighted.
- **FR-003**: Sort and column filters MUST be applied server-side over the whole resource (up to a defined scan cap), not only over the rows already loaded into the browser.
- **FR-004**: Column-filter input MUST be debounced before it is sent, and applying a new filter or sort MUST restart pagination from the first page.
- **FR-005**: Loading additional pages ("load more") MUST preserve the active sort and column filters and append rows in the same order.
- **FR-006**: When a sort or filter is applied to a resource larger than the scan cap, the grid MUST indicate that the operation covered only the first portion (a "first 100k" notice) rather than implying full coverage.
- **FR-007**: Column filtering MUST be case-insensitive substring matching on the cell's text representation; sorting MUST compare numerically when both compared cells are numeric, otherwise by Bulgarian-aware string collation, with blank cells ordered last.

**Resource grid — chart removal & empty-state fix**
- **FR-008**: The chart ("Графика") view MUST be removed entirely; the grid MUST offer no view selection and render each resource as exactly one of table, JSON document, or text, chosen by content shape.
- **FR-009**: A tabular resource whose filter matches zero rows MUST render the (empty) table with a localized "no matches" message and MUST NOT fall back to rendering raw `[]` JSON.
- **FR-010**: The grid MUST provide a one-action way to clear all active column filters and restore the rows.

**Faceted filter panel**
- **FR-011**: The filter sidebar MUST present tag and publisher facets as multi-select controls, each value showing a result count, ordered by frequency, capped to a top-N with a "show more" affordance.
- **FR-012**: The tag facet MUST provide a search-within box to filter the visible tag values when the vocabulary exceeds the top-N cap.
- **FR-013**: The freshness control MUST be a localized segmented control (Всички / Актуални / Остарели) showing per-bucket counts, plus a toggle to include withdrawn datasets.
- **FR-014**: Facet values and their counts MUST be computed over the currently in-scope (already-filtered) dataset set so counts narrow as filters are added (conjunctive faceting).
- **FR-015**: Active filters MUST be shown as individually removable chips with localized, human-readable labels (publisher ids resolved to titles, freshness localized, geo ids resolved to region labels), and a single "Изчисти всички" action MUST clear all filters.
- **FR-016**: Facet sections MUST be individually collapsible so a long sidebar stays scannable.

**Facets endpoint**
- **FR-017**: The system MUST expose a `/api/facets` endpoint that accepts the shared filter query parameters and returns tag facets, publisher facets, and freshness buckets with in-scope counts.
- **FR-018**: The `/api/facets` endpoint MUST compute counts over the same in-scope dataset set used by the dataset/region/national endpoints, so facet counts are consistent with those views.
- **FR-019**: Publisher facet items MUST carry a Bulgarian label resolved from the publisher's title, falling back to the publisher id when no title is available.

### Key Entities *(include if feature involves data)*

- **GridQuery**: The per-resource sort/filter request — an optional sort (column + direction) and a map of column → substring filter — applied server-side before pagination.
- **Facets**: The filter-options projection returned by `/api/facets` — a list of tag facet items, a list of publisher facet items, and a list of freshness buckets, each carrying an in-scope count.
- **FacetItem**: One selectable facet value — an id, a Bulgarian label (and optional English label), and the count of in-scope datasets carrying it.
- **FilterState**: The shared, existing filter object (tags, publisherIds, geoUnitIds, freshness, free-text query, includeWithdrawn) that scopes the map/list and that `/api/facets` counts against. (Defined in feature 008; reused unchanged.)
- **Filter Chip**: A removable, localized representation of one active filter value in the sidebar.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Sorting or filtering a resource returns rows ordered/filtered across the entire resource (up to the scan cap), so the first page after a sort reflects the global order — verified for resources larger than one page in 100% of tested cases.
- **SC-002**: A column filter that matches no rows shows an empty table with a localized message in 100% of cases and never renders a raw `[]` JSON fallback.
- **SC-003**: No chart/view-selection affordance remains anywhere in the resource grid (the "Графика" view is fully removed and its line-chart E2E coverage retired).
- **SC-004**: Opening the filter sidebar shows tag and publisher facets with accurate in-scope counts; ticking a value updates the other facets' counts to the new in-scope set within 2 seconds for typical filter combinations.
- **SC-005**: A user can find and apply a tag without typing its exact string — every tag with at least one in-scope dataset is reachable via the top-N list, "show more", or the search-within box.
- **SC-006**: Every active filter is shown as a removable chip with a localized label, and "Изчисти всички" returns the view to full scope in a single action — verified for tag, publisher, freshness, and geo filters.
- **SC-007**: `/api/facets` counts match the dataset/region/national endpoints for the same filter state (consistent in-scope set) in 100% of contract-tested cases.

## Assumptions

- **Builds on feature 008**: This refines the explorer shipped in `008-map-data-explorer`; the shared `FilterState` semantics (logical-AND across filter types, free-text search, freshness, withdrawn handling) and the underlying read substrate are reused unchanged.
- **Read-only**: The grid and facets only read the curated mirror; no authoritative data is mutated. Authoritative Bulgarian tag/publisher labels are shown verbatim (Constitution X).
- **Scan cap**: Server-side grid sort/filter scans up to 100,000 rows of a resource; beyond that it operates on the prefix and flags the truncation. This bounds memory for resources up to ~1.25M rows while keeping the common case exact.
- **Conjunctive faceting**: Facet counts reflect the currently active filters (counts narrow as you refine), matching mainstream faceted-search UX guidance (NN/g, Baymard: show counts, make refinement/removal easy, prioritize values, avoid jargon).
- **Tag facet identity**: Tags are identified by their Bulgarian label string (the facet id and label are the same value); the existing `FilterState.tags` holds those label strings.
- **Session-only state**: Sort/filter and facet UI state are client-side and session-scoped; nothing new is persisted server-side.
- **Desktop-first**: Targets the same desktop-first responsive web experience as feature 008.
