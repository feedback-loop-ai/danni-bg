# Data Model: Account & chat-UX polish

Mostly UI + wiring on top of spec 019; the only schema change is the avatar column.

## `users.avatar_url` — migration `012_user_avatar.sql`

| Column       | Type | Notes |
|--------------|------|-------|
| `avatar_url` | TEXT | optional profile picture as a `data:` image URL (client-resized, size-capped); NULL = render initials |

## `users.display_name` (existing column, spec 019 — wiring added here)

Now populated from the Kratos identity's `name.{first,last}` traits:
- `kratosSessionResolver` → `displayNameFromTraits(traits)` → `ResolvedIdentity.displayName`.
- `requireAuth` → `findOrCreateByKratosId({ displayName })`, which sets it on insert and refreshes it
  on login via `display_name = COALESCE(?, display_name)` (a session without a name keeps the stored one).
- `POST /api/auth/callback` returns `{ displayName, avatarUrl }`; the SPA `AuthUser` carries both.

## Client-side state (no DB)

- **Theme preference** — `light | dark | system` in `localStorage` (`danni.theme`), applied as a
  `.dark` class on `<html>` via `lib/theme.ts`. Chosen in settings (Облик); applied by `App` on the
  map page.

## Validation

- Avatar (`PUT /api/me/avatar`): `data:image/(png|jpeg|webp);base64,…`, length ≤ ~600 KB, or `null`.
