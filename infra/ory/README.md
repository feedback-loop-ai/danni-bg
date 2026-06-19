# Ory identity stack (danni-bg)

Local Ory identity stack backing identity management + tiered users (spec
`specs/019-identity-and-settings/`). Kratos owns identities in its own Postgres; the
danni app keeps its data in SQLite.

**Single-port mode (default).** The Hono backend is self-contained: it serves the API +
SPA, **reverse-proxies `/kratos/*` to Kratos** on the same origin, and **validates the
Kratos session itself** (`/sessions/whoami`) for the gated routes (`/api/{chat,admin,auth}`).
So `http://localhost:8790` is a complete, standalone entry point and **Oathkeeper is
optional** — you only need Kratos (+ its Postgres + mailslurper).

**Oathkeeper (optional).** If you front the stack with Oathkeeper, it validates the
session and injects `X-User-*` headers, which the backend trusts in preference to its own
whoami call. The compose file still includes it for that deployment style.

## Components & ports (14xxx/15xxx band — avoids the looper stack's 34xxx)

| Component        | Host port | Purpose                                  |
|------------------|-----------|------------------------------------------|
| Kratos public    | 14433     | self-service flows, `/sessions/whoami`   |
| Kratos admin     | 14434     | identity admin API                       |
| Oathkeeper proxy | 14455     | access proxy for gated `/api/*`          |
| Oathkeeper api   | 14456     | health/rules                             |
| Kratos Postgres  | 15432     | Kratos DB (separate from danni SQLite)   |
| Mailslurper UI   | 14438     | catches verification/recovery emails     |

## Run (dev)

```bash
docker compose up -d                          # Kratos (+ Postgres + mailslurper); Oathkeeper optional
bun run explorer:api                          # Hono backend on :8790 — serves API + SPA + /kratos proxy
# either open http://localhost:8790 directly (built SPA), OR for HMR:
cd apps/explorer-web && bunx vite --port 5173 # → http://localhost:5173
```

Hono on `:8790` is a complete entry point (proxies `/kratos`, self-validates sessions). The Vite
dev server just proxies everything (`/api`, `/kratos`, `/healthz`) → `:8790` for hot-reload.

## Verify

```bash
curl -s http://localhost:14433/health/ready   # kratos
curl -s http://localhost:14456/health/alive   # oathkeeper
open http://localhost:14438                    # mailslurper inbox
```

## Notes

- `kratos --dev` auto-runs migrations and relaxes some checks — **dev only**.
- Secrets in `kratos.yaml` (`cookie`, `cipher`) are placeholders — **rotate for any non-local deploy**.
- Identity schema is minimal (email + name). Roles/tiers live in the danni app DB
  (`users.role`), not in Kratos — see the spec.
- First admin: register + log in once, then `danni admin-grant <email>`.
