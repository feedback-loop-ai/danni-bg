# Data Model: Persistent & resumable chat sessions

## Persistent (SQLite) — migration `013_chat_sessions.sql`

### `chat_sessions`
A conversation owned by one app user.

| Column                | Type | Notes |
|-----------------------|------|-------|
| `id`                  | TEXT PK | UUID |
| `user_id`             | TEXT NOT NULL | app `users.id` (ownership; not Kratos id) |
| `title`               | TEXT | derived from the first user message (≤ 80 chars), COALESCEd |
| `context_dataset_ids` | TEXT NOT NULL DEFAULT `'[]'` | JSON array — sticky grounding context |
| `created_at`          | TEXT NOT NULL | ISO |
| `updated_at`          | TEXT NOT NULL | ISO; bumped on every append/context change |

Index: `idx_chat_sessions_user (user_id, updated_at DESC)` — the per-user list, newest first.

### `chat_messages`
An ordered message within a session.

| Column           | Type | Notes |
|------------------|------|-------|
| `id`             | TEXT PK | UUID |
| `session_id`     | TEXT NOT NULL | FK-by-convention to `chat_sessions.id` |
| `role`           | TEXT NOT NULL CHECK (`user`\|`assistant`) | |
| `content`        | TEXT NOT NULL | |
| `citations_json` | TEXT | JSON `Citation[]` (assistant only) |
| `anchors_json`   | TEXT | JSON `MapAnchor` (assistant only) |
| `created_at`     | TEXT NOT NULL | ISO; messages ordered by this |

Index: `idx_chat_messages_session (session_id, created_at)`.

Lifecycle: the user message is inserted before the turn; the assistant message on completion. Delete
removes the session and its messages (owner-checked). Citations/anchors are stored opaquely as JSON
so the repo (under `chat/`) needn't depend on the grounding types beyond serialization.

## Transient (in-memory) — `GenerationManager`

Not persisted; lives for the duration of a turn (+ a grace window). One process.

| Field         | Notes |
|---------------|-------|
| `messageId`   | per-turn id; also the SSE `message` event payload + the resume/stop path param |
| `sessionId`   | the conversation this turn belongs to (powers `activeForSession`) |
| `userId`      | app user id — ownership check for resume/stop |
| `text`        | accumulated assistant text so far (snapshot for reconnects) |
| `citations` / `anchors` | latest, for snapshot replay |
| `status`      | `streaming` \| `done` \| `error` (+ `error` message) |
| `listeners`   | active SSE subscribers |
| `abort`       | `AbortController` — server-side stop, forwarded to `streamText` |

Eviction: `graceMs` (default 60s, timer `unref`'d) after `done`/`error`, so a late reconnect still
replays the result, then the entry is dropped.
