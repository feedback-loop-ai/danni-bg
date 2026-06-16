---
description: "Task list for 017-grounded-chat (retrospective — all shipped)"
---

# Tasks: Trustworthy grounded chat (anti-fabrication, sticky context, auto-focus, value-filter)

**Input**: Design documents from `/specs/017-grounded-chat/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Status**: Implemented — every task below is `[X]` (shipped in PRs #22/#26/#27/#28/#29 on `main`). Paths are real.

**Tests**: Tests were shipped with this feature (per the project's 100%-coverage constitution gate) and are listed inline.

**Organization**: Grouped by the four prioritised user stories (one responsibility: the chat answers from real data, never fabricates) plus the provider-config setup.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: independent (different file, no dependency)
- **[Story]**: US1–US4 or SETUP

---

## Setup — Configure the chat's default LLM provider (PR #22)

**Goal**: `/api/chat` resolves a default provider; secrets stay out of the repo.

- [X] S001 [SETUP] Add committed `.env.example` documenting `EXPLORER_DEFAULT_PROVIDER/MODEL/BASE_URL/API_KEY` with vLLM (tool-calling) + Anthropic examples — at repo root `.env.example`
- [X] S002 [SETUP] Gitignore `.env` and `.env.local` so real config/secrets are never committed — `.gitignore`
- [X] S003 [SETUP] Document that the endpoint MUST support tool/function calling (vLLM `--enable-auto-tool-choice`) — in `.env.example` comments

**Checkpoint**: Copying `.env.example` → `.env` makes the chat stream a grounded answer and invoke the mirror tools (Bun auto-loads repo-root `.env`).

---

## Phase: Foundational (shared grounding mechanism — blocks US2–US4)

**Purpose**: The grounding-by-construction core that the later stories extend.

- [X] F001 Add `buildFocusContext(bridge, datasetIds, resolve)` in `apps/explorer-api/src/chat/run.ts` — pre-reads a capped sample of each focused dataset's resources, returns `{ text, ids }`
- [X] F002 Define `FOCUS_HEADER` ("ДАННИ (ground truth) …") and sampling constants in `apps/explorer-api/src/chat/run.ts`

**Checkpoint**: Grounding block can be injected; later stories tune precedence, budget, and the value-filter.

---

## Phase US1 — Answers grounded in the focused dataset's real rows (Priority: P1) 🎯 MVP (PR #26)

**Goal**: A focused dataset is answered from its real rows; never fabricated; always cited.

**Independent Test**: Focus a dataset with known distinct rows; assert the answer reproduces only the real values and cites the dataset even with no tool call.

- [X] T101 [US1] Inject the focus block into the tool-loop system prompt in `runToolLoop` — `apps/explorer-api/src/chat/run.ts`
- [X] T102 [US1] Inject the focus block into the RAG fallback (rows, not just titles) in `runRagTurn` — `apps/explorer-api/src/chat/run.ts`
- [X] T103 [US1] Always cite the focused dataset(s): union `focus.ids` with tool-cited ids before `buildCitations` — `apps/explorer-api/src/chat/run.ts`
- [X] T104 [US1] Harden `SYSTEM_PROMPT` — never state a value not present verbatim in a tool result/context; never fabricate to agree with the user — `apps/explorer-api/src/chat/grounding.ts`
- [X] T105 [US1] Tests: `buildFocusContext` surfaces real row values; a focused dataset is cited with no tool call — `apps/explorer-api/tests/chat-focus.test.ts`

**Checkpoint**: Live re-run lists the 10 real clubs + real ЕИКs (matching the grid), notes empty rows; no fabrication. Suite 997 pass.

---

## Phase US2 — Sticky session grounding + history window (Priority: P2) (PR #27)

**Goal**: Follow-ups stay grounded in the same dataset; long chats can't overflow context.

**Independent Test**: First turn cites D; a follow-up with no scope and no tool call still cites D. A long transcript replays only a bounded window.

- [X] T201 [US2] Add `contextDatasetIds` to `Conversation`; `SessionStore.setContext` dedupes + caps at `MAX_CONTEXT_DATASETS` (2) — `apps/explorer-api/src/chat/session.ts`
- [X] T202 [US2] Add `windowMessages` (recent message-count + char budget; `MAX_HISTORY_MESSAGES`, `MAX_HISTORY_CHARS`; keeps last message) — `apps/explorer-api/src/chat/session.ts`
- [X] T203 [US2] Add `groundingDatasetIds` run option to `RunChatTurnOptions`; default `buildFocusContext` to it then `scope.datasetIds` — `apps/explorer-api/src/chat/run.ts`
- [X] T204 [US2] Route: choose grounding = explicit focus else sticky context; carry forward (focus else cited); replay `windowMessages(conv.messages)` — `apps/explorer-api/src/routes/chat.ts`
- [X] T205 [US2] Tests: `windowMessages` (count + char budget), `SessionStore.setContext` (dedup/cap) — `apps/explorer-api/tests/chat-session.test.ts`
- [X] T206 [US2] Test: route-level sticky grounding — follow-up with no scope/no tool call still cites the previous dataset — `apps/explorer-api/tests/chat-route.test.ts`

**Checkpoint**: "…клубове в Ихтиман" → "какви спортове има?" answers from the real clubs, not a clarification request. Suite 1001 pass.

---

## Phase US3 — Auto-focus the open reader dataset (Priority: P3) (PR #28)

**Goal**: The dataset open in the reader grounds row/район questions without narrowing tool scope; injection bounded.

**Independent Test**: `groundingDatasetIds: [D]` with no `scope.datasetIds` grounds + cites D; large dataset injection stays under the char budget and is flagged partial; grounding doesn't narrow scope.

- [X] T301 [US3] Add `groundingDatasetIds: string[]?` to `chatRequestSchema` (Zod, `.strict()`) — `apps/explorer-api/src/routes/chat.ts`
- [X] T302 [US3] Implement grounding precedence explicit focus > reader (`groundingDatasetIds`) > sticky context; mirror it in carry-forward — `apps/explorer-api/src/routes/chat.ts`
- [X] T303 [US3] Raise per-resource fetch to `FOCUS_ROWS` = 1000; add `GROUNDING_TOTAL_CHARS` = 90,000 running budget across all resources; cap via `capResourceContent(content, budget)`; flag partial — `apps/explorer-api/src/chat/run.ts`
- [X] T304 [P] [US3] Web: send the open reader's id as `groundingDatasetIds` (deliberate `chatFocus` still takes precedence) — `apps/explorer-web/src/chat/ChatPanel.tsx`
- [X] T305 [P] [US3] Web: add `groundingDatasetIds?` to `ChatRequestBody` and the request payload — `apps/explorer-web/src/chat/sendChat.ts`
- [X] T306 [US3] Tests: `groundingDatasetIds` grounds + cites without a hard scope; `buildFocusContext` honours the total char budget (flags partial) — `apps/explorer-api/tests/chat-route.test.ts`, `chat-focus.test.ts`

**Checkpoint**: With the София-град schools dataset focused, район Панчарево kindergartens are listed instead of "no data". Suite 1003 pass; web rebuilt.

---

## Phase US4 — Value-filter on readResource + expose column names (Priority: P4) (PR #29)

**Goal**: Exhaustive value questions answered exactly at the data layer; the model can target a column.

**Independent Test**: `readResource` with `filters` forwards to the grid and returns only matching rows; the focus block lists the resource's column keys.

- [X] T401 [US4] Add `filters?: Record<string,string>` to the `readResource` input schema; forward non-empty filters as `{ sort: null, filters }` to `bridge.rows(...)` — `apps/explorer-api/src/chat/tools.ts`
- [X] T402 [US4] Update the `readResource` description to instruct using `filters` (exact column → case-insensitive substring) for value questions — `apps/explorer-api/src/chat/tools.ts`
- [X] T403 [US4] Expose each grounded resource's exact column keys (`Колони: …`) + `resourceId` in the focus block; nudge to use `readResource` + `filters` when the sample is partial — `apps/explorer-api/src/chat/run.ts`
- [X] T404 [US4] Tests: `readResource` forwards filters to the grid; the focus block lists columns — `apps/explorer-api/tests/chat-tools.test.ts`, `chat-focus.test.ts`

**Checkpoint**: `readResource` with `{ "rayon": "Панчарево" }` returns only matching rows, exact + complete, independent of the inject budget. Suite 1004 pass.

---

## Dependencies & Execution Order

- **Setup** is independent; required at runtime for any live chat.
- **Foundational (F001–F002)** blocks US2–US4; US1 ships it together with its first consumers.
- **US1 (P1)** is the MVP: grounding-by-construction + anti-fabrication prompt.
- **US2 (P2)** depends on US1's grounding mechanism (adds sticky context + history window + the `groundingDatasetIds` run option).
- **US3 (P3)** depends on US2's precedence model (adds the `groundingDatasetIds` request field, reader wiring, and the bounded budget).
- **US4 (P4)** depends on US1's read path (adds the data-layer value-filter + column exposure).

### Within each story

- Backend grounding/route before web wiring; web tasks marked `[P]` are independent files.
- Tests accompany each story (constitution 100%-coverage gate).

## Notes

- Honest caveat (carried in spec Assumptions / SC): grounding is robust by construction, but `gemma-4-26b-uncensored` is tool-shy and may enumerate injected samples incompletely / not call the value-filter — exact/exhaustive answers depend on a more faithful model. The data is fully available either way and answers are never fabricated.
- All counts ("997/1001/1003/1004 pass") are the full-suite figures recorded in the respective PRs; lint + typecheck clean at each.
