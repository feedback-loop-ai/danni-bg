# Implementation Plan: Interactive Bulgarian Map Data Explorer

**Branch**: `008-map-data-explorer` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/008-map-data-explorer/spec.md`

## Summary

Build a self-hostable web application that turns the curated `data.egov.bg` mirror into an explorable map of Bulgaria. Three linked surfaces: (1) a zoomable MapLibre choropleth of provinces/municipalities weighted by available data; (2) an advanced filter panel over tag/publisher/geo/freshness/free-text; (3) a backend-mediated, grounded chat over a configurable LLM provider that answers strictly from the mirror via four tool wrappers and cites its sources. Map filters and chat scope are bidirectionally linked.

**Technical approach**: A thin Bun backend (Hono) reuses the existing in-process read API (`src/read`, `src/index/query.ts`) — the same substrate that backs the MCP tools — exposing a small JSON API plus an SSE chat endpoint that runs a retrieval-augmented tool-use loop against the configured provider (via the Vercel AI SDK). A React+Vite SPA renders the map from bundled administrative-boundary GeoJSON joined to mirror geo-entities by official code (ISO-3166-2 / EKATTE), and hosts the filter and chat panels sharing one filter/scope store. No new persistent store: conversations are session-only in memory; provider keys live client-side.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode) on Bun 1.x (backend + tooling); same TS for the React frontend
**Primary Dependencies**: Backend — Hono (HTTP/SSE), Zod (boundary validation), Vercel AI SDK `ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic` (configurable provider); reuse of in-repo `src/read` + `src/index/query.ts`. Frontend — React, Vite, MapLibre GL JS, Zustand (shared filter/scope state)
**Storage**: Read-only reuse of the existing `bun:sqlite` + sqlite-vec mirror store via `src/read`. No new persistent storage. Conversations: in-memory, session-scoped. Provider config/keys: client-side `localStorage`
**Testing**: Vitest (+ @vitest/coverage-v8) for backend and shared/pure frontend logic at 100% line+branch; Testing Library for components; Playwright for E2E user journeys; mirror fixtures + stubbed LLM responses for the offline inner loop
**Target Platform**: Self-hostable Linux service (Bun backend serving the static SPA), desktop-first modern browsers
**Project Type**: Web application (frontend SPA + backend API) layered on the existing MCP-mirror monorepo
**Performance Goals**: Filter/map updates reflected ≤2s for typical combinations (SC-003, SC-010); first grounded answer streaming begins promptly; smooth (interactive) map zoom/pan across national→province→municipality
**Constraints**: Read-only and faithful to authoritative data (no fabrication, 0% per SC-005); honest freshness on every dataset/citation (Constitution IX); Cyrillic-safe end-to-end, authoritative BG fields never rewritten (Constitution X); secrets never persisted/logged server-side (FR-024); self-hostable/offline-capable (boundaries bundled, mirror local)
**Scale/Scope**: Thousands of datasets; individual resources up to ~1.25M rows (must summarize/sample, never bulk-load); 28 oblasts + ~265 municipalities; 5 user stories (P1–P3), 33 functional requirements

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. AI-Native / read-only, faithful | ✅ Pass | Reuses `src/read`; chat grounded with server-side citation validation; never mutates authoritative data |
| II. Spec-Driven Development | ✅ Pass | spec → clarify → plan → (tasks next); artifacts in this dir |
| III. Contract-First | ✅ Pass | Backend HTTP API, chat tool wrappers, and geo-crosswalk defined in `contracts/` before code |
| IV. Operational Excellence | ✅ Pass | Structured JSON logging, `/healthz` with last-sync/staleness, graceful degradation (serve last synced corpus + `is_stale`), no secrets in logs |
| V. Simplicity & YAGNI | ✅ Pass | In-process read reuse (no MCP proxy), no new store, post-filter over ranked results; each dep justified in research.md |
| VI. Fast Feedback Loops | ✅ Pass | Bun + Vite HMR; unit suite <5s; offline fixtures for mirror + stubbed LLM |
| VII. Type Safety & Validation | ✅ Pass | TS strict; Zod validates API inputs, provider config, boundary/crosswalk, tool IO |
| VIII. 100% Coverage & Parity | ✅ Pass | 100% on backend + shared logic; every endpoint & tool wrapper in parity matrix. WebGL render glue covered by the constitution's sanctioned render-glue exception (Principle VIII, v1.1.0): logic-free modules validated via Playwright E2E and enumerated in parity matrix — see Complexity Tracking |
| IX. Data Freshness & Sync Integrity | ✅ Pass | Freshness block surfaced in dataset views and chat citations; `is_stale` honored; no silent staleness |
| X. Bulgarian-Locale Awareness | ✅ Pass | Cyrillic UTF-8 throughout; authoritative fields shown verbatim; machine-translated text labelled; geo join by code not name |
| XI. Respectful Crawling | ➖ N/A | This feature performs no portal crawling; it only reads the local mirror |

**Gate result**: PASS (one documented, bounded deviation under Principle VIII — recorded in Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/008-map-data-explorer/
├── plan.md              # This file
├── research.md          # Phase 0 decisions (R1–R10)
├── data-model.md        # Phase 1: entities & view models
├── quickstart.md        # Phase 1: run/dev/test instructions
├── contracts/           # Phase 1: HTTP API + chat tools + geo-crosswalk schemas
│   ├── http-api.md
│   ├── chat-tools.md
│   └── geo-crosswalk.schema.json
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

The explorer is added as two new app packages plus a small shared boundary/crosswalk module, reusing the existing `src/read` substrate unchanged.

```text
apps/
├── explorer-api/                 # Bun + Hono backend (backend-mediated chat + map/data API)
│   ├── src/
│   │   ├── server.ts             # Hono app, route wiring, static SPA serving
│   │   ├── routes/
│   │   │   ├── regions.ts        # GET /api/regions, /api/regions/:id (aggregates + datasets)
│   │   │   ├── datasets.ts       # GET /api/datasets (filter/search), /api/datasets/:id (detail)
│   │   │   ├── facets.ts         # GET /api/facets (tags, publishers, freshness buckets)
│   │   │   ├── chat.ts           # POST /api/chat (SSE stream; grounded tool-use loop)
│   │   │   └── health.ts         # GET /healthz (last sync, staleness, component status)
│   │   ├── chat/
│   │   │   ├── providers.ts      # Provider selection (OpenAI-compatible | Anthropic) via AI SDK
│   │   │   ├── tools.ts          # mirrorSearch/mirrorEntitySearch/mirrorInfo/readResource wrappers
│   │   │   ├── scope.ts          # FilterState → server-side scope post-filter (FR-025)
│   │   │   ├── grounding.ts      # system prompt, citation extraction + existence validation
│   │   │   └── session.ts        # in-memory, session-scoped conversation store
│   │   ├── read-bridge.ts        # adapts src/read + src/index/query.ts to API/tool shapes
│   │   └── logging.ts            # reuse src/logging (structured JSON)
│   └── tests/                    # contract + integration (Vitest, mirror fixtures, stubbed LLM)
└── explorer-web/                 # React + Vite SPA
    ├── src/
    │   ├── main.tsx
    │   ├── store/                # Zustand: FilterState, chat scope, map selection
    │   ├── map/                  # MapLibre setup, choropleth layers, highlight/focus (render glue)
    │   ├── filters/              # advanced filter panel + chips
    │   ├── chat/                 # chat panel, streaming, citations, provider settings
    │   ├── datasets/             # region/dataset list + detail views (freshness, source link)
    │   └── lib/                  # pure logic: filter compose, scope encode, citation map (100% tested)
    └── tests/                    # component (Testing Library) + e2e (Playwright)

packages/
└── geo-boundaries/               # bundled admin-boundary data + crosswalk
    ├── data/
    │   ├── oblasts.geojson        # province polygons (NUTS3 / ISO-3166-2)
    │   └── municipalities.geojson # obshtina polygons (LAU / EKATTE)
    ├── src/
    │   ├── crosswalk.ts           # geo:bg-* entity id ↔ boundary feature id ↔ EKATTE
    │   └── load.ts                # validated loaders (Zod against geo-crosswalk schema)
    └── tests/

# Reused unchanged:
src/read/                          # datasetView, readResourceRows  (in-process read API)
src/index/query.ts                 # search, searchByEntity
src/enrich/gazetteer/bg-admin.ts   # oblast/municipality ids + iso3166_2 (crosswalk source of truth)
src/logging/                       # structured logging
```

**Structure Decision**: Web-application shape (frontend + backend) realized as `apps/explorer-api` and `apps/explorer-web`, with shared boundary/crosswalk logic in `packages/geo-boundaries`. This keeps the new UI/chat surface cleanly separated from the existing crawler/sync/MCP code while **reusing `src/read` in-process** (research R1) so the explorer and MCP clients serve identical curated data. The existing single-project `src/` tree is preserved untouched; the monorepo gains `apps/` and `packages/` siblings.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle VIII sanctioned render-glue exception: WebGL/MapLibre render glue validated by Playwright E2E rather than 100% line coverage (constitution v1.1.0) | GPU canvas output (tile/layer paint) has no meaningful statement-coverage signal in jsdom; forcing it would invite mocks that assert nothing | Faking 100% via `istanbul ignore` is explicitly forbidden by the constitution; segregating logic-free render modules + behavioral E2E is the honest minimum. All non-render logic stays at 100% line+branch. **Enumerated render-glue modules** (exhaustive, per Principle VIII (b)/(c)): `apps/explorer-web/src/map/` MapLibre setup + layer/paint wiring only — every map module containing logic (choropleth value mapping, region join, anchor application) is extracted and stays at 100% |
| New `apps/` + `packages/` alongside existing `src/` (multi-package monorepo) | Feature is a distinct web surface (SPA + HTTP/SSE) with different runtime/build than the CLI/MCP server; mixing into `src/` would entangle build targets | A single `src/` tree can't cleanly host a Vite SPA + a long-running HTTP server + the existing CLI without conflicting build/test configs; separation is the simpler long-run structure |

## Phase Outputs

- **Phase 0** → `research.md` (complete; R1–R10, no unresolved NEEDS CLARIFICATION; one tracked data gap: full municipality crosswalk coverage).
- **Phase 1** → `data-model.md`, `contracts/http-api.md`, `contracts/chat-tools.md`, `contracts/geo-crosswalk.schema.json`, `quickstart.md`; agent context (`CLAUDE.md`) updated to point here.
- **Phase 2** → `tasks.md` via `/speckit-tasks` (not produced by this command).

## Post-Design Constitution Re-Check

Re-evaluated after Phase 1 artifacts: contracts are defined before code (III); freshness blocks appear in `data-model.md` view models and chat citation contract (IX); Zod schemas guard every boundary (VII); Cyrillic handling and code-based geo joins are specified (X); reuse of `src/read` keeps the read path faithful (I, V). No new violations introduced. **Gate still PASS** with the single documented Principle VIII deviation.
