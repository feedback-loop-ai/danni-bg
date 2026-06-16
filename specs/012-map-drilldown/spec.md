# Feature Specification: SVG choropleth + oblast→municipality drill-down (real 265-municipality geometry)

**Feature Branch**: `012-map-drilldown`  
**Created**: 2026-06-16  
**Status**: Implemented (PRs #16, #17, #21)  
**Input**: Retrospective specification for shipped work. The map shipped in 008-map-data-explorer was a WebGL/MapLibre choropleth with six placeholder municipality squares; it rendered nothing in a headless environment and so could never be screenshot- or E2E-verified, and it carried no real municipality geometry. This feature replaced it with a headless-renderable SVG choropleth, sourced real geometry for all 265 Bulgarian municipalities, and added an oblast→municipality drill-down interaction.

## Overview

The Bulgarian map data explorer renders a choropleth of the country weighted by how much public data each administrative unit holds. The original map could not be verified in CI (no GPU in headless test environments) and showed placeholder municipality shapes instead of real geometry.

This feature reworks the map end to end:

1. **Headless-renderable SVG choropleth** — replaces the WebGL/MapLibre map with a declarative SVG map driven by a shared D3-geo projection. It renders and screenshot-tests in a headless browser, drops the heavy `maplibre-gl` dependency, and is trivially styleable (legend, labels, hover tooltips, distinct selected/hover/chat-highlight outlines, keyboard-operable regions).
2. **Real geometry for all 265 municipalities** — replaces six placeholder squares and a seven-entry gazetteer stub with the complete set of Bulgarian *obshtini*, geometry sourced from Eurostat GISCO LAU 2021 (Cyrillic names preserved verbatim). A generated gazetteer records each municipality's id, Bulgarian and English labels, parent oblast (derived spatially), and official LAU id; a crosswalk joins gazetteer ids to boundary features by that LAU id.
3. **Oblast→municipality drill-down** — clicking an oblast zooms into it (a fit-to-bounds transform) and renders its municipalities as a sub-choropleth, scoping the dataset list to that oblast; a "← Назад към областите" control returns to the country view.

The feature does not change how the mirror is synced or curated, nor the explorer's filter/chat surfaces. It is a self-contained rework of the map layer plus the boundary/gazetteer data it draws on. A subsequent fix (#21) ensures the choropleth itself does not shrink when the user selects a region — selection scopes only the dataset list and chat, never the map's own aggregates.

## Clarifications

### Session 2026-06-16 (retrospective — decisions recovered from shipped code and PRs)

- Q: Why SVG instead of the existing WebGL/MapLibre map? → A: WebGL fails to render in headless test environments (no GPU → shader-compile failure), so the map could never be screenshot- or E2E-verified; MapLibre was also heavy for a single-country choropleth. SVG renders headlessly, is lighter, and is unit-/E2E-testable.
- Q: Where does real municipality geometry come from, and how is it joined? → A: Eurostat GISCO LAU 2021 (1:1M, EPSG:4326), filtered to Bulgaria (265 *obshtini* with Cyrillic `LAU_NAME` + `LAU_ID`), joined to the gazetteer/crosswalk by official LAU id (no LAU↔NUTS table needed).
- Q: How is each municipality's parent oblast determined? → A: Spatially — the oblast whose real polygon contains the municipality centroid (fallback: nearest oblast centroid), so no external LAU↔NUTS3 crosswalk is required and zero municipalities are left unmatched.
- Q: Does selecting/drilling a region re-scope the choropleth itself? → A: No. The choropleth is a global "datasets per region" view. Selection scopes only the dataset list + chat; the region layers are fetched with a selection-independent filter (#21).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Drill from an oblast into its municipalities (Priority: P1)

A visitor sees the national choropleth of Bulgaria's 28 oblasts, each shaded by how much public data it holds. They click an oblast. The map zooms into that oblast and reveals its municipalities as a sub-choropleth — each municipality rendered with its real boundary and shaded by its own dataset volume — while the dataset list narrows to that oblast. A "← Назад към областите" control returns them to the country view. Because both layers share one projection, the municipalities sit exactly inside the oblast outline.

**Why this priority**: This is the core value of the rework — turning a flat, unverifiable, placeholder map into an actionable spatial drill-down over real geometry. It is the minimum viable product: it delivers standalone value (browse oblasts, drill into one, see its municipalities) even without the selection-independence refinement.

**Independent Test**: Load the explorer headlessly (Playwright), confirm the SVG map is attached and oblasts render, click an oblast, confirm a "Назад към областите" control appears (the map has zoomed into the oblast and shows its municipalities), then click "Назад" and confirm the control disappears (back at the country view).

**Acceptance Scenarios**:

1. **Given** the explorer is loaded at the national view, **When** the page is rendered in a headless browser, **Then** the SVG map of Bulgaria is present and its oblast regions are drawn (no GPU required).
2. **Given** the national choropleth is shown, **When** the user clicks an oblast, **Then** the map zooms into that oblast, renders its municipalities as a sub-choropleth aligned within the oblast outline, and offers a "← Назад към областите" control.
3. **Given** the user has drilled into an oblast, **When** they click the "Назад към областите" control, **Then** the map returns to the national oblast view and the back control is removed.
4. **Given** the user has drilled into an oblast, **When** they click one of its municipalities, **Then** that municipality is selected (toggle-select) and the dataset list reflects the selection.
5. **Given** any municipality is shown, **When** it is rendered, **Then** it uses real geometry from the boundary dataset (not a placeholder shape) and is shaded by its dataset count.

---

### User Story 2 - Selecting a region does not re-scope the choropleth (Priority: P2)

A user clicks an oblast to drill in. The municipalities of that oblast keep their dataset counts immediately, on the first click — the choropleth does not collapse or empty out and then settle after a further interaction. Selecting a region scopes only the dataset list and the chat; the map's per-region aggregates remain the global "datasets per region" view.

**Why this priority**: Without this, the drill-down (P1) is visibly broken on the first click — the municipality layer goes stale/empty because selecting a region re-scoped the map to "datasets directly tagged with that oblast", a subset after the municipality→oblast roll-up. It is a correctness refinement on top of P1, independently observable.

**Independent Test**: Drill into an oblast and confirm its municipalities show their dataset counts on the first click (no second interaction needed); confirm the country-view oblast counts are unchanged by having a region selected.

**Acceptance Scenarios**:

1. **Given** the national choropleth is shown, **When** the user clicks an oblast to drill in, **Then** the drilled-in municipalities display their dataset counts immediately (no second interaction required to populate them).
2. **Given** a region is selected, **When** the choropleth aggregates are computed, **Then** they ignore the selected region (`geoUnitIds`) and reflect the global per-region dataset volume, while the dataset list and chat remain scoped to the selection.
3. **Given** a region is selected and no other filter changes, **When** the user interacts further, **Then** the region layers are not refetched or re-scoped solely because of the selection.

---

### Edge Cases

- **Municipality with no datasets**: A municipality whose count is zero is shaded with the reserved "no data" bucket (bucket 0), not omitted, so the oblast's full set of municipalities is always visible when drilled in.
- **Skewed dataset counts**: A few oblasts hold hundreds of datasets while most hold a handful; a linear colour ramp would wash everything into one shade. The colour scale buckets by fractions of the maximum, emphasising the low end, so differences remain visible.
- **Municipality centroid not inside any oblast polygon**: Coastline/border simplification can leave a centroid just outside every oblast polygon; the spatial parent assignment falls back to the nearest oblast centroid so no municipality is left without a parent (zero unmatched).
- **Slug collision across municipalities**: Two municipalities can share a name (e.g. duplicate *obshtina* names); gazetteer slugs are de-duplicated so every municipality id is unique.
- **Selecting a region while drilled in**: Selecting a region writes the entity into the filter's `geoUnitIds` for the dataset list/chat, but the choropleth layers are fetched with that field stripped, so the map does not collapse (see User Story 2 / #21).
- **Degenerate colour scale at low maxima**: When the maximum count is ≤ 1, the bucket breakpoints collapse to a valid non-degenerate scale rather than producing NaN breakpoints.

## Requirements *(mandatory)*

### Functional Requirements

**Headless-renderable SVG map**
- **FR-001**: The map MUST be rendered as declarative SVG using a D3-geo projection, with no dependency on WebGL/GPU, so it renders fully in a headless browser.
- **FR-002**: A single projection MUST be fitted to the country once and shared across the oblast and municipality layers so the two layers align exactly.
- **FR-003**: The map MUST display a colour legend, region labels, hover tooltips, and visually distinct outlines for selected, hovered, and chat-highlighted regions, and its regions MUST be keyboard-operable.
- **FR-004**: The choropleth colour scale MUST be data-driven and skew-aware (buckets by fractions of the maximum count, emphasising the low end), with a dedicated bucket reserved for regions that have no datasets.

**Real 265-municipality geometry & gazetteer**
- **FR-005**: The system MUST provide real boundary geometry for all 265 Bulgarian municipalities, sourced from an open administrative-boundary dataset (Eurostat GISCO LAU 2021), with Cyrillic municipality names preserved verbatim.
- **FR-006**: The system MUST generate a municipality gazetteer entry for each of the 265 municipalities, recording its entity id, authoritative Bulgarian label, derived English label, parent oblast id, aliases, and official LAU id.
- **FR-007**: Each municipality's parent oblast MUST be derived spatially (the oblast polygon containing the municipality centroid, with nearest-centroid fallback), leaving zero municipalities unmatched.
- **FR-008**: The system MUST join gazetteer entries to boundary features through a crosswalk keyed by the official LAU id, validated at load time, with every municipality entry carrying its parent oblast id.
- **FR-009**: Municipality gazetteer slugs MUST be unique (collisions de-duplicated) so every municipality entity id is distinct.

**Oblast→municipality drill-down**
- **FR-010**: Clicking an oblast MUST zoom the map into that oblast (a fit-to-bounds transform) and render its municipalities as a sub-choropleth shaded by their dataset volume.
- **FR-011**: While drilled into an oblast, the system MUST present a "← Назад към областите" control that returns the map to the national oblast view.
- **FR-012**: While drilled into an oblast, clicking a municipality MUST toggle-select it and reflect the selection in the dataset list.
- **FR-013**: Each `RegionSummary` for a municipality MUST carry its parent `oblastEntityId` so the client can group municipalities under their oblast and drive the drill-down.

**Choropleth aggregates independent of selection**
- **FR-014**: The choropleth's per-region aggregates MUST be a global "datasets per region" view that does NOT shrink when the user selects or drills into a region; selecting a region MUST scope only the dataset list and chat.
- **FR-015**: The region (choropleth) layers MUST be fetched with a selection-independent filter (the region selection / `geoUnitIds` stripped), so selecting a region does not refetch or re-scope the map layers.

**Aggregation correctness**
- **FR-016**: An oblast's dataset count MUST be the de-duplicated union of datasets linked directly to it and datasets linked to any of its municipalities (a dataset linked to both is counted once).

### Key Entities *(include if feature involves data)*

- **Municipality gazetteer entry**: One of the 265 Bulgarian municipalities — `id` (`geo:bg-municipality-<slug>`), authoritative `labelBg` (Cyrillic, verbatim), derived `labelEn`, parent `oblastId`, `aliases` (e.g. "Община <name>"), and official `lauId`. The source of truth the curate pipeline and crosswalk consume.
- **Boundary feature**: A GeoJSON `Feature` (Polygon/MultiPolygon) for an administrative unit, carrying `properties.boundaryFeatureId` (municipalities keyed `lau-<LAU_ID>`), `properties.level`, and optional official codes. The geometry the SVG choropleth projects and paints.
- **Crosswalk entry**: A static join row mapping a gazetteer `entityId` to a `boundaryFeatureId` by official code, with `level`, `ekatte`/`lauId` (municipality) or `iso3166_2` (oblast), and the parent `oblastEntityId` for municipalities. Validated against the gazetteer and the boundary collections at load time.
- **RegionSummary**: The per-unit choropleth aggregate (`entityId`, `level`, `labelBg`, `labelEn`, `boundaryFeatureId`, `datasetCount`, `hasData`, `maxConfidence`, and `oblastEntityId` for municipalities) that drives shading and drill-down grouping.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 265 Bulgarian municipalities have real boundary geometry in the bundled boundary dataset (no placeholder shapes remain).
- **SC-002**: Every one of the 265 municipalities has a gazetteer entry with a parent oblast assigned — zero municipalities are unmatched.
- **SC-003**: The map renders and is verifiable in a headless browser: the SVG map and its oblast regions are present in a Playwright run with no GPU available.
- **SC-004**: Clicking an oblast in a headless browser drills into it (offers the "Назад към областите" control) and clicking that control returns to the country view — covered by an automated E2E test.
- **SC-005**: When the user drills into an oblast, its municipalities display their dataset counts on the first click (no second interaction needed) — i.e. selecting a region does not empty or re-scope the choropleth.
- **SC-006**: Every municipality gazetteer entry has a unique id (no slug collisions) and is joined to its boundary feature by official LAU id; the crosswalk validates with no orphan rows.
- **SC-007**: An oblast's choropleth count equals the de-duplicated union of datasets linked to it directly and to any of its municipalities (a dataset reaching the oblast by multiple links counts once).

## Assumptions

- **Data source**: The choropleth aggregates read from the existing curated `data.egov.bg` mirror via the explorer API's region endpoints; mirror sync/curation is out of scope. Dataset→municipality links require a curate/index pass over the new gazetteer to populate counts.
- **Boundary provenance**: Municipality geometry is bundled from Eurostat GISCO LAU 2021 (1:1M, EPSG:4326), filtered to Bulgaria; oblast geometry was already bundled by 008-map-data-explorer and is reused unchanged.
- **Spatial parent derivation**: A centroid-in-polygon test (with nearest-centroid fallback) against the bundled oblast polygons is sufficient to assign each municipality's parent oblast; no external LAU↔NUTS3 table is needed.
- **Locale**: Municipality names are preserved exactly as published in the source (Cyrillic); English labels are clearly derived (transliterated) helpers and do not replace the authoritative Bulgarian name.
- **Scope boundary**: This feature reworks the map layer and its boundary/gazetteer data only. The filter panel, chat, dataset list, and region/dataset API contracts are reused; the only API-shape change is `RegionSummary` gaining `oblastEntityId` and the crosswalk gaining `lauId`.
- **Platform**: Desktop-first responsive web browser; the SVG map targets modern browsers and headless Chromium for E2E.
