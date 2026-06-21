# Data Model: Chat UX polish + live usage telemetry

One additive migration; no other schema change. Reuses the existing chat session/message storage
(spec 020) and the usage shape the server already computes for metering (spec 021).

## Migration `014_message_usage_duration.sql`

Two nullable columns on `chat_messages` (assistant turns only; null for user messages and pre-014
rows). **Applied with `bun run db:migrate`** — the explorer-api server does not auto-migrate.

| Column | Type | Notes |
|---|---|---|
| `usage_json` | TEXT (nullable) | JSON `{inputTokens, outputTokens, cachedInputTokens}` for the turn |
| `duration_ms` | INTEGER (nullable) | wall-clock reply time, server-measured over the run closure |

## App types

- **`MessageUsage`** (`chat/session.ts`): `{ inputTokens: number; outputTokens: number;
  cachedInputTokens: number }`.
- **`ChatMessage`** gains `usage?: MessageUsage` + `durationMs?: number`; `PersistentSessionStore`
  writes them on `append` and reads them in `messages()`.
- **Frontend** (`meApi.SessionMessage`, ChatPanel `ChatMessage`/`TurnUsage`): mirror `usage` +
  `durationMs`; re-hydrated from `getSession`.

## Transport: the `usage` SSE event (live, not persisted as such)

A new generation event, distinct from the persisted columns:

```
event: usage
data: {"inputTokens":19039,"outputTokens":517,"cachedInputTokens":9216}
```

- Emitted cumulatively per provider step + once authoritatively at the end (`GenEvent` `usage`).
- Forwarded live over the chat SSE and **replayed from the generation snapshot** on mid-stream resume
  (so a re-attaching client gets the current totals).
- `GET /api/me/sessions/:id` messages now include `usage` + `durationMs` (the persisted form).

No change to the metering tables (`token_usage`) — billing reads the same `readUsage(result)` as before.
