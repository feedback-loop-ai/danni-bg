# Data Model: Identity + platform settings

## Kratos identity (owned by Kratos, in Postgres)

Minimal schema (`infra/ory/identity.schema.json`): `traits.email` (password identifier + recovery +
verification) and optional `traits.name.{first,last}`. **No role.** danni never writes identities
directly except via the admin API during bootstrap/management (out of scope for the first cut).

## `users` (danni SQLite — migration `008_users.sql`)

The application mirror of an identity, plus the tier. Found-or-created on first authenticated request.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | app-generated id |
| `kratos_identity_id` | TEXT NOT NULL UNIQUE | the `X-User-ID` subject |
| `email` | TEXT NOT NULL | from `X-User-Email` |
| `display_name` | TEXT | optional (Cyrillic-safe) |
| `role` | TEXT NOT NULL DEFAULT 'user' | `CHECK(role IN ('admin','user'))` |
| `email_verified` | INTEGER NOT NULL DEFAULT 0 | from `X-User-Verified` |
| `created_at` / `updated_at` / `last_login_at` | TEXT | ISO (`nowIso()`) |

`UsersRepo` (`src/store/repos/users.ts`, shape mirrors `organizations.ts`): `findByKratosId`,
`findOrCreateByKratosId({kratosIdentityId,email,emailVerified})` (idempotent), `setRole(email|id, role)`,
`get(id)`.

## `platform_settings` (danni SQLite — migration `009_platform_settings.sql`)

Extensible key/value store; one row per setting. Avoids schema churn as toggles are added.

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | e.g. `llm.default`, `freshness.sloSeconds` |
| `value_json` | TEXT NOT NULL | JSON; Zod-validated per-key on load (VII) |
| `updated_at` | TEXT NOT NULL | ISO |
| `updated_by` | TEXT | admin email (`X-User-Email`) |

`PlatformSettingsRepo` (`src/store/repos/platform-settings.ts`): `get(key)`, `set(key, value, updatedBy)`,
`all()`.

### Known keys (first cut)

- `llm.default` → `{ kind: 'openai-compatible'|'anthropic', model: string, baseUrl?: string, apiKey?: string }`
  (the `ServerDefault` shape; reuses `providerConfigSchema` from `chat/providers.ts`). **apiKey masked
  on read; empty-on-write keeps existing.**
- toggles (extensible), e.g. `freshness.sloSeconds` → `number`, `chat.enabled` → `boolean`.

## Resolution: chat default provider

`resolveServerDefault(settings: PlatformSettingsRepo, env): ServerDefault | null`
(`apps/explorer-api/src/admin/resolve-default.ts`) — **DB `llm.default` wins → `serverDefaultFromEnv(env)`
→ null** (→ existing `provider_unconfigured`). Called per request in `app.ts`'s `selectModel` closure so
admin edits apply without restart. On first run `server.ts` seeds `llm.default` from
`serverDefaultFromEnv()` if absent.

## Injected identity context (Oathkeeper → backend)

`X-User-ID` (subject = kratos identity id), `X-User-Email`, `X-User-Verified` (`'true'|'false'`),
`X-Session-ID`. The backend's `auth.ts` reads these into `{ userId, email, verified, sessionId,
isAuthenticated }`; `requireAuth` resolves them to a `users` row stashed on the Hono context
(`c.set('user', row)`). Absent on a gated route → 401.
