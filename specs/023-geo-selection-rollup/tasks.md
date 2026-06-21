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

## Phase 4 — Scope-aware retrieval (recall fix, backend)

- [x] T012 `mirrorSearch` tool: under a geo-scope, over-fetch the ranking (`GEO_SCOPED_SEARCH_LIMIT`)
  and backfill from the region's datasets (`entityDatasets` over the rolled-up geoUnitIds) so a tight
  scope never starves. (`chat/tools.ts`) — FR-100
- [x] T013 RAG path: same over-fetch + always-backfill-when-geo-scoped (not only on empty).
  (`chat/run.ts`, sharing `GEO_SCOPED_SEARCH_LIMIT`) — FR-100
- [x] T014 Verify: "регистри" under a Стара Загора scope 0→58 citations (was 30 floundering searches,
  now 2); 181 explorer-api tests + tsc + biome green.

## Phase 5 — Cross-region fabrication guardrail (backend + eval)

- [x] T015 `GEO_SCOPE_NOTE` appended to the system prompt under a geo-scope, on both the tool-loop and
  RAG paths, instructing the model to stay in-region. (`chat/grounding.ts`, `chat/run.ts`) — FR-101
- [x] T016 Eval: geo-scoped cases (`scope` field on Case); `geo-scope-recall` now asserts faithfulness
  (no longer xfail). (`eval/agentic/cases.py`, `test_agentic.py`)
- [x] T017 Verify: the previously-fabricating case now lists only in-region datasets and explicitly
  notes the regional restriction; faithfulness passes under the Qwen 3.7 Plus judge (was 0.10 / xfail).

## Notes
- No new tables/columns; reuses `entity_relations` `part_of` (specs 013/016).
- The underlying index `search()` has no geo restriction; the fix lives at the chat layer
  (over-fetch + region backfill) rather than changing the index query.
