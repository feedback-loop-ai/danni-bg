# Feature Specification: Region multi-select + hierarchical geo-filter roll-up

**Feature Branch**: `023-geo-selection-rollup`
**Created**: 2026-06-20
**Status**: Implemented (multi-select in PR #66; oblast→municipality filter roll-up in PR #67; chat
geo-scope roll-up in this change — all on `main`; verified by the suite green + live runs on `:8790`)
**Input**: User feedback during a usability pass: "I want multiselect of regions when holding shift,
and filtering on those selected, and when we drill down — same way", followed by "why does my left
deterministic search have a very different data count when I select e.g. Стара Загора?" (638 on the
map vs 128 in the list), and "apply the same expansion to chat".

## Overview

The map data explorer (spec 008) renders a choropleth with oblast→municipality drill-down (spec 012),
where an oblast's count is the **de-duplicated roll-up** of its own datasets plus all of its
municipalities' (spec 013, via the `part_of` knowledge-graph edges). Selecting a region scopes the
dataset list and the grounded chat (FR-009).

This feature closes two gaps that surfaced in use:

1. **Selection was single-only.** You could scope to one region at a time; there was no way to compare
   or aggregate several oblasts (or several municipalities) at once.
2. **The filter didn't match the map.** Selecting an oblast filtered on the oblast entity *alone*, so
   the list showed only oblast-level datasets (Стара Загора: 128) while the choropleth promised the
   rolled-up total (638) — the ~510 municipality-tagged datasets were silently excluded. The grounded
   chat's geo-scope had the same flat semantics.

The fix makes **selection multi-region** and makes **every geo filter honor the same roll-up the map
uses**, in the explorer *and* the chat, so "the parts add up to the whole" everywhere a region is a
filter — not just where it is a count.

## Clarifications

### Session 2026-06-20

- Q: How is multi-select triggered? → A: **Shift+click**. In the country view it toggles oblasts into
  a union (plain click still drills in); in the drill-down it toggles municipalities (plain click still
  single-selects, re-clicking the sole one clears it). A persistent `Shift+клик` hint is shown.
- Q: What does the selection filter on? → A: the **union** of selected regions. `geoUnitIds` is already
  OR-matched server-side, so the list + chat see datasets in *any* selected region.
- Q: Where does selection state live? → A: the selection **is** `filters.geoUnitIds` — a single source
  of truth, so the map highlight and the filter chips stay consistent automatically.
- Q: Drilling then selecting municipalities — does the parent oblast stay selected? → A: **No.** When
  refining to municipalities the parent oblast id is dropped, otherwise `oblast ⊇ municipality` would
  mask the narrowing (the list would stay the whole oblast).
- Q: Why 638 vs 128? → A: the map count is the oblast's roll-up (own + municipalities, spec 013) but
  the filter matched the oblast entity alone. **Fix:** a geo filter on an oblast expands to itself +
  its child municipalities (inverse `part_of` graph), so the filtered count equals the map count.
- Q: Does the chat need the same fix? → A: **Yes.** The chat's hard geo-scope filter and its
  region-datasets fallback under-counted an oblast identically; the same expansion is applied to the
  chat scope.

## User Scenarios & Testing *(mandatory)*

One responsibility: **multi-region selection, and geo filters that match the choropleth roll-up
everywhere (explorer list + facets + chat).**

### User Story 1 — Multi-select regions on the map (Priority: P1)

A user wants the datasets of several oblasts at once. Holding **Shift**, they click two or more oblasts;
each highlights, an info card shows "N области избрани" with the combined total, and the list refetches
on the union. Drilling into one oblast (plain click), they Shift-click several municipalities and the
list narrows to just those.

**Acceptance**
1. Shift+click on an oblast toggles it into the selection without drilling; the list filters on the
   union of selected oblasts.
2. Plain click on an oblast still drills in and scopes to that oblast only.
3. In drill-down, Shift+click toggles municipalities into a union; plain click single-selects;
   re-clicking the sole selection clears it.
4. Selecting municipalities drops the parent oblast from the filter (no oblast-superset masking).
5. The selected outlines, the multi-region info card, and the filter chips all reflect the same set.

### User Story 2 — Selecting an oblast matches the map count (Priority: P1)

A user reads "638" on Стара Загора, clicks it, and expects ~638 datasets in the list — not 128.

**Acceptance**
1. Selecting an oblast filters the list to the **roll-up**: the oblast's own datasets ∪ all its
   municipalities' (de-duplicated) — equal to the choropleth count.
2. Selecting a single municipality stays **exact** (no over-expansion to siblings or parent).
3. The roll-up applies to the dataset list, the facet counts, the national view, the regions endpoint,
   and the keyword-search path — wherever a geo filter is honored.

### User Story 3 — Chat scoped to an oblast sees its municipalities (Priority: P2)

A user scopes the grounded chat to an oblast and asks about one of its municipalities; the chat must be
able to ground on that municipality's datasets.

**Acceptance**
1. A chat geo-scope on an oblast includes its municipalities' datasets in both the hard scope filter
   (so the model can only retrieve in-scope datasets) and the region-datasets fallback.
2. Asking, under an oblast scope, about a municipality in that oblast returns grounded citations from
   the municipality's datasets (which a flat oblast scope would have excluded).
3. A **generic** question under a tight geo-scope (e.g. "регистри" scoped to one oblast) still
   retrieves the region's datasets — retrieval must not starve because the globally top-ranked hits
   fall outside the region.

### Edge Cases
- Empty selection → no geo filter (full mirror), as before.
- An id with no children (any municipality, or an unknown id) passes through unchanged.
- A mixed set (an oblast + an explicit municipality of another oblast) expands the oblast and unions
  the rest, de-duplicated.
- The `part_of` graph is static at runtime, so the inverse (oblast→children) map is memoized.

## Requirements *(mandatory)*

- **FR-094**: The map MUST support multi-region selection via **Shift+click** — oblasts in the country
  view, municipalities in the drill-down — with the dataset list and chat scope filtering on the
  **union** (OR) of the selected regions.
- **FR-095**: Plain click MUST retain its prior behavior (country: drill in + scope to that oblast;
  drill-down: single-select, re-clicking the sole selection clears it). The selection MUST be a single
  source of truth (`filters.geoUnitIds`), kept consistent with the filter chips and map highlight.
- **FR-096**: When refining within a drilled-in oblast, selecting municipalities MUST drop the parent
  oblast id from the filter, so an oblast superset cannot mask the municipality narrowing.
- **FR-097**: A geo filter on an **oblast** MUST expand to the oblast plus its child municipalities
  (inverse `part_of` graph) so the filtered dataset count equals the choropleth roll-up (spec 013).
  A **municipality** (leaf) or unknown id MUST pass through unchanged.
- **FR-098**: The expansion MUST apply across every explorer geo-filter site: the dataset list, the
  facet counts, the national view, the regions endpoint, and the keyword-search path.
- **FR-099**: The grounded chat's geo-scope MUST be expanded identically, so scoping chat to an oblast
  includes its municipalities' datasets in both the hard scope filter and the region-datasets fallback.
- **FR-100**: Under an active geo-scope, chat retrieval MUST be scope-aware: the `mirrorSearch` tool
  and the RAG path MUST over-fetch the ranked results and backfill directly from the region's datasets,
  so a generic query never returns empty when the region holds matching data (filtering a global
  top-N after ranking is insufficient for a small region).

## Success Criteria *(mandatory)*

- **SC-001**: Selecting an oblast yields a list `total` equal to that oblast's choropleth count
  (verified live: Стара Загора 128 → 638; = oblast + its 9 municipalities).
- **SC-002**: Selecting a single municipality yields its exact count, unchanged by the feature
  (Казанлък: 33).
- **SC-003**: Shift-selecting two oblasts (or two municipalities) issues a list request carrying both
  `geoUnitIds`; the drill-down union carries only the municipalities (no oblast id).
- **SC-004**: Under an oblast chat-scope, a municipality-specific question grounds on that
  municipality's datasets (verified: 28 citations, "Казанлък" in the injected grounding).
- **SC-005**: A generic query under a tight geo-scope retrieves the region's datasets instead of
  starving (verified: "регистри" scoped to Стара Загора went from 0 citations / 30 floundering
  searches to 58 citations / 2 searches after the scope-aware over-fetch + backfill).

## Out of scope
- Cross-level roll-up beyond municipality→oblast (e.g. region groupings of oblasts).
