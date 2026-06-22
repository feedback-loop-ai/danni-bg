# Operations runbook (spec 030)

How to ship and operate danni safely: container image, release flow, secrets, health/observability,
backups, and the single-node → multi-node path. This is the **ops** companion to
`docs/ARCHITECTURE.md` (the system) and the spec set under `specs/`.

## Bring-up (SC-D1)

The app is a built container, not `bun src/...`. Run it alongside the Ory stack with the production
overlay (the base `docker-compose.yml` provides Kratos/Oathkeeper/Postgres/Mailpit; the overlay turns
them production-grade and adds the app):

```sh
cp .env.example .env.production   # then fill the real secrets (see below)
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build
```

- App image: `Dockerfile` (multi-stage — build the SPA, run `explorer-api` on Bun serving it).
- The app listens on `:8790`; point your ingress/TLS terminator at it.
- The **read substrate** (datasets/FTS5/vectors) is NOT in the image — seed the `danni_store` volume
  (mounted at `/data`) via the sync pipeline or a restored backup before the portal is useful.

## Releases & migrations (FR-135 / SC-D2)

The server does **not** auto-migrate. `scripts/docker-entrypoint.sh` runs `db:migrate` on container
start and then execs the server, so:

- a **pending** migration is applied automatically on release, and
- a **bad** migration aborts the boot (`set -e`) — the release fails instead of serving a half-migrated
  schema (this is the class of bug behind the per-turn-tokens 500: a forgotten `db:migrate`).

CI builds the image and gates the release (`.github/workflows/ci.yml` → `deploy` job, opt-in via the
repo variable `DEPLOY_ENABLED=true`).

## Secrets (FR-136 / SC-D3)

Secrets are environment-sourced and rotatable; the committed `infra/ory/kratos.yaml` cookie/cipher are
**dev placeholders** and are overridden in production via env (`SECRETS_COOKIE`/`SECRETS_CIPHER`).

`scripts/check-secrets.ts` (run in the entrypoint and as the CI `deploy` secret gate) **fails** if a
non-dev profile would ship a placeholder value or is missing a required secret. Configure as GitHub
Actions secrets for the deploy job:

- `KRATOS_SECRETS_COOKIE` (32+ chars), `KRATOS_SECRETS_CIPHER` (exactly 32 chars), `POSTGRES_PASSWORD`,
  and the real `EXPLORER_DEFAULT_API_KEY` if using a paid LLM provider.

Rotate by changing the env value and redeploying (Kratos accepts a list of cookie secrets, so add the
new one ahead of the old to rotate without invalidating live sessions).

## Health & observability (FR-138)

- `GET /healthz` — liveness/quality: store reachable, freshness vs SLO, default provider configured
  (`degraded` when stale or no provider).
- `GET /readyz` — **readiness**: DB reachable + schema current. Returns `503` (with the list of pending
  migrations) until ready; wire it as the orchestrator's readiness probe so traffic is held during a
  rollout. Provider/freshness are reported but do not gate readiness (public browse works without an LLM).
- `GET /metrics` — basic RED snapshot (request/error counts, status classes, avg latency) for an SLO.
- Structured request logs (one line per API/auth request: method, path, status, durationMs) via the
  redacting logger.

Deeper observability — exported metrics (Prometheus/OTel), distributed tracing, dashboards, SLO
alerting, and per-tenant LLM cost — is **spec 032**, which builds on these signals.

## Backups & recovery (FR-139)

Two stores to protect:

1. **SQLite app store** (`/data/danni.sqlite` — read substrate + app/control-plane tables). Use
   [Litestream](https://litestream.io) to stream the WAL to object storage:

   ```sh
   # litestream.yml
   dbs:
     - path: /data/danni.sqlite
       replicas:
         - url: s3://YOUR_BUCKET/danni-sqlite
   ```

   Restore into a fresh deployment: `litestream restore -o /data/danni.sqlite s3://YOUR_BUCKET/danni-sqlite`.

2. **Kratos Postgres** (identities). `pg_dump` on a schedule; restore with `pg_restore`.

Rehearse restore (SC-D4): restore the SQLite store into a fresh stack and confirm `/healthz` +
representative `/api/datasets` results match the source. The app tables ride along in the same SQLite
file, so a single restore recovers users/orgs/keys/usage/chat too.

## Single-node → multi-node (FR-140)

Today the SQLite store is **single-host**: a read-mostly substrate plus mutable app/control-plane
tables (users, orgs, keys, usage, chat — specs 019–029). One node is correct until there is a real
multi-instance need (see the `db-architecture-decision` memo).

When horizontal scale is required:

- Move the **app/control-plane tables** to Postgres (the per-org state from spec 029 is what makes this
  worthwhile) — a shared, writable backing store across nodes.
- Keep the **read substrate as SQLite per node** — either baked into the image or a shared read-only
  volume — so search/vector reads stay local and fast.
- Front the app tier with the orchestrator + ingress/TLS from **spec 031**; deepen telemetry with
  **spec 032**.

This spec captures the trigger and the plan; the SQLite→Postgres migration itself is out of scope here.
