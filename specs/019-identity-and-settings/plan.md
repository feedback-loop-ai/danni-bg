# Implementation Plan: Identity management (tiered users) + admin platform settings

**Branch**: `019-identity-and-settings` | **Date**: 2026-06-19 | **Spec**: [spec.md](./spec.md)
**Status**: In progress (phased A→D). Phase A (Ory infra) shipped first.

## Summary

Add Ory-based identity (Kratos + Oathkeeper) with two tiers (admin/user) and an admin settings area
that makes the chat's LLM provider — and a few platform toggles — runtime-configurable. Mirrors the
sibling `looper` Ory pattern: Oathkeeper validates the Kratos session and injects `X-User-*` headers;
the Hono backend trusts them; roles live in the app DB; the SPA drives Kratos self-service flows.

Phased delivery (each a PR):
- **A — Ory infra**: `infra/ory/` (kratos/oathkeeper/access-rules/identity schema/templates) + root
  `docker-compose.yml` (kratos + kratos-migrate + postgres + oathkeeper + mailpit, 14xxx/15xxx
  ports) + Vite proxy split + `.env.example`. *(shipped)*
- **B — API auth**: `users` table/repo, header-trust middleware (`requireAuth`/`requireAdmin`),
  find-or-create app user, gate `POST /api/chat`, `/api/auth/{callback,logout}`, `danni admin-grant` CLI.
- **C — Settings**: `platform_settings` table/repo, `/api/admin/settings` GET(masked)/PUT, per-request
  `resolveServerDefault` from settings (env seed/fallback), first-run seed.
- **D — Frontend**: `@ory/client` + router; login/register/callback/verification UIs; AuthContext;
  gate the chat panel; admin settings page; `credentials: 'include'`.

## Technical Context

**Language/Version**: TypeScript 5.x strict (backend + SPA). Infra is YAML/JSON. CLI is Bun.
**Primary Dependencies**: Bun + Hono (`apps/explorer-api`); `bun:sqlite` store; React SPA
(`apps/explorer-web`) — adds `@ory/client` + `react-router-dom`; Ory Kratos v1.1.0 + Oathkeeper
v0.40.6 + Postgres 16 + mailpit (docker).
**Storage**: Kratos → its own Postgres (docker). danni app → SQLite, +2 tables (`users`,
`platform_settings`) via migrations `008`/`009`.
**Testing**: `bun:test`, hermetic (header injection for guards; mocked `@ory/client` for the SPA; no
live Kratos — Constitution VI). Playwright e2e against the docker stack, out of the <5s unit suite.
**Target Platform**: Linux server (Bun + docker) + browser SPA.
**Project Type**: Web application over the existing mirror substrate.
**Performance Goals**: Auth adds one header read per gated request (no in-process whoami). Oathkeeper
write/idle timeouts raised (600s/605s) so SSE chat isn't cut.
**Constraints**: gate ≠ verification; secrets masked/never-logged; settings edits apply without
restart; public routes stay anonymous; unit suite stays hermetic + <5s.
**Scale/Scope**: 2 tiers; one settings store seeded from env; single backend behind Oathkeeper.

## Constitution Check

*GATE.* (Constitution v1.1.1.)

- **I. AI-Native Development** — PASS. Read interface over the mirror is unchanged; auth/settings are
  orthogonal. No authoritative portal data is altered.
- **II. Spec-Driven Development** — PASS. This spec precedes the code; phases map to PRs.
- **III. Contract-First API Design** — PASS. New endpoints (`/api/auth/*`, `/api/admin/settings`) and
  the gating delta are in `contracts/http-api.md`; inputs Zod-validated; added to `parity-matrix.json`.
- **V. Simplicity & YAGNI** — PASS. Mirror a proven stack; reuse the chat provider seam, the SQLite
  store/repo/migration patterns, and the existing BYO override. Two tiers, not Keto. Hydra/OIDC/MFA
  deferred.
- **VI. Fast Feedback Loops (NON-NEGOTIABLE)** — PASS, central. The live Ory stack is dev/e2e only;
  the `bun:test` unit suite stays hermetic (<5s, no network) via header injection + a mocked Kratos SDK.
- **VII. Type Safety & Validation (NON-NEGOTIABLE)** — PASS. Zod-validate the `debug`/settings bodies
  and `platform_settings.value_json` on load; strict mode throughout.
- **VIII. 100% Test Coverage & Endpoint Parity (NON-NEGOTIABLE)** — PASS. All new TS logic (repos,
  middleware, resolve-default, settings schema, auth routes, SPA auth logic) is unit-tested to 100%;
  new endpoints added to the parity matrix. Infra YAML/JSON carry no statement-coverage signal and are
  enumerated in Complexity Tracking (config exception).
- **IX. Data Freshness & Sync Integrity** — PASS. No sync path touched.
- **X. Bulgarian-Locale Awareness** — PASS. Cyrillic round-trip for `users.display_name` and any
  Bulgarian setting values; auth UI strings localizable.

Mapped FR citations: FR-024 (secret handling — extended to settings + Kratos secrets), the chat
provider seam (017 FR-044), and the SSE contract (008).

## Project Structure

### Documentation
```text
specs/019-identity-and-settings/
├── plan.md  ├── spec.md  ├── research.md(optional)
├── data-model.md         # users, platform_settings, injected headers
├── contracts/http-api.md # /api/auth/*, /api/admin/settings, gating delta
├── tasks.md              # phased A–D
└── checklists/requirements.md
```

### Source (repository root)
```text
infra/ory/{kratos.yaml,oathkeeper.yaml,access-rules.json,identity.schema.json,templates/,README.md}
docker-compose.yml
apps/explorer-web/vite.config.ts                 # proxy split (A)
migrations/008_users.sql, 009_platform_settings.sql
src/store/repos/{users.ts,platform-settings.ts}
src/cli/admin.ts (+ register in src/cli/danni.ts)
apps/explorer-api/src/middleware/{auth.ts,require-auth.ts}
apps/explorer-api/src/routes/{auth.ts,admin.ts}
apps/explorer-api/src/admin/{settings-schema.ts,resolve-default.ts}
apps/explorer-api/src/{app.ts,server.ts}         # thread repos; gate /api/chat; mount admin; per-request serverDefault
apps/explorer-web/src/lib/kratos.ts
apps/explorer-web/src/auth/{AuthContext,Login,Register,Callback,Verification,AuthError,RequireAuth,RequireAdmin}.tsx
apps/explorer-web/src/admin/SettingsPage.tsx
apps/explorer-web/src/{main.tsx,App.tsx,chat/ChatPanel.tsx,lib/api.ts,chat/sendChat.ts}
```

**Structure Decision**: localized to the chat module, a new middleware/admin layer, two repos+migrations,
the auth/admin SPA areas, and an `infra/ory` + compose. No new top-level service.

## Complexity Tracking

> No Constitution violations. Sanctioned coverage exceptions (VIII), config with no statement-coverage
> signal, validated behaviorally (stack up + Playwright e2e):
> `infra/ory/{kratos.yaml,oathkeeper.yaml,access-rules.json,identity.schema.json,templates/*}` and
> `docker-compose.yml`. All TypeScript logic remains 100% covered by `bun:test`.
