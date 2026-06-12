# Quickstart: Interactive Bulgarian Map Data Explorer

**Feature**: 008-map-data-explorer

This explorer is a web surface layered on the existing danni-bg mirror. It reuses the in-process read API (`src/read`, `src/index/query.ts`) and adds two app packages plus bundled boundary data.

## Prerequisites

- Bun 1.x (project toolchain; see root `package.json`).
- A populated mirror store at the configured `storeRoot` (the `bun:sqlite` + sqlite-vec DB the crawler/sync produced). The explorer is read-only over it.
- For real chat answers: either a configured **server default provider** (env, see below) or a user-supplied provider key entered in the UI. Tests and the inner dev loop need **neither** — they use mirror fixtures and a stubbed LLM.

> Locale note: the mirror and embedder may require running unsandboxed to reach the LAN model/store, consistent with existing project setup.

## Install

```bash
bun install            # installs new deps: hono, ai, @ai-sdk/openai, @ai-sdk/anthropic (api);
                       # react, vite, maplibre-gl, zustand (web); playwright (e2e)
```

## Configure

Backend reads existing danni config plus explorer-specific env (all optional except store path which it inherits):

```bash
# Server default LLM provider (optional — enables zero-config chat out of the box)
export EXPLORER_DEFAULT_PROVIDER="openai-compatible"      # or "anthropic"
export EXPLORER_DEFAULT_BASE_URL="http://spark:8000/v1"   # the chat LLM endpoint (NOT the embedder)
export EXPLORER_DEFAULT_MODEL="<model-id>"                # e.g. a model served by your vLLM
export EXPLORER_DEFAULT_API_KEY="EMPTY"                   # vLLM ignores it; held in server config only, never logged
export EXPLORER_API_PORT=8790
```
User-supplied keys are entered in the UI, kept in browser `localStorage`, and sent per request over TLS — never persisted server-side.

> **Note**: the embedder (semantic search) and the chat LLM are separate endpoints — the embedder is `enrichment.embedder.endpointUrl` in `danni.config.json` (e.g. `http://spark:8889`), the chat LLM is `EXPLORER_DEFAULT_BASE_URL` (e.g. `http://spark:8000`).
>
> **Tool-calling vs. RAG fallback**: the grounded chat first tries an OpenAI tool-use loop. If the provider isn't started with tool-calling (e.g. vLLM without `--enable-auto-tool-choice`), the backend automatically falls back to a retrieval-augmented mode — it runs the mirror search itself and feeds the scoped datasets to the model as context — so grounded chat works with **any** OpenAI-compatible model.

## Run (development)

```bash
# Terminal 1 — backend API + SSE chat (Bun + Hono), hot-reloaded
bun run --hot apps/explorer-api/src/server.ts

# Terminal 2 — frontend SPA (Vite HMR)
bun run --cwd apps/explorer-web dev
```
Open the Vite dev URL. The SPA proxies `/api/*` to the backend. In production, the backend serves the built SPA as static assets.

## Verify the user journeys (maps to spec acceptance scenarios)

1. **US1 — Map exploration**: national oblast choropleth renders; zoom into a province → municipalities subdivide; click a unit → dataset list with title/publisher/freshness + working `data.egov.bg` source link. Click a no-data region → explicit "no datasets" empty state.
2. **US2 — Filters**: apply tag, publisher, geo, freshness, and free-text; map + lists narrow (AND across types); active filters show as removable chips; "clear all" restores the national view.
3. **US3 — Grounded chat**: ask (BG or EN) "Which regions publish air-quality data and how fresh is it?"; answer cites real datasets (with source links) and surfaces freshness; ask a question with no data → "no relevant public data found".
4. **US4 — Provider config**: set an OpenAI-compatible endpoint and a model, get a grounded answer; switch to Anthropic without losing the conversation; enter an invalid key → clear error, no fabricated answer.
5. **US5 — Linked map↔chat**: filter to one province + category, ask a question → answer stays within scope; an answer naming regions/datasets highlights and focuses them on the map.

## Test

```bash
bun run test          # Vitest: backend + shared logic (100% line+branch), with mirror fixtures + stubbed LLM
bun run coverage      # enforce 100% on backend + shared logic
bun run --cwd apps/explorer-web test      # component tests (Testing Library)
bun run --cwd apps/explorer-web e2e       # Playwright journeys (US1–US5); covers WebGL map behavior
bun run typecheck && bun run lint
```

CI gates (per constitution): 100% coverage on backend + shared logic, endpoint/tool **parity matrix** complete (`tests/parity-matrix.json`), Cyrillic round-trip assertions, freshness present on every dataset/citation payload, zero TS/Biome violations. The WebGL render glue is validated by Playwright, not line coverage (documented deviation — see plan Complexity Tracking).

## Key files

| Path | Purpose |
|------|---------|
| `apps/explorer-api/src/server.ts` | Hono app, routes, static SPA serving |
| `apps/explorer-api/src/routes/chat.ts` | SSE grounded chat endpoint |
| `apps/explorer-api/src/chat/{tools,scope,grounding,providers}.ts` | grounding loop + provider seam |
| `apps/explorer-api/src/read-bridge.ts` | adapts `src/read` + `src/index/query.ts` to API/tool shapes |
| `apps/explorer-web/src/map/` | MapLibre choropleth, highlight/focus |
| `apps/explorer-web/src/store/` | shared FilterState ↔ map ↔ chat scope |
| `packages/geo-boundaries/` | bundled GeoJSON + gazetteer crosswalk |
| `specs/008-map-data-explorer/contracts/` | HTTP API, chat tools, geo-crosswalk schema |
