# HTTP API: Per-user token metering & quotas

Gated (spec 019). `/api/admin/*` requires the admin tier; `/api/me/*` is any signed-in user, scoped
to the caller. Shared error envelope `{ error: { code, message } }`.

## POST /api/chat (delta)

- New rejection: **429** `{ error: { code: "quota_exceeded", message, details: { used, limit } } }`
  when the caller's billable usage is at/over their effective limit — returned before any model work.

## GET /api/me/usage

The caller's own usage + effective quota (billable `used`; raw breakdown).

```json
{ "used": 132, "limit": 5000000, "remaining": 4999868, "exceeded": false,
  "input": 100, "output": 50, "cached": 20, "requests": 1, "lastUsedAt": "2026-06-20T…Z" }
```
`limit: 0` ⇒ unlimited and `remaining: null`.

## GET /api/admin/usage  (admin)

```json
{ "defaultLimit": 5000000,
  "users": [ { "userId": "…", "email": "…", "displayName": "…", "role": "user",
               "tokenLimit": 1000, "used": 132, "input": 100, "output": 50, "cached": 20,
               "limit": 1000, "remaining": 868, "exceeded": false, "requests": 1,
               "lastUsedAt": "…" } ] }
```
`tokenLimit` is the per-user override (null = default); `limit` is the effective limit; `used` is the
billable total. 403 for a non-admin, 401 for anon.

## PUT /api/admin/users/:id/limit  (admin)

Body `{ "limit": number | null }` (null clears the override). → `{ "ok": true }` / 400 / 404.

## POST /api/admin/users/:id/reset  (admin)

Bumps the user's `usage_reset_at` (restarts their counter; history kept). → `{ "ok": true }` / 404.

## PUT /api/admin/settings (delta, admin)

`toggles` gains `defaultTokenLimit` (int ≥ 0), `cachedTokenWeight` (0–1), `maxOutputTokens` (int > 0).
Resolved per request; an edit applies without a restart.
