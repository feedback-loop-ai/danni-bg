# Feature Specification: Persistent & resumable chat sessions (incl. mid-stream resume)

**Feature Branch**: `020-resumable-chat-sessions`
**Created**: 2026-06-20
**Status**: Implemented (shipped in PRs #58 and #59 on `main`; verified by the full suite green — 900
backend + 15 e2e + 70 web-unit — and by live runs on `:8790` against the configured DeepSeek model)
**Input**: Retrospective spec for already-merged work. The chat was in-memory only: a reload lost the
conversation, and an answer in progress was lost if the client disconnected. Make conversations
persistent + resumable per user, and keep a generation running server-side across a disconnect so the
client can re-attach to the live stream.

## Clarifications

### Session 2026-06-20

- Q: Should conversations be persisted at all? This reverses FR-019 ("conversations are NEVER
  persisted server-side"). → A: **Yes — persist.** A user's questions AND replies are saved per user
  so a conversation survives reloads/restarts and can be reopened and continued. FR-019 is
  superseded for authenticated chat (chat is already gated behind login per spec 019).
- Q: Where does chat history live? → A: **App SQLite**, per-user: `chat_sessions` + `chat_messages`,
  keyed by the app `users.id`. Citations/anchors are kept as JSON for faithful re-render. Every read
  is ownership-scoped (a user can never see another's conversation).
- Q: How is a conversation surfaced for resume? → A: A **collapsible "Разговори" list** at the top of
  the chat panel (newest first); click to load + continue, trash to delete. The open conversation id
  is kept in `localStorage` so a reload reopens it.
- Q: What does "mid-stream resume" mean — re-attach to the live stream, or just never lose the
  answer? → A: **Full live re-attach.** The generation runs DETACHED from the request, so a
  disconnect doesn't kill it; a reconnecting client re-attaches to the live token stream (replays
  what's produced so far, then continues in real time).
- Q: What happens to the answer if the user disconnects mid-generation? → A: The generation keeps
  running server-side to completion and persists; the user's question was already persisted before
  the turn began, so nothing is lost.
- Q: How is an in-flight generation tracked + re-attached? → A: An in-memory `GenerationManager`
  (single process) keyed by a per-turn `messageId`. The chat SSE emits a new `message` event with
  that id; reconnect is `GET /api/me/generations/:id/stream` (snapshot replay + live), stop is
  `POST /api/me/generations/:id/stop` (server-side abort). `GET /api/me/sessions/:id` returns a
  `streaming: { messageId }` hint when a generation is in flight.
- Q: What's the durability limit? → A: In-memory / single-process — a **server restart discards
  in-flight generations**. The question stays persisted (the user re-asks); resuming a half-generated
  *LLM* stream across a process restart is not possible (the provider stream can't be re-opened).

## User Scenarios & Testing *(mandatory)*

One responsibility: **a signed-in user's chat conversations are durable and resumable, including
re-attaching to an answer that is still generating.**

### User Story 1 — Conversations persist and resume (Priority: P1)

A signed-in user asks questions; each conversation (questions + replies, with citations) is saved.
The chat panel lists past conversations; opening one restores its full transcript and lets the user
continue it. Reloading the app reopens the last conversation. A user only ever sees their own.

**Acceptance**: ask → reload → the conversation (Q + A + citations) is intact and continuable; the
list shows it titled by its first question; deleting removes it; another user gets 404 for it.

### User Story 2 — Mid-stream resume (Priority: P1)

While an answer is streaming, the user reloads (or their connection drops). The generation keeps
running on the server; on reload the client re-attaches to the live stream — it shows what was
produced so far and then the remaining tokens in real time — and the finished reply is saved.

**Acceptance**: start a turn → disconnect mid-stream → re-attach → the answer continues to completion
and is persisted. A "stop" halts the generation server-side, not just the local connection.

### Edge Cases

- Disconnect before the first token → reload shows the persisted question and re-attaches to the
  still-running generation.
- Reconnect after the generation finished (within the grace window) → the result is replayed, then
  `done`. After eviction / a server restart → the persisted reply is shown if completed, else the
  question stands alone (re-ask).
- Resuming a session id that isn't the caller's → 404 (ownership). Opening a generation that isn't
  the caller's → 404.

## Requirements *(mandatory)*

- **FR-063**: The system MUST persist each chat turn's question to the user's conversation BEFORE the
  generation begins (so the question survives a failed/aborted turn).
- **FR-064**: The system MUST persist the assistant reply (with its citations + anchors) on
  completion of the turn.
- **FR-065**: Conversations and their messages MUST be per-user; list/read/delete MUST be restricted
  to the owner (others get 404).
- **FR-066**: A user MUST be able to list their conversations (newest first), open one to resume its
  full transcript, and delete one.
- **FR-067**: A conversation MUST be titled from its first user message.
- **FR-068**: The conversation's sticky grounding context MUST be persisted so a resumed conversation
  stays grounded across turns (supersedes the in-memory-only behaviour of FR-019/spec 017).
- **FR-069**: A turn MUST run detached from the initiating request; a client disconnect MUST NOT
  abort the generation.
- **FR-070**: A reconnecting client MUST be able to re-attach to an in-flight generation, receiving a
  snapshot of what's been produced so far followed by the remaining events live, ending in `done`/`error`.
- **FR-071**: A user MUST be able to stop their own in-flight generation server-side; stopping MUST
  abort the model call (not merely close the local connection).
- **FR-072**: The client MUST restore the last open conversation on reload (persisted id), and
  re-attach automatically if that conversation is still generating.
- **FR-073**: Generation registry state is in-memory/single-process; a server restart MAY discard
  in-flight generations. Persisted questions/replies MUST remain intact across restart.

## Success Criteria *(mandatory)*

- **SC-001**: After a reload, a completed conversation shows its full transcript (Q + A + citations).
- **SC-002**: A question asked then reloaded before the answer arrives is still present.
- **SC-003**: Disconnecting mid-answer and reconnecting shows the answer continue and complete; the
  reply is persisted.
- **SC-004**: A user cannot list, read, or delete another user's conversation, nor open/stop another
  user's generation (404).
- **SC-005**: The behaviour is covered by hermetic tests (the persistent store, the generation
  manager, and the `/api/me/sessions` + `/api/me/generations` endpoints) with the suite green.

## Key Entities

- **chat_sessions** — a conversation owned by one app user (title, sticky context, timestamps).
- **chat_messages** — an ordered message in a session (role, content, citations/anchors JSON).
- **Generation** (transient, in-memory) — an in-flight turn: accumulated text, status, listeners, an
  abort handle; addressed by a per-turn `messageId`.
