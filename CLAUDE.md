<!-- SPECKIT START -->
For a current overview of the system — the `sync → curate → enrich → index`
pipeline, storage/schema, the explorer + serving layer, and the entity knowledge
graph — read `docs/ARCHITECTURE.md`.

Feature specs live under `specs/` (each is a full spec.md/plan.md/tasks.md set).
Foundational data substrate: `specs/001-egov-data-sync/` (sync/curate/enrich/index/MCP).
Map explorer + grounded-chat baseline: `specs/008-map-data-explorer/`. Subsequent
capabilities each have their own spec:
- 009 document reader + server-side grid · 010 grid filters + faceted search ·
  011 new-conversation/empty-state
- 012 SVG choropleth + oblast→municipality drill-down (real 265-municipality LAU geometry)
- 013 hierarchical region roll-up · 014 publisher-derived geo recall ·
  015 `danni curate --entities-only`
- 016 entity knowledge graph (`entity_relations`, predicate `part_of`, `GET /api/entities/:id`)
- 017 trustworthy grounded chat (anti-fabrication grounding, sticky context, auto-focus, value-filter)
- 018 agentic quality evals (`eval/agentic`, DeepEval; `bun run eval:agentic`) + grounding
  completeness (RAG row injection) & transparency (opt-in `grounding` SSE event)
- 019 identity (Ory Kratos+Oathkeeper, `infra/ory` + `docker-compose.yml`), tiered users
  (admin/user in app `users` table), gated chat, admin platform settings (runtime LLM config) — phased
- 020 persistent & resumable chat sessions (`chat_sessions`/`chat_messages`, `/api/me/sessions`),
  mid-stream resume via the in-memory `GenerationManager` + `/api/me/generations/:id/{stream,stop}` —
  supersedes FR-019 (chat history is now persisted per user)
- 021 per-user token metering & quotas (`token_usage`, `users.token_limit/usage_reset_at`,
  `chat/quota.ts`; admin `/api/admin/usage` + per-user limit/reset, `/api/me/usage`; cache-hit
  weighting + admin-configurable `defaultTokenLimit`/`cachedTokenWeight`/`maxOutputTokens`)
- 022 account & chat-UX (avatar `UserMenu`, display name from Kratos traits, profile pictures
  `users.avatar_url` + `/api/me/avatar`, full `/auth/settings` page, appearance in settings, header
  GitHub link, chat input-bar layout/tooltips, removed in-chat provider override)
- 023 region multi-select (Shift+click union on the map) + hierarchical geo-filter roll-up
  (`geo-rollup.ts` `expandGeoUnitIds` + `ReadBridge.partOfChildren`): an oblast geo filter expands to
  its municipalities so the list/facets/chat scope match the choropleth count (Стара Загора 638≠128)
- 024 agentic-eval hardening (extends 018): the `eval/agentic` suite authenticates against the gated
  chat, adds judge-independent deterministic guards (`guards.py`), a frontier judge (Qwen 3.7 Plus on
  Alibaba Model Studio — gemma-26b is an unreliable judge), and enumeration + geo-scoped cases
- 025 chat answer presentation (signal-to-noise): the shared `SYSTEM_PROMPT` tells the chat to
  reference datasets by Bulgarian title and never print raw ids/UUIDs in the answer (the `citations`
  event still carries each dataset's id + source URL for the UI to link)

Project constitution: `.specify/memory/constitution.md` (v1.1.1; the locked test runner is `bun:test`).
<!-- SPECKIT END -->
