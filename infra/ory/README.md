# Ory identity stack (danni-bg)

Local Kratos + Oathkeeper stack backing identity management + tiered users (spec
`specs/019-identity-and-settings/`). Kratos owns identities in its own Postgres; the
danni app keeps its data in SQLite. Oathkeeper fronts the **gated** API routes
(`/api/{chat,admin,auth}`), validates the Kratos session, and injects `X-User-*`
headers the Hono backend trusts. Public routes (`/api/datasets`, `/api/regions`, …)
bypass Oathkeeper and hit Hono directly.

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
docker compose up -d          # from repo root
bun run explorer:api          # Hono backend on :8790 (host)
cd apps/explorer-web && vite  # SPA on :5173 — the browser entry point
```

The Vite dev server proxies: `/kratos/*` → Kratos public (first-party cookies/CSRF);
`/api/{chat,admin,auth}/*` → Oathkeeper (14455); public `/api/*` + `/healthz` → Hono (8790).

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
