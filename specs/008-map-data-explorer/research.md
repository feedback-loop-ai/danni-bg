# Phase 0 Research: Interactive Bulgarian Map Data Explorer

**Feature**: 008-map-data-explorer
**Date**: 2026-06-05

This document resolves the open technical decisions for the explorer. Each entry records the **Decision**, **Rationale**, and **Alternatives considered**, plus how it satisfies the danni-bg constitution.

## R1. Backend: reuse the in-process read API vs. call the MCP server over a transport

**Decision**: The explorer backend imports and calls the existing in-process read API directly — `src/read/index.ts` (`datasetView`, `readResourceRows`) and `src/index/query.ts` (`search`, `searchByEntity`) — the same functions that back the MCP tools `mirror_search` / `mirror_info` / `mirror_entity_search` / `read_resource`. It does **not** spawn or proxy the MCP stdio server.

**Rationale**:
- Constitution V (Simplicity/YAGNI): the MCP tools are thin wrappers over `src/read`; going through an MCP transport would add a serialization hop and process boundary for no functional gain.
- Constitution I (read-only, faithful): reusing the same substrate guarantees the explorer and MCP clients return byte-identical curated data and freshness blocks.
- The clarification ("backend-mediated — a server component runs the danni-bg mirror tools") is satisfied: the server runs the same tool logic in-process.

**Alternatives considered**:
- *Spawn `danni mcp` and speak MCP over stdio/HTTP*: rejected — extra process, transport overhead, duplicate schema validation; no benefit since both live in this repo.
- *Re-query SQLite directly from new code*: rejected — bypasses the audited read layer and its freshness/validation invariants (Constitution VII/IX).

## R2. Backend web framework

**Decision**: **Hono** on Bun, serving a small JSON HTTP API plus a Server-Sent Events (SSE) endpoint for chat streaming.

**Rationale**:
- Bun-native, milliseconds to start (Constitution VI). Tiny, typed, zero-config; first-class `Request`/`Response` + streaming for SSE.
- Zod-validated route inputs at the boundary (Constitution VII), consistent with the existing codebase's Zod usage.

**Alternatives considered**:
- *Bun.serve() raw*: viable but reimplements routing/validation; Hono is a thin, well-tested layer.
- *Express/Fastify (Node)*: rejected — Node-oriented, slower start, against the locked Bun-first stack.

## R3. Frontend framework & build

**Decision**: **React + TypeScript built with Vite**, served as a static SPA. Light state via a small store (Zustand) for the shared `FilterState` and chat scope.

**Rationale**:
- Mature ecosystem for the three panels (map, filters, chat) and the richest MapLibre integration story (Constitution VI: Vite gives instant HMR).
- Zustand keeps the cross-cutting filter↔chat↔map linkage (FR-025..FR-028) in one small, testable store instead of prop-drilling.

**Alternatives considered**:
- *Svelte/SvelteKit*: smaller bundles, but weaker MapLibre/React-ecosystem tooling and less in-house familiarity.
- *Bun bundler instead of Vite*: usable, but Vite's HMR + plugin ecosystem (GeoJSON, env) is more proven; revisit if we want a single toolchain.

## R4. Map rendering library

**Decision**: **MapLibre GL JS** rendering a choropleth of Bulgaria from bundled GeoJSON/vector sources, with two feature layers: oblast (province) and obshtina (municipality), swapped/styled by zoom.

**Rationale**:
- Smooth GPU-accelerated zoom/pan (FR-002), data-driven styling for the per-region volume choropleth (FR-003), and click/hover feature queries for region selection (FR-004).
- Open-source, no API-key/tile-provider lock-in; can render entirely from locally bundled boundary data, keeping the app self-hostable alongside the offline-capable mirror.

**Alternatives considered**:
- *Leaflet + SVG/GeoJSON*: simpler, but SVG choropleth of all municipalities is heavier to interact with and pan less smoothly at scale.
- *D3-geo on canvas*: maximal control, but we'd hand-roll zoom/pan/hit-testing that MapLibre gives for free (Constitution V).

## R5. Administrative boundary data + crosswalk to mirror geo-entities

**Decision**: Bundle an open boundary dataset for Bulgaria at two levels and join it to the mirror's geographic entities by **stable administrative code**:
- **Oblast (province)** polygons ← NUTS3 / ISO-3166-2 boundaries (e.g. Eurostat GISCO). Join key: the gazetteer's `iso3166_2` field (e.g. `BG-18` for Ruse), already present in `src/enrich/gazetteer/bg-admin.ts`.
- **Obshtina (municipality)** polygons ← GISCO LAU (or OSM-derived) municipality boundaries. Join key: **EKATTE** (official Bulgarian administrative classifier code).
- A checked-in static **crosswalk** (`contracts/geo-crosswalk.schema.json` shape) maps each `geo:bg-oblast-*` / `geo:bg-municipality-*` entity id → boundary feature id (+ EKATTE). The crosswalk is generated from, and validated against, the existing gazetteer.

**Rationale**:
- The mirror stores geographic **entities** (ids + labels + confidence), not polygons — confirmed by `mirror_info` output and `bg-admin.ts`. Geometry must come from outside the mirror, exactly as the clarification states.
- Joining on official codes (ISO-3166-2, EKATTE) is robust against Cyrillic transliteration/spelling drift (Constitution X) — names are display-only, codes are the join.

**Open gap (tracked)**: the gazetteer currently lists all 28 oblasts but only a **sample** of municipalities. Full municipal coverage requires extending the gazetteer + crosswalk to all ~265 obshtinas. Plan tasks must include this data-completion step; until done, uncovered municipalities render as "boundary present, no gazetteer link" and are reachable via search/national grouping (FR-006).

**Alternatives considered**:
- *Join by name/slug only*: rejected — fragile across Cyrillic variants and Sofia-grad vs Sofia-oblast ambiguity (Constitution X).
- *Fetch boundaries live from an external tile service*: rejected — adds a network dependency and breaks the self-hostable/offline posture (Constitution IV graceful degradation).

## R6. LLM provider abstraction (configurable provider/model)

**Decision**: Use the **Vercel AI SDK (`ai`)** with provider adapters for **OpenAI-compatible** endpoints (`@ai-sdk/openai` with a configurable `baseURL`, covering OpenAI and self-hosted/local vLLM-style servers) and **Anthropic** (`@ai-sdk/anthropic`). The backend selects the adapter from the per-request provider config and runs a tool-calling loop with streaming.

**Rationale**:
- One uniform API for multi-provider selection (FR-021), tool/function calling, and token streaming over SSE — directly serves the configurable-provider requirement with minimal bespoke code.
- A configurable `baseURL` on the OpenAI-compatible adapter lets the project's own local model stack (memory: vLLM Qwen on the LAN) be a provider without extra adapters.

**Alternatives considered**:
- *Hand-rolled fetch per provider*: rejected — we'd reimplement tool-call orchestration, streaming, and retries for each provider (Constitution V).
- *LangChain*: rejected — heavier dependency surface than justified for a four-tool grounding loop.

## R7. Grounding mechanism (no fabrication)

**Decision**: The chat is a **retrieval-augmented tool-use loop**. The model is given four tools mapping 1:1 to the mirror read API — `mirrorSearch`, `mirrorEntitySearch`, `mirrorInfo`, `readResource` — and a system prompt that forbids factual claims about Bulgarian public data unless backed by a tool result. Every answer must carry **citations** (dataset ids → detail view + source URL). When tools return nothing relevant, the model must say so (FR-018). The backend post-validates that cited dataset ids exist in the mirror and strips/ô flags any uncited factual claim.

**Rationale**:
- Constitution I/VIII: the explorer must never invent or alter authoritative data; grounding + server-side citation validation makes fabrication detectable and testable (SC-004/SC-005).
- Reuses the curated `freshness` block so answers can state recency (Constitution IX).

**Alternatives considered**:
- *Stuff-the-context (no tools)*: rejected — corpus is far too large (thousands of datasets, million-row resources) and would force lossy truncation.
- *Trust model output, no validation*: rejected — violates the 0%-fabrication success criterion.

## R8. Filter ↔ chat scope linkage

**Decision**: The shared `FilterState` (tags, publisher, geo unit, freshness, free-text) is sent with each chat request as a **scope descriptor**. Backend tool wrappers apply the scope as a server-side post-filter on mirror results, so the model only ever sees in-scope datasets (FR-025). Answers returning region/dataset references include machine-readable anchors the frontend uses to highlight the map (FR-026/FR-027).

**Rationale**: Keeps the single source of truth (the curated mirror) untouched while constraining what the assistant can retrieve; deterministic and unit-testable.

**Alternatives considered**:
- *Pre-build a per-session filtered index*: rejected — premature optimization (Constitution V); post-filtering on already-ranked results is sufficient at this scale.

## R9. Conversation & provider-config persistence

**Decision**: Conversations are **session-only**, held in server memory keyed by an ephemeral session id, never written to the store (clarification + FR-019). Provider/model selection and user-supplied keys are persisted **client-side** (browser `localStorage`) and sent to the backend per request over TLS; the backend never persists or logs them (FR-024, Constitution IV security).

**Rationale**: Matches the clarified privacy posture; avoids introducing a new persistent store (Constitution V) and keeps secrets off the server.

**Alternatives considered**:
- *Server-side conversation history*: rejected for v1 — out of scope per clarification, adds storage + privacy surface.

## R10. Testing strategy under the 100%-coverage constitution

**Decision**:
- **Backend + shared pure logic** (filter composition, geo-crosswalk, scope post-filter, citation extraction/validation, provider request shaping, API handlers): **100% line + branch coverage** via Vitest, exercised against recorded mirror fixtures (no live network/LLM in the inner loop — Constitution VI). LLM providers are tested behind a seam with recorded/stubbed responses.
- **Backend API parity**: every HTTP endpoint and every model-facing tool wrapper has a contract test referencing its entry in `contracts/`, tracked in the existing `tests/parity-matrix.json` pattern (Constitution VIII).
- **Frontend behavior**: Vitest + Testing Library for component logic; **Playwright** E2E for the map/filter/chat journeys (US1–US5 acceptance scenarios).

**Decision (deviation, see Complexity Tracking)**: WebGL/MapLibre canvas rendering glue cannot be meaningfully line-covered in a jsdom environment. That thin rendering layer is isolated into clearly-marked modules, validated **behaviorally via Playwright** rather than counted toward the 100% line-coverage gate. All non-rendering logic remains at 100%.

**Rationale**: Honors the spirit of Constitution VIII (no untested logic path ships) while acknowledging that GPU canvas output is validated by behavior, not statement coverage. The deviation is bounded, documented, and minimized by keeping rendering modules logic-free.

**Alternatives considered**:
- *Claim 100% by excluding files via pragmas*: rejected — the constitution forbids `istanbul ignore`; honest segregation + E2E is the correct path.

## Resolved unknowns

All Technical Context items are resolved; no `NEEDS CLARIFICATION` remain. The one tracked **data gap** (full municipality gazetteer/crosswalk coverage) is an implementation task, not an unresolved design question.
