# Implementation Plan: Persistent & resumable chat sessions

**Status**: Implemented (retrospective). Shipped as two PRs on `main`: #58 (persistence + resume) and
#59 (mid-stream resume — detached generations + live re-attach).

## Architecture

Two layers, deliberately separated:

1. **Durable history (SQLite).** `PersistentSessionStore` (`apps/explorer-api/src/chat/sessions-repo.ts`)
   implements the existing `ConversationStore` interface (`getOrCreate`/`append`/`setContext`) plus
   `listForUser`/`getForUser`/`deleteForUser`, all keyed by the app `users.id`. The in-memory
   `SessionStore` stays for focused unit tests; the real app wires the persistent one via
   `AppContext.chatSessions`. The interface lets the chat route stay store-agnostic.

2. **In-flight generations (in-memory).** `GenerationManager`
   (`apps/explorer-api/src/chat/generation-manager.ts`) runs a turn DETACHED from the request and
   buffers its output so a reconnecting client can re-attach. Keyed by a per-turn `messageId`;
   indexed by session for the "is a generation active?" hint. Finished generations linger for a grace
   window (default 60s, `unref`'d) so a late reconnect still gets the result.

### Request → generation flow (`routes/chat.ts`)

`POST /api/chat` (gated, quota-checked) persists the question, resolves the model, then
`generations.start({ messageId, sessionId, userId, run })` — `run` executes `runChatTurn` and, on
completion, persists the reply, meters usage, and carries the grounding context forward (all before
`done` fires, so an immediate reload finds the saved reply). The SSE response then just **subscribes**
to the generation (`streamGeneration`) and forwards events; it emits a new `message` event with the
`messageId`. Because the run is detached, closing the SSE doesn't stop it.

`streamGeneration` (shared by the initial POST and the reconnect endpoint): on subscribe it replays
the snapshot (text so far + citations/anchors — needed for reconnects; empty for a fresh turn), then
forwards live events until `done`/`error`. Subscribing before the (deferred) run starts means the
initial connection sees every token live, so the SSE is observationally identical to the old
synchronous handler — existing chat tests pass unchanged.

### Resume / stop (`routes/me.ts`)

- `GET /api/me/generations/:id/stream` — ownership-checked via the generation's recorded `userId`;
  re-attaches with `streamGeneration` (snapshot + live), or replays the just-finished result.
- `POST /api/me/generations/:id/stop` — ownership-checked; `generations.stop()` aborts the run via an
  `AbortController` whose signal is forwarded to `streamText` (new `runChatTurn` `abortSignal`).
- `GET /api/me/sessions/:id` includes `streaming: { messageId }` when `activeForSession` finds one.

### Frontend (`ChatPanel` + `sendChat`/`meApi`)

- `sendChat` exposes `onMessage`; new `resumeChat(messageId)` re-attaches to a generation's stream
  (shared SSE reader). `ChatPanel` shares one `attachStream` for both starting a turn and re-attaching.
- A collapsible **"Разговори"** list (load/delete); the open session id is kept in `localStorage`. On
  load, the panel restores the session and, if `streaming` is set, re-attaches automatically.
- **Stop** aborts the local read AND calls the server stop endpoint.

## Phases (as delivered)

- **Phase 1 (PR #58)** — migration 013 (`chat_sessions`, `chat_messages`); `PersistentSessionStore`;
  `/api/me/sessions` list/get/delete; chat route persistence; the history-list UI + localStorage
  restore. Fix: build the model prompt from prior history + the new question (the persistent
  `getOrCreate` returns a snapshot its `append` doesn't mutate).
- **Phase 2 (PR #59)** — `GenerationManager`; detached chat turns + `message` event; `runChatTurn`
  `abortSignal`; `/api/me/generations/:id/stream` + `/stop`; the `streaming` hint; frontend
  `resumeChat` + auto re-attach + server-side stop.

## Gotchas & decisions

- **Reverses FR-019.** Chat is gated (spec 019), so persisting an authenticated user's own
  conversation is acceptable; the privacy posture changed deliberately.
- **Snapshot, not mutation.** The persistent store returns immutable conversation snapshots; the chat
  route must not rely on `append` mutating them (caught as a "messages must not be empty" regression).
- **Subscribe-before-run.** `start` defers the run to a microtask so the initiating SSE subscribes
  first; the snapshot replay covers any race for reconnects.
- **In-memory limit.** Single process; a restart loses in-flight generations (FR-073). A durable job
  queue + incremental partial persistence would be required to survive restarts — out of scope.

## Testing

- Hermetic (`bun:test`, no live network — Constitution VI): `PersistentSessionStore` (resume,
  ownership, delete), `GenerationManager` (live stream, snapshot replay, stop, eviction), and the
  `/api/me/sessions` + `/api/me/generations` routes (replay, 404/ownership, stop) via `createApp`
  with an injected manager. Existing chat-route tests cover the unchanged SSE shape.
- Live (manual): on `:8790`, disconnect mid-stream → re-attach replays the full stream + `done` → the
  reply persists; reload restores the conversation.
