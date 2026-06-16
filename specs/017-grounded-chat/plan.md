# Implementation Plan: Trustworthy grounded chat (anti-fabrication, sticky context, auto-focus, value-filter)

**Branch**: `017-grounded-chat` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-grounded-chat/spec.md`
**Status**: Implemented (shipped in PRs #22, #26, #27, #28, #29 on `main`; verified by the test suite — 1004 pass at #29 — plus live runs against the LAN vLLM)

## Summary

The explorer chat (feature 008) is a backend-mediated, grounded, streaming tool-use loop over the four mirror tools, with a retrieval (RAG) fallback for providers that cannot do tool-calling. In practice it **fabricated** dataset contents: scoping a dataset only restricted which datasets the *tools* could read — the model was never told which dataset was focused nor shown its rows, so it confabulated (e.g. the Ихтиман register: 16 invented identical clubs vs. 10 real distinct clubs), and the RAG fallback fed it only titles.

This feature makes the chat **grounded by construction** across four prioritised slices under one responsibility ("the chat answers from real data, never fabricates"):

1. **Ground in the focused dataset's real rows (US1/P1, PR #26).** `buildFocusContext` pre-reads a capped sample of each focused dataset's resources and injects it as a "ДАННИ (ground truth)" block in BOTH the tool-loop and the RAG fallback; the focused dataset is always cited; the `SYSTEM_PROMPT` is hardened to never state a value not present verbatim and never fabricate to agree with the user.
2. **Sticky session grounding + history window (US2/P2, PR #27).** The session remembers what the conversation is "about" (`contextDatasetIds`: explicit focus else last cited, capped at 2) and re-injects those rows every turn; `windowMessages` replays only a recent message-count + char-budget window so long chats can't overflow context (grounding rows live in the system prompt, not the replayed transcript).
3. **Auto-focus the open reader dataset (US3/P3, PR #28).** A new request field `groundingDatasetIds` injects the reader-open dataset's rows WITHOUT narrowing tool scope; backend precedence explicit focus > reader > sticky. The per-resource fetch was raised to 1000 rows (was 50 — too few for a 569-row dataset, so район Панчарево rows never made the sample) under a 90k-char total budget. The web client sends the open reader's id.
4. **Value-filter on `readResource` + expose columns (US4/P4, PR #29).** `readResource` gains a `filters` arg (exact column → case-insensitive substring) forwarded to the grid query, returning only matching rows scanned across the whole resource; the focus block exposes each resource's column names and `resourceId`.

Plus **setup (PR #22):** the chat default provider is configured via `EXPLORER_DEFAULT_*` env (Bun auto-loads repo-root `.env`); a committed `.env.example`; `.env`/`.env.local` gitignored. The endpoint must support tool/function calling.

**Honest caveat:** grounding is robust by construction, but `gemma-4-26b-uncensored` is tool-shy & sometimes enumerates injected samples incompletely and does not reliably call the value-filter. Exact/exhaustive answers depend on a more faithful model; the data is fully available either way and the answer is always grounded (never fabricated).

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, `noUncheckedIndexedAccess`, no `any` outside type guards) — unchanged.
**Primary Dependencies**:
- Backend: Bun 1.x + Hono (`apps/explorer-api`); the `ai` SDK (`streamText`, `tool`, `stepCountIs`) for the tool-use loop and SSE; Zod for request validation; the in-process read API from feature 007 (`datasetView`, `readResourceRows`, `search`, `searchByEntity`) via `ReadBridge`.
- Frontend: the explorer web app (`apps/explorer-web`) — React + the explorer store; `sendChat` SSE client.
- Provider seam: OpenAI-compatible (self-hosted vLLM) and Anthropic; server default from `EXPLORER_DEFAULT_*` env (Bun-loaded `.env`).
**Storage**: No new table, no migration. Conversations and sticky context are in-memory, session-only (FR-019). Grounding reads off the existing curated store via `ReadBridge.rows(...)`.
**Testing**: `bun test` (Vitest hangs under Bun with `bun:sqlite`, per 001). New/updated suites: `apps/explorer-api/tests/chat-focus.test.ts`, `chat-session.test.ts`, `chat-route.test.ts`, `chat-tools.test.ts`.
**Target Platform**: Linux server (Bun) + browser SPA. The chat must run unsandboxed to reach the LAN vLLM embedder/provider.
**Project Type**: Web application (backend `apps/explorer-api` + frontend `apps/explorer-web`) over the existing mirror substrate.
**Performance Goals**: Grounded answer streams promptly; injected grounding block bounded to 90,000 chars; per-resource fetch ≤ 1000 rows; transcript replay ≤ 10 messages / 24,000 chars.
**Constraints**: Never overflow the model context (bounded injection + history window + size-capped tool results); never narrow tool scope via grounding; never persist/log credentials; authoritative Bulgarian fields verbatim.
**Scale/Scope**: Single focused dataset commonly 50–1000+ rows (e.g. 569-row София-град dataset); sticky context capped at 2 datasets re-read per turn; value-filter scans up to the grid cap (`MAX_GRID_SCAN` = 100k).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- **I. AI-Native Development (NON-NEGOTIABLE)** — PASS. The chat is a deterministic read interface over the synced mirror; it MUST NOT "invent, summarize, or otherwise alter authoritative portal data on the read path." This feature directly enforces that: grounding-by-construction + a hardened system prompt that forbids stating any value absent from a tool result/context. Authoritative Bulgarian fields are injected verbatim.
- **II. Spec-Driven Development (SDD)** — PASS (retrospective). WHAT in this spec.md; HOW here + data-model.md + contracts/; VALIDATION via the cited test suites and tasks.md.
- **III. Contract-First API Design** — PASS. The `/api/chat` request gains `groundingDatasetIds` and `readResource` gains `filters`; both are captured in `contracts/http-api.md` and `contracts/chat-tools.md` here, extending feature 008's contracts. Inputs Zod-validated; no invented portal abstractions (tools remain 1:1 wrappers over the read API).
- **V. Simplicity & YAGNI** — PASS. Grounding reuses the existing `readResourceRows`/grid query and `capResourceContent`; `filters` forwards to the existing grid filter; no new store, table, or abstraction. Each decision cites a concrete failure (fabrication, район recall gap, context overflow).
- **VII. Type Safety & Validation (NON-NEGOTIABLE)** — PASS. `groundingDatasetIds` and `filters` are Zod-validated at the boundary; strict mode throughout.
- **VIII. 100% Test Coverage & Endpoint Parity (NON-NEGOTIABLE)** — PASS. `buildFocusContext`, `windowMessages`, `SessionStore.setContext`, the `groundingDatasetIds` route field, `readResource` filter forwarding, and the column-exposure are unit/route tested. Full suite green (1004 at #29); lint + typecheck clean. The `/api/chat` endpoint and the four tool wrappers retain their parity-matrix rows from 008; the value-filter is an additive arg on the existing `readResource` wrapper.
- **IX. Data Freshness & Sync Integrity (NON-NEGOTIABLE)** — PASS. Citations carry the freshness block; the system prompt surfaces freshness and flags coded/translated values. No new sync path.
- **X. Bulgarian-Locale Awareness** — PASS. Cyrillic row values (names, ЕИК, район labels), column names, and the "ДАННИ (ground truth)" header are handled and injected verbatim; value-filter substring match is case-insensitive over Cyrillic. No authoritative field is rewritten or translated.

Mapped principle/FR citations used in the spec & contracts: **FR-016** (backend-mediated, answer only from retrieved mirror data, no fabrication — the grounding requirement), **FR-024** (credentials sent per request over TLS, never persisted/logged server-side; server-default key only in server config — the secret-handling requirement), **FR-019** (session-only, never persisted server-side — sticky context inherits this), **FR-023** (clear provider-misconfig errors, no fabricated answer), **FR-025** (scope narrows tool retrieval — distinct from grounding here).

No violations → Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/017-grounded-chat/
├── plan.md              # This file
├── spec.md              # Feature spec (4 user stories P1–P4 + setup)
├── research.md          # Why grounding-by-construction; injection vs value-filter; район recall gap; model-faithfulness caveat
├── data-model.md        # Conversation/contextDatasetIds; focus context block; groundingDatasetIds vs scope.datasetIds; windowMessages budget
├── quickstart.md        # Configure provider via .env; "ask about this dataset" / open-reader grounding; readResource filters
├── contracts/
│   ├── http-api.md      # /api/chat request fields incl. groundingDatasetIds + SSE event types
│   └── chat-tools.md    # readResource filters + exposed columns; grounding/citation contract delta
├── tasks.md             # Tasks grouped by the 4 user stories + setup (all [X])
└── checklists/
    └── requirements.md  # Requirements-quality checklist
```

### Source Code (repository root)

```text
apps/explorer-api/
├── src/
│   ├── chat/
│   │   ├── run.ts            # buildFocusContext, runToolLoop/runRagTurn, groundingDatasetIds, 90k budget, 1000-row fetch, column exposure
│   │   ├── grounding.ts      # SYSTEM_PROMPT hardening (anti-fabrication), Citation/MapAnchor, buildCitations/buildAnchors
│   │   ├── session.ts        # Conversation.contextDatasetIds, MAX_CONTEXT_DATASETS, SessionStore.setContext, windowMessages + budgets
│   │   ├── tools.ts          # readResource `filters` arg → grid query; tool descriptions
│   │   └── cap.ts            # capResourceContent (bounded by remaining budget)
│   └── routes/
│       └── chat.ts           # chatRequestSchema.groundingDatasetIds; grounding precedence; carry-forward; windowMessages replay
└── tests/
    ├── chat-focus.test.ts    # buildFocusContext rows/budget; focused-dataset citation w/o tools
    ├── chat-session.test.ts  # windowMessages (count+char), SessionStore.setContext (dedup/cap)
    ├── chat-route.test.ts    # groundingDatasetIds grounds+cites without hard scope; sticky-grounding follow-up
    └── chat-tools.test.ts    # readResource forwards filters to the grid

apps/explorer-web/
└── src/chat/
    ├── ChatPanel.tsx         # send groundingDatasetIds from the open reader
    └── sendChat.ts           # ChatRequestBody.groundingDatasetIds

.env.example                  # EXPLORER_DEFAULT_* provider config (vLLM + Anthropic examples)
.gitignore                    # .env / .env.local
```

**Structure Decision**: Web application — backend `apps/explorer-api` (Bun + Hono) and frontend `apps/explorer-web`, both on top of the existing mirror/read substrate (features 001/007/008). No new top-level structure; all changes are localized to the chat module, its route, the two web chat files, and the env config.

## Complexity Tracking

> No Constitution violations — this section is intentionally empty. The feature adds no new project, store, table, or abstraction; it reuses the existing read API, grid query, and size-capping, and adds two Zod-validated fields (`groundingDatasetIds`, `filters`).
