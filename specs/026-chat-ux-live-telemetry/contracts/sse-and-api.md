# Contracts delta: live usage event + per-message telemetry

No REST shape break; additive only.

## New SSE event on the chat stream

`POST /api/chat` (and the resume stream `GET /api/me/generations/:id/stream`) emit a new event
alongside the existing `session` / `message` / `token` / `tool` / `citations` / `anchors` /
`grounding` / `done` / `error`:

```
event: usage
data: {"inputTokens": number, "outputTokens": number, "cachedInputTokens": number}
```

- Emitted **cumulatively per provider step** (so ↑ input / ↓ output climb live) and once more,
  **authoritative**, at the end of the turn.
- **Replayed from the generation snapshot** on mid-stream resume, so a re-attaching client receives the
  current totals immediately.
- Clients that ignore it are unaffected (additive).

## `GET /api/me/sessions/:id` — message fields

Each assistant message may now carry (additive, optional):

- `usage`: `{ inputTokens, outputTokens, cachedInputTokens }`
- `durationMs`: number (server-measured reply time)

Used to re-render the per-turn footer on reload/resume.

## Static

- `GET /favicon.svg` → `200 image/svg+xml` (served from `apps/explorer-web/public/`).

## Unchanged

- Token metering endpoints/tables (`token_usage`, `/api/me/usage`, `/api/admin/usage`, spec 021) — the
  `usage` event is a read-out of the same figures, not a new billing source.
