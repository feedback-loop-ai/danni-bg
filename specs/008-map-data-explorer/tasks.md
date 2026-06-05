---
description: "Task list for Interactive Bulgarian Map Data Explorer"
---

# Tasks: Interactive Bulgarian Map Data Explorer

**Input**: Design documents from `/specs/008-map-data-explorer/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (http-api.md, chat-tools.md, geo-crosswalk.schema.json), quickstart.md

**Tests**: INCLUDED — the spec and plan explicitly mandate them (Constitution VIII: 100% line+branch on backend + shared logic, a contract test per endpoint/tool wrapper tracked in `tests/parity-matrix.json`, Cyrillic/freshness assertions, and Playwright E2E for the WebGL render glue). Write each test before its implementation and confirm it fails first.

**Organization**: Tasks are grouped by user story (US1–US5) so each story is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 (Setup/Foundational/Polish carry no story label)
- All paths are repository-root-relative and exact

## Path Conventions

Multi-package monorepo (plan "Project Structure"): new `apps/explorer-api` (Bun + Hono backend), `apps/explorer-web` (React + Vite SPA), `packages/geo-boundaries` (bundled boundaries + crosswalk). Existing `src/read`, `src/index/query.ts`, `src/enrich/gazetteer/bg-admin.ts`, `src/logging` are reused unchanged.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Workspace, package scaffolding, and toolchains for backend, frontend, and the boundary package.

- [ ] T001 Establish monorepo workspaces — add `apps/*` and `packages/*` to root `package.json` workspaces and create the `apps/explorer-api/`, `apps/explorer-web/`, `packages/geo-boundaries/` directory trees per plan.md Project Structure
- [ ] T002 [P] Initialize `apps/explorer-api/package.json` (Bun) with deps `hono`, `zod`, `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic` and a `tsconfig.json` extending the repo strict TS config
- [ ] T003 [P] Initialize `apps/explorer-web/package.json` (Vite + React) with deps `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `maplibre-gl`, `zustand`; add `apps/explorer-web/vite.config.ts` with `/api` dev proxy to `EXPLORER_API_PORT`
- [ ] T004 [P] Initialize `packages/geo-boundaries/package.json` + `tsconfig.json` with a `data/` folder placeholder and `src/` entry
- [ ] T005 [P] Configure Vitest + `@vitest/coverage-v8` for `apps/explorer-api` and shared logic in `apps/explorer-api/vitest.config.ts` and `packages/geo-boundaries/vitest.config.ts` (100% line+branch thresholds)
- [ ] T006 [P] Configure Testing Library + Playwright for the SPA in `apps/explorer-web/vitest.config.ts` and `apps/explorer-web/playwright.config.ts`
- [ ] T007 [P] Wire lint/format/typecheck (Biome + `tsc --noEmit`) for the new packages into root scripts in root `package.json`
- [ ] T008 [P] Scaffold/extend `tests/parity-matrix.json` with empty rows for every endpoint and the four chat tool wrappers from `contracts/` (CI fails until each gains a contract-test id)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The read bridge, shared schemas, boundary/crosswalk module, server skeleton, and SPA shell that ALL user stories build on.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [ ] T009 Implement `apps/explorer-api/src/read-bridge.ts` adapting `src/read` (`datasetView`, `readResourceRows`) and `src/index/query.ts` (`search`, `searchByEntity`) into API/tool shapes; unit tests in `apps/explorer-api/tests/read-bridge.test.ts` (mirror fixtures)
- [ ] T010 [P] Implement `apps/explorer-api/src/logging.ts` re-exporting structured JSON logging from `src/logging` with a no-secrets field redactor
- [ ] T011 [P] Define shared Zod schemas + types in `apps/explorer-api/src/schemas.ts`: `FilterState`, `ScopeDescriptor`, error envelope, `RegionSummary`, `DatasetPointer`, `DatasetDetailView`, `Facets`, `FreshnessBlock` (per data-model.md); unit tests in `apps/explorer-api/tests/schemas.test.ts`
- [ ] T012 [P] Bundle administrative boundaries `packages/geo-boundaries/data/oblasts.geojson` (ISO-3166-2) and `packages/geo-boundaries/data/municipalities.geojson` (EKATTE LAU), each feature carrying `properties.boundaryFeatureId`, `level`, `ekatte?`, `iso3166_2?`
- [ ] T013 Implement `packages/geo-boundaries/src/load.ts` (Zod-validated GeoJSON + crosswalk loaders against `contracts/geo-crosswalk.schema.json`) and `packages/geo-boundaries/src/crosswalk.ts` (entityId ↔ boundaryFeatureId ↔ ekatte/iso3166_2 lookups); tests in `packages/geo-boundaries/tests/crosswalk.test.ts`
- [ ] T014 Generate `packages/geo-boundaries/data/crosswalk.json` from `src/enrich/gazetteer/bg-admin.ts` (all 28 oblasts mapped; sample municipalities mapped, rest listed under `knownGaps`) and add the bidirectional CI test in `packages/geo-boundaries/tests/crosswalk-integrity.test.ts` (no orphan rows; every gazetteer unit mapped or an explicit gap)
- [ ] T015 Implement `apps/explorer-api/src/server.ts` Hono skeleton: app construction, route wiring stubs, static SPA serving, and Zod-error → shared error-envelope middleware
- [ ] T016 [P] Implement `apps/explorer-api/src/routes/health.ts` (`GET /healthz`: lastSyncedAt, isStale, component status, `degraded` still-200) + contract test `apps/explorer-api/tests/routes/health.test.ts` and its `parity-matrix.json` row
- [ ] T017 [P] Implement SPA shell in `apps/explorer-web/src/main.tsx` + layout hosting map/filter/chat panels and the Zustand store in `apps/explorer-web/src/store/index.ts` (FilterState, map selection, chat scope)
- [ ] T018 [P] Implement `apps/explorer-web/src/lib/api.ts` (typed fetch client over `/api`) and `apps/explorer-web/src/lib/scope.ts` (FilterState → ScopeDescriptor encode) with tests in `apps/explorer-web/src/lib/scope.test.ts`

**Checkpoint**: Foundation ready — read bridge, schemas, boundaries, server, and SPA shell exist; user stories can proceed.

---

## Phase 3: User Story 1 - Explore public data on a map (Priority: P1) 🎯 MVP

**Goal**: A zoomable/pannable choropleth of Bulgaria weighted by dataset volume; clicking a region lists its datasets (title BG/EN, publisher, freshness) with one-hop source links and a dataset detail view; non-georeferenced datasets remain reachable.

**Independent Test**: Load the app → national oblast choropleth renders with per-region indicators → zoom to a province (municipalities subdivide) → click a unit → dataset list matches the mirror for that geo entity, each with a working `data.egov.bg` link; clicking a no-data region shows an explicit empty state.

### Tests for User Story 1 ⚠️

- [ ] T019 [P] [US1] Contract test `GET /api/regions` and `GET /api/regions/:entityId` (RegionSummary aggregates, in-scope counts, empty-state 200, unknown-id 404, unlinked `entityId:null`) in `apps/explorer-api/tests/routes/regions.test.ts` + parity rows
- [ ] T020 [P] [US1] Contract test `GET /api/datasets/:datasetId` and `GET /api/datasets/:datasetId/resources/:resourceId/rows` (detail reshape, paginated/sampled rows, freshness present, 404) in `apps/explorer-api/tests/routes/datasets-detail.test.ts` + parity rows
- [ ] T021 [P] [US1] Playwright E2E `apps/explorer-web/tests/e2e/us1-map.spec.ts`: national render → zoom → municipality subdivide → click → dataset list + working source link → no-data empty state

### Implementation for User Story 1

- [ ] T022 [P] [US1] RegionSummary aggregation in `apps/explorer-api/src/read-bridge.ts` (or `regions` helper): de-duplicated `datasetCount` across multi-region datasets, `hasData`, `maxConfidence`, crosswalk-joined `boundaryFeatureId`
- [ ] T023 [US1] Implement `apps/explorer-api/src/routes/regions.ts` `GET /api/regions` (level oblast|municipality, counts reflect FilterState) wired in `server.ts`
- [ ] T024 [US1] Implement `GET /api/regions/:entityId` in `apps/explorer-api/src/routes/regions.ts` (datasets for one unit, `limit`/`offset`, empty-state 200, 404 on unknown/unlinked)
- [ ] T025 [P] [US1] Implement `apps/explorer-api/src/routes/datasets.ts` `GET /api/datasets/:datasetId` → `DatasetDetailView` (description, resources w/ schema + freshness, entities, links, lifecycleState, sourceUrl)
- [ ] T026 [P] [US1] Implement `GET /api/datasets/:datasetId/resources/:resourceId/rows` in `apps/explorer-api/src/routes/datasets.ts` (paginated/sampled pass-through to `readResourceRows`, `truncated` flag, resource freshness)
- [ ] T027 [P] [US1] MapLibre setup in `apps/explorer-web/src/map/` — sources from `packages/geo-boundaries` GeoJSON, oblast + municipality layers swapped/styled by zoom (render glue; behavior covered by T021)
- [ ] T028 [US1] Data-driven choropleth in `apps/explorer-web/src/map/`: shade/badge by `datasetCount` from `/api/regions`, join by `boundaryFeatureId`, flag low-confidence placements
- [ ] T029 [US1] Region panel in `apps/explorer-web/src/datasets/`: on region click, list DatasetPointers (title BG/EN, publisher, freshness, source link) with explicit no-data empty state
- [ ] T030 [US1] Dataset detail view + national/non-georeferenced grouping in `apps/explorer-web/src/datasets/` (FR-005/FR-006), with one-hop source URL
- [ ] T031 [P] [US1] Pure display helpers in `apps/explorer-web/src/lib/format.ts` (bilingual label fallback, freshness rendering, machine-translation labelling per `translationConfidence`) + tests `apps/explorer-web/src/lib/format.test.ts`

**Checkpoint**: US1 is fully functional and demoable as the MVP.

---

## Phase 4: User Story 2 - Narrow the view with advanced filters (Priority: P2)

**Goal**: Combine tag, publisher, geographic-unit, freshness, and free-text filters (logical AND) over the curated mirror; map and lists update consistently; active filters appear as removable chips with one-action clear-all.

**Independent Test**: Apply each filter type individually and combined → visible datasets and highlighted regions narrow to exactly the matching set; clear all → full national view restored.

### Tests for User Story 2 ⚠️

- [ ] T032 [P] [US2] Contract test `GET /api/datasets` in `apps/explorer-api/tests/routes/datasets-list.test.ts`: `q`, `tags`, `publisherIds`, `geoUnitIds`, `freshness`, `includeWithdrawn`, AND semantics, ranking, `total`/`limit`/`offset` + parity row
- [ ] T033 [P] [US2] Contract test `GET /api/facets` in `apps/explorer-api/tests/routes/facets.test.ts`: in-scope counts recomputed against supplied filters + parity row
- [ ] T034 [P] [US2] Playwright E2E `apps/explorer-web/tests/e2e/us2-filters.spec.ts`: each filter + combinations, removable chips, clear-all restores national view

### Implementation for User Story 2

- [ ] T035 [P] [US2] Pure filter-composition lib in `apps/explorer-web/src/lib/filters.ts` (FilterState → query params, chip model) + tests `apps/explorer-web/src/lib/filters.test.ts`
- [ ] T036 [US2] Implement `apps/explorer-api/src/routes/datasets.ts` `GET /api/datasets` (free-text via `search`, entity via `searchByEntity`, curated AND post-filters, freshness, `includeWithdrawn` default false, pagination)
- [ ] T037 [US2] Implement `apps/explorer-api/src/routes/facets.ts` `GET /api/facets` (tags/publishers/freshnessBuckets with in-scope counts) wired in `server.ts`
- [ ] T038 [US2] Filter panel + chips in `apps/explorer-web/src/filters/` (tag, publisher, geo, freshness, free-text; removable chips; clear-all) bound to the store
- [ ] T039 [US2] Keep map highlighting + dataset lists consistent with FilterState (FR-014): de-emphasize non-matching regions, refresh `/api/regions` + `/api/datasets` on filter change
- [ ] T040 [US2] Rapid-change correctness in `apps/explorer-web/src/lib/api.ts`: request cancellation / last-write-wins so map and lists never show stale/out-of-order results (FR-032)

**Checkpoint**: US1 + US2 both work independently.

---

## Phase 5: User Story 3 - Ask questions in a grounded chat (Priority: P2)

**Goal**: A backend-mediated, streaming chat that answers strictly from the mirror via four tool wrappers, cites real datasets (with source links + freshness), says "no relevant public data found" when appropriate, and never fabricates.

**Independent Test**: Ask a verifiable BG/EN question → answer cites datasets that actually exist in the mirror with source links; ask a no-data question → explicit "no relevant public data found"; fabricated datasets/values/links appear in 0% of responses.

### Tests for User Story 3 ⚠️

- [ ] T041 [P] [US3] Contract tests for the four tool wrappers (`mirrorSearch`, `mirrorEntitySearch`, `mirrorInfo`, `readResource`) in `apps/explorer-api/tests/chat/tools.test.ts` — each references its underlying read function, asserts scope post-filter and `outOfScope` marker + parity rows
- [ ] T042 [P] [US3] Contract test `POST /api/chat` SSE in `apps/explorer-api/tests/routes/chat.test.ts` (stubbed LLM): event sequence (`session`/`token`/`tool`/`citations`/`anchors`/`done`), citation existence validation, no-data answer, no-fabrication + parity row
- [ ] T043 [P] [US3] Playwright E2E `apps/explorer-web/tests/e2e/us3-chat.spec.ts`: ask BG/EN question → streamed grounded answer + citations with source links; no-data question → explicit message

### Implementation for User Story 3

- [ ] T044 [P] [US3] Implement `apps/explorer-api/src/chat/scope.ts`: ScopeDescriptor → server-side post-filter over read results (empty = full mirror) + tests
- [ ] T045 [P] [US3] Implement `apps/explorer-api/src/chat/tools.ts`: four AI-SDK tool wrappers over `read-bridge`, applying scope (per `contracts/chat-tools.md`)
- [ ] T046 [P] [US3] Implement `apps/explorer-api/src/chat/providers.ts` provider seam with the OpenAI-compatible default adapter + a stub-model injection point for tests
- [ ] T047 [US3] Implement `apps/explorer-api/src/chat/grounding.ts`: system prompt, citation extraction, dataset-existence validation (drop hallucinated ids), scope validation, MapAnchor derivation, freshness/coded/translated flagging
- [ ] T048 [US3] Implement `apps/explorer-api/src/chat/session.ts`: in-memory, session-scoped conversation store (never persisted; FR-019)
- [ ] T049 [US3] Implement `apps/explorer-api/src/routes/chat.ts` `POST /api/chat` SSE: tool-use loop emitting `session`/`token`/`tool`/`citations`/`anchors`/`done`/`error`, wired in `server.ts`
- [ ] T050 [P] [US3] Chat panel in `apps/explorer-web/src/chat/`: SSE consumption, streamed tokens, citations with links + freshness, coded/machine-translated flags

**Checkpoint**: US1 + US2 + US3 all work independently (chat runs against the server default provider).

---

## Phase 6: User Story 4 - Configure the LLM provider and model (Priority: P3)

**Goal**: Users pick/configure an OpenAI-compatible or Anthropic provider + model, switch without losing conversation context, and get clear actionable errors on misconfiguration; selection persists client-side across sessions.

**Independent Test**: Configure two distinct providers/models, send the same question to each → both return grounded answers; switch provider mid-session without losing context; an intentionally invalid config yields a clear error with no fabricated answer.

### Tests for User Story 4 ⚠️

- [ ] T051 [P] [US4] Contract test provider selection in `apps/explorer-api/tests/chat/providers.test.ts`: openai-compatible + anthropic adapters, `useServerDefault`, `provider_unconfigured`/`provider_error` mapping to SSE `error` with no fabricated content + parity coverage
- [ ] T052 [P] [US4] Playwright E2E `apps/explorer-web/tests/e2e/us4-provider.spec.ts`: configure 2 providers, switch without losing context, invalid key → clear error

### Implementation for User Story 4

- [ ] T053 [US4] Extend `apps/explorer-api/src/chat/providers.ts`: add Anthropic adapter, server-default-from-env (`EXPLORER_DEFAULT_*`), and error mapping; ensure `apiKey` never logged/persisted (FR-024)
- [ ] T054 [P] [US4] Provider settings UI in `apps/explorer-web/src/chat/` (kind, model, baseUrl, apiKey, useServerDefault) persisted to `localStorage` via `apps/explorer-web/src/store/`
- [ ] T055 [US4] Send ProviderConfig per chat request and support switching provider mid-session without losing conversation; surface provider errors as actionable UI states

**Checkpoint**: US1–US4 all work independently.

---

## Phase 7: User Story 5 - Linked map and chat (Priority: P3)

**Goal**: Map filters scope chat retrieval (cited datasets ⊆ scope); assistant answers referencing regions/datasets highlight and focus them on the map; clearing filters expands and visibly updates chat scope.

**Independent Test**: Apply a filter, ask a question → answer only draws on the filtered subset; ask a question naming regions/datasets → those highlight and the map focuses them; selecting a cited dataset highlights its region(s) and opens its detail; clearing filters visibly expands chat scope.

### Tests for User Story 5 ⚠️

- [ ] T056 [P] [US5] Contract test in `apps/explorer-api/tests/chat/scope-linkage.test.ts`: cited datasets ⊆ scope (SC-008) and `anchors` derived from cited datasets' `geoEntityIds` (FR-026/FR-027)
- [ ] T057 [P] [US5] Playwright E2E `apps/explorer-web/tests/e2e/us5-linked.spec.ts`: filter + ask → in-scope answer; answer naming regions → highlight/focus; cited dataset → highlight + detail; clear filters → scope expands

### Implementation for User Story 5

- [ ] T058 [US5] Send current FilterState as `scope` with every chat request from `apps/explorer-web/src/chat/` (FR-025) using `lib/scope.ts`
- [ ] T059 [US5] Apply `anchors` MapAnchor in `apps/explorer-web/src/map/`: highlight referenced regions/datasets and bring them into focus (FR-026)
- [ ] T060 [US5] Cited-dataset selection in `apps/explorer-web/src/chat/` → highlight region(s) on map + open dataset detail (FR-027)
- [ ] T061 [US5] Reflect scope changes (including clear-all) into chat's available scope and make the change evident in the UI (FR-028)

**Checkpoint**: All five user stories independently functional and linked.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T062 [P] Complete municipality crosswalk: extend `src/enrich/gazetteer/bg-admin.ts` + `packages/geo-boundaries/data/crosswalk.json` toward all ~265 obshtinas, shrinking `knownGaps` (research R5 tracked gap); update `crosswalk-integrity.test.ts`
- [ ] T063 [P] Pagination/virtualization for large region/filter result sets in `apps/explorer-web/src/datasets/` (FR-030, SC-010)
- [ ] T064 [P] Enforce the coverage gate: 100% line+branch on `apps/explorer-api` + `packages/geo-boundaries`; confirm every `tests/parity-matrix.json` row has a contract-test id (CI)
- [ ] T065 [P] Cyrillic round-trip + freshness-present assertions across dataset/citation payloads in `apps/explorer-api/tests/invariants.test.ts` (Constitution IX/X)
- [ ] T066 [P] Verify structured logging and no-secrets-in-logs (provider `apiKey` redaction) in `apps/explorer-api/tests/logging.test.ts` (FR-024, Constitution IV)
- [ ] T067 Run `specs/008-map-data-explorer/quickstart.md` validation end-to-end (US1–US5 journeys) against a populated mirror
- [ ] T068 [P] Production build: backend serves the built SPA as static assets from `apps/explorer-api/src/server.ts`; document run in quickstart

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **User Stories (Phases 3–7)**: all depend on Foundational
  - US1 (P1) → US2 (P2) → US3 (P2) → US4 (P3) → US5 (P3) by priority, or in parallel by different developers
- **Polish (Phase 8)**: depends on the targeted user stories being complete

### User Story Dependencies

- **US1 (P1)**: depends only on Foundational. No dependency on other stories. (MVP)
- **US2 (P2)**: depends on Foundational; `GET /api/datasets`/`facets` it adds are consumed by, but do not require, US1's UI. Independently testable.
- **US3 (P2)**: depends on Foundational (read-bridge, schemas). Runs against the server default provider; independent of US2 (chat without filters = full-mirror scope).
- **US4 (P3)**: extends US3's provider seam (`providers.ts`) — sequence after US3.
- **US5 (P3)**: links US1 (map), US2 (filters/scope), US3 (chat) — sequence after those for full effect; backend scope-linkage (T056) is independently testable.

### Within Each User Story

- Tests (contract + E2E) written first and failing before implementation
- read-bridge/helpers → routes → frontend wiring
- Pure libs (scope, filters, format) before the components that consume them

### Parallel Opportunities

- All `[P]` Setup tasks (T002–T008) run together after T001
- Foundational `[P]` tasks (T010, T011, T012, T016, T017, T018) run together; T013 waits on T012, T014 waits on T013
- Once Foundational completes, US1–US3 can be staffed in parallel; US4 follows US3; US5 follows US1–US3
- Within a story, all test tasks marked `[P]` run together; independent route/lib files marked `[P]` run together
- Most Polish tasks (T062–T066, T068) run in parallel

---

## Parallel Example: User Story 1

```bash
# Tests first (all parallel — different files):
Task: "Contract test /api/regions in apps/explorer-api/tests/routes/regions.test.ts"          # T019
Task: "Contract test /api/datasets/:id (+rows) in apps/explorer-api/tests/routes/datasets-detail.test.ts"  # T020
Task: "Playwright US1 map journey in apps/explorer-web/tests/e2e/us1-map.spec.ts"             # T021

# Then parallel implementation across distinct files:
Task: "RegionSummary aggregation in apps/explorer-api/src/read-bridge.ts"                      # T022
Task: "Dataset detail route in apps/explorer-api/src/routes/datasets.ts"                       # T025
Task: "MapLibre setup in apps/explorer-web/src/map/"                                           # T027
Task: "Display helpers in apps/explorer-web/src/lib/format.ts"                                 # T031
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational — CRITICAL, blocks everything).
2. Complete Phase 3 (US1).
3. **STOP and VALIDATE**: run the US1 independent test (national render → zoom → click → datasets + source link → empty state).
4. Demo/deploy the map MVP.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → test → demo (MVP — spatial open-data browsing).
3. US2 → test → demo (filtered discovery at scale).
4. US3 → test → demo (grounded chat on default provider).
5. US4 → test → demo (configurable providers).
6. US5 → test → demo (linked map ↔ chat — the differentiator).

### Parallel Team Strategy

After Foundational: Developer A on US1, Developer B on US2, Developer C on US3 (default provider); US4 picks up after US3's provider seam lands; US5 integrates once US1–US3 are in place.

---

## Notes

- `[P]` = different files, no incomplete dependencies; `[Story]` maps each task to a user story for traceability.
- Tests are mandated by the constitution — write them first and confirm failure before implementing.
- WebGL/MapLibre render glue is validated behaviorally via Playwright, not line coverage (plan Complexity Tracking, Principle VIII deviation); all non-render logic stays at 100% line+branch.
- Every endpoint and chat tool wrapper must own a row in `tests/parity-matrix.json` (CI fails otherwise).
- Authoritative Bulgarian fields are passed through verbatim; freshness blocks appear on every dataset/resource/citation payload.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
