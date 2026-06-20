# Tasks: Region multi-select + hierarchical geo-filter roll-up

Retrospective task list (all complete). Grouped by the PR that landed them.

## Phase 1 — Map multi-select (PR #66, frontend)

- [x] T001 Store: replace `selectedRegionId` with `selectRegions(ids: string[])`; selection is
  `filters.geoUnitIds` (single source of truth). (`store/explorerStore.ts`) — FR-094/FR-095
- [x] T002 `MapView`: `selectedGeoIds: string[]` + `onSelect(ids)`; compute next set with layer
  context — country shift-toggle vs drill, drill-down union, drop parent oblast on municipality
  refine. (`map/MapView.tsx`) — FR-094/FR-095/FR-096
- [x] T003 Multi highlight (`selectedBoundaries`), single/multi info card, `Shift+клик` hint.
  (`map/MapView.tsx`) — FR-094
- [x] T004 `App.tsx`: pass `selectedGeoIds={filters.geoUnitIds}` + `onSelect={selectRegions}`.
- [x] T005 Tests: `explorerStore.test.ts` (set / clear / union); headless multi-select verification
  (country union, drill-down union with no oblast leak).

## Phase 2 — Oblast filter roll-up, explorer (PR #67, backend)

- [x] T006 Pure `expandGeoUnitIds(ids, childrenOf)`. (`geo-rollup.ts`) — FR-097
- [x] T007 `ReadBridge.partOfChildren()` — inverse of `partOfParents`. (`read-bridge.ts`) — FR-097
- [x] T008 `app.ts`: memoized `childrenOf()`, `expandGeo(f)`; apply in `scopedLites` (list / facets /
  national / regions) and the keyword-search branch of `/api/datasets`. — FR-098
- [x] T009 Tests: `geo-rollup.test.ts` (4 cases); live 128→638 (oblast) and 33 (municipality).

## Phase 3 — Chat geo-scope roll-up (this change, backend)

- [x] T010 `routes/chat.ts`: expand `scope.geoUnitIds` via `partOfChildren()` before `runChatTurn`,
  so both the hard scope filter (`inScope`) and the geo fallback (`run.ts`) consume the rolled-up set.
  — FR-099
- [x] T011 Verify: under an oblast chat-scope, a municipality-specific question grounds on that
  municipality's datasets (28 citations, "Казанлък" in the injected grounding); 181 explorer-api
  tests + tsc + biome green.

## Notes
- No new tables/columns; reuses `entity_relations` `part_of` (specs 013/016).
- Out of scope: tool-loop retrieval recall under a tight geo-scope (filter semantics fixed; ranking
  unchanged).
