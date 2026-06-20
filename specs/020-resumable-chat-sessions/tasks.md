# Tasks: Persistent & resumable chat sessions

Retrospective — all delivered. PR #58 = persistence + resume; PR #59 = mid-stream resume.

## Phase 1 — Persistence + resume (PR #58)

- [X] T001 [DATA] migration `013_chat_sessions.sql` — `chat_sessions` + `chat_messages` (+ indexes).
- [X] T002 [REPO] `PersistentSessionStore` implements `ConversationStore` + `listForUser` /
  `getForUser` / `deleteForUser`; ownership-scoped; title from first question; context persisted.
- [X] T003 [API] `GET/DELETE /api/me/sessions(/:id)` (owner-only) under `requireAuth`.
- [X] T004 [WIRE] `AppContext.chatSessions`; chat route uses the persistent store when wired; the user
  question persisted before the turn; prompt built from prior history + new question (snapshot fix).
- [X] T005 [WEB] collapsible "Разговори" list (load/delete) + `localStorage` restore of the open session.
- [X] T006 [TEST] `sessions-repo.test.ts` (resume, ownership, delete) + `sessions-routes.test.ts`.

## Phase 2 — Mid-stream resume (PR #59)

- [X] T007 [CORE] `GenerationManager` — detached `start`, `subscribe` (snapshot + live), `stop`,
  `activeForSession`, ownership lookup, grace eviction; injectable via `AppContext.generations`.
- [X] T008 [CHAT] chat route runs the turn via the manager; SSE subscribes + emits `message`;
  `runChatTurn`/`streamText` gain `abortSignal`.
- [X] T009 [API] `GET /api/me/generations/:id/stream` (re-attach) + `POST …/stop`; `streaming` hint on
  `GET /api/me/sessions/:id`.
- [X] T010 [WEB] `sendChat.onMessage` + `resumeChat`; auto re-attach on load; stop hits the server.
- [X] T011 [TEST] `generation-manager.test.ts` (live, snapshot replay, stop, eviction) +
  `generations-routes.test.ts` (replay, 404/ownership, stop).

## Verification

- [X] Backend 900 + e2e 15 + web-unit 70 green; biome + tsc clean.
- [X] Live on `:8790`: reload restores a conversation; disconnect mid-stream → re-attach completes →
  reply persisted.
