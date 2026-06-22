#!/usr/bin/env sh
# Container entrypoint (spec 030, FR-135): migrate-on-release, then serve. The server does NOT
# auto-migrate, so a forgotten migration used to surface as a runtime 500 (the per-turn-tokens bug).
# Here a pending migration is applied on start and a FAILED migration aborts the boot (set -e) — the
# release fails instead of serving a half-migrated schema.
set -e

# Fail fast if a dev placeholder secret would ship to this profile (FR-136 / SC-D3).
echo "danni: checking secrets for profile=${DANNI_PROFILE:-production}"
bun run scripts/check-secrets.ts

echo "danni: applying database migrations (store=${DANNI_STORE_ROOT:-store})"
bun run db:migrate

echo "danni: starting explorer-api on :${EXPLORER_API_PORT:-8790}"
exec bun run apps/explorer-api/src/server.ts
