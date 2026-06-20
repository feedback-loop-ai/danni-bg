# HTTP API: Persistent & resumable chat sessions

All routes are gated (spec 019 `requireAuth`); `/api/me/*` resolves the caller and scopes everything
to them. Errors use the shared envelope `{ error: { code, message } }`.

## POST /api/chat (delta)

Unchanged request/SSE contract from spec 017, plus:

- New SSE event **`message`** — `{ "messageId": "<uuid>" }`, emitted right after `session`. It is the
  generation id for mid-stream resume + server-side stop.
- The turn runs detached: closing this stream does NOT stop generation. 429 `quota_exceeded` and the
  provider-misconfig `error` paths are unchanged.

SSE event order: `session` → `message` → (`token`* / `tool`* / `grounding`?) → `citations` →
`anchors` → `done`, or `error`.

## GET /api/me/sessions

List the caller's conversations, newest first.

```json
{ "sessions": [ { "id": "…", "title": "Какви данни…", "updatedAt": "2026-06-20T…Z" } ] }
```

## GET /api/me/sessions/:id

Resume a conversation (owner-only; 404 otherwise).

```json
{
  "sessionId": "…",
  "messages": [ { "role": "user", "content": "…" },
                { "role": "assistant", "content": "…", "citations": [ … ] } ],
  "contextDatasetIds": ["…"],
  "streaming": { "messageId": "…" }   // present only while a generation is in flight
}
```

## DELETE /api/me/sessions/:id

Delete a conversation + its messages (owner-only). → `{ "ok": true }` / 404.

## GET /api/me/generations/:id/stream

Re-attach to an in-flight (or just-finished, within the grace window) generation. Owner-only (checked
via the generation's recorded user); 404 if unknown/foreign/evicted. SSE: replays `session` +
`message` + the produced `token`/`citations`/`anchors` snapshot, then live events through `done`/`error`.

## POST /api/me/generations/:id/stop

Stop the caller's in-flight generation server-side (aborts the model call). → `{ "ok": true }` / 404.
