# HTTP API: Account & chat-UX polish

Gated (spec 019); `/api/me/*` scoped to the caller.

## PUT /api/me/avatar

Set or clear the caller's profile picture.

- Body: `{ "avatarUrl": "data:image/webp;base64,…" | null }` — must match
  `data:image/(png|jpeg|webp);base64,` and be ≤ ~600 KB; `null` clears it.
- → `{ "avatarUrl": "…" | null }`; 400 on a bad/oversized payload; 401 anon.

## POST /api/auth/callback (delta)

The user object now includes the profile fields:

```json
{ "user": { "id": "…", "email": "…", "displayName": "Валентин Янакиев",
            "role": "user", "avatarUrl": "data:image/webp;base64,…" | null },
  "isAdmin": false }
```

`displayName` is derived from the Kratos `name` traits (null if unset); `avatarUrl` is the stored
picture (null if none).

## (No new chat endpoints)

The chat-UX changes (drop "Чат" header, ＋-in-bar, tooltips, removed provider override) are
client-only; the chat request always sends the server-default provider (`useServerDefault: true`).
