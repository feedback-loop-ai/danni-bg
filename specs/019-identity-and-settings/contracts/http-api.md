# Contract: identity gating + auth + admin settings

Extends the explorer API (008/017/018). New/changed surface only.

## Gating (delta on existing routes)

Reached via Oathkeeper, which validates the Kratos session and injects `X-User-*`. The backend's
`requireAuth` returns **401** if the identity headers are absent; `requireAdmin` returns **403** if the
resolved `users.role !== 'admin'`.

| Route | Tier | Notes |
|---|---|---|
| `GET /api/datasets`, `/api/regions`, `/api/national`, `/api/facets`, `/api/entities/*`, `/api/datasets/:id*`, `/healthz`, SPA | **public** | unchanged; anonymous |
| `POST /api/chat` | **authenticated** | 401 when anonymous |
| `POST /api/auth/*` | **authenticated** | session required |
| `GET/PUT /api/admin/settings` | **admin** | 401 anon, 403 non-admin |

## `POST /api/auth/callback`

Called by the SPA right after login to materialize the app user + learn the tier.

- Auth: authenticated (session cookie → Oathkeeper).
- Request body: none required (identity comes from headers).
- Response 200: `{ "user": { "id", "email", "displayName"?, "role" }, "isAdmin": boolean }`
- Side effect: find-or-create the `users` row (idempotent), bump `last_login_at`.

## `POST /api/auth/logout`

- Auth: authenticated.
- Response 200: `{ "logoutUrl": string }` — the Kratos browser logout-flow URL the SPA redirects to.

## `GET /api/admin/settings`

- Auth: admin.
- Response 200:
  ```json
  {
    "llm": { "kind": "openai-compatible", "model": "deepseek-v4-pro", "baseUrl": "https://api.deepseek.com",
             "apiKeyMasked": true, "apiKeyHint": "••••a4c7f" },
    "toggles": { "freshnessSloSeconds": 86400, "chatEnabled": true },
    "source": "settings" | "env"
  }
  ```
  The raw `apiKey` is **never** returned.

## `PUT /api/admin/settings`

- Auth: admin.
- Request body (Zod-validated): `{ "llm"?: { "kind","model","baseUrl"?,"apiKey"? }, "toggles"?: {…} }`.
  - `apiKey` omitted/empty ⇒ **keep the existing stored key**; non-empty ⇒ replace.
- Response 200: same shape as GET (masked). `updated_by` = caller email.
- Errors: 400 invalid body; 401 anon; 403 non-admin.

## Notes

- Self-service login/registration/recovery/verification are **Kratos** browser flows (via the `/kratos`
  proxy), not danni endpoints. danni only adds `/api/auth/{callback,logout}`.
- All new endpoints are added to `apps/explorer-api/tests/parity-matrix.json`.
- Secrets: the LLM API key is write-only over this contract (set via PUT, never read back raw; never logged).
