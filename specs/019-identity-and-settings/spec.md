# Feature Specification: Identity management (tiered users) + admin platform settings

**Feature Branch**: `019-identity-and-settings`  
**Created**: 2026-06-19  
**Status**: Implemented. Phases A–D shipped in PRs #39–#48; **PR #49** added Ory v26.2.0, single-port
magic links, link-mode recovery, Mailpit, and **passkeys** (see the FR-091…FR-093 amendments below).
Later refined by spec 021 (token metering) + spec 022 (account & chat UX, which removed the in-chat
provider override). Verified by the suite green + live runs on `:8790`.  
**Input**: The app has no authentication and its LLM provider is fixed in `.env`. Add Ory-based
identity with an admin + normal-user tier, and an admin settings area to configure platform behavior
(starting with the LLM endpoint) at runtime.

## Clarifications

### Session 2026-06-19

- Q: Who must log in to use what? → A: **Public browse, gated chat + admin.** The map, datasets,
  search, and region aggregates stay anonymous (open-data spirit); `POST /api/chat` requires login
  (it bills the configured LLM per token); `/api/admin/*` requires the admin tier.
- Q: How are normal-user accounts created? → A: **Open self-service signup** (email+password via
  Kratos); new accounts default to the `user` tier and are auto-logged-in on registration.
- Q: What do the admin settings cover first? → A: **LLM provider + a few platform toggles**, in an
  extensible key/value store; the LLM provider (kind/model/baseUrl/apiKey) moves from `.env` to
  runtime config.
- Q: How is Ory deployed? → A: **danni owns its Ory stack** — Kratos + Oathkeeper + Postgres +
  mailpit via a docker-compose in this repo, mirroring the sibling `looper` project.
- Q: Where do roles live — Kratos or the app? → A: **App DB.** Kratos holds a minimal identity
  (email + name); the `users.role` column (keyed by `kratos_identity_id`) is the tier, checked in-app.
  Keeps the identity schema minimal and role edits a simple SQLite update (mirrors looper).
- Q: How does the backend authenticate a request? → A: Oathkeeper validates the Kratos session
  (`cookie_session` → `/sessions/whoami`) and injects `X-User-*` headers; the Hono backend **trusts
  only those headers** (no in-process whoami) — keeps unit tests hermetic and Oathkeeper swappable.

## User Scenarios & Testing *(mandatory)*

One responsibility: **authenticated, tiered access to danni, with runtime-configurable platform
settings.** Delivered as three prioritised slices over a shared Ory foundation.

### User Story 1 - Self-service identity gates the chat; browsing stays public (Priority: P1)

A visitor can browse the map, datasets, and search anonymously. To use the chat they register
(email+password) or log in; the chat is unavailable (401) while anonymous. Logout ends the session.

**Why this priority**: This is the core capability — an identity system with a gate. The chat now
bills a paid LLM per token, so gating it is both the headline access-control need and cost control,
while keeping the open-data explorer public. Everything else builds on the session + gate.

**Independent Test**: Anonymous `GET /api/datasets` → 200; anonymous `POST /api/chat` → 401; after
register+login, `POST /api/chat` streams an answer; logout → chat 401 again.

**Acceptance Scenarios**:

1. **Given** an anonymous visitor, **When** they open the app, **Then** the map/datasets/search work
   and the chat shows a "sign in to chat" prompt; `POST /api/chat` returns 401.
2. **Given** the registration form, **When** a new user submits a valid email + password (≥10 chars),
   **Then** a Kratos identity is created, the user is auto-logged-in, and the chat works.
3. **Given** a logged-in user, **When** they log out, **Then** the session ends and the chat is gated again.
4. **Given** the Ory stack, **When** Oathkeeper validates a session, **Then** it injects
   `X-User-{ID,Email,Verified,Session-ID}` and the backend trusts only those (absent → 401 on gated routes).

---

### User Story 2 - Tiered users: an admin tier with an admin-only area (Priority: P2)

There are two tiers: normal users and admins. Admin-only routes (`/api/admin/*`) and the admin UI are
inaccessible to normal users (403). The first admin is promoted out-of-band.

**Why this priority**: Tiering is required for the admin settings (US3) to be safe — without an admin
gate, any user could reconfigure the platform. P2 because it depends on US1's session/identity and is
the prerequisite for US3.

**Independent Test**: A normal user's session → `GET /api/admin/settings` 403; after
`danni admin-grant <email>`, the same session → 200. A user row is found-or-created on first authed call.

**Acceptance Scenarios**:

1. **Given** a first authenticated request, **When** it arrives, **Then** an app `users` row is
   created (idempotent on `kratos_identity_id`) with role `user` and `last_login_at` set.
2. **Given** a normal user, **When** they call `/api/admin/*` or open the admin page, **Then** they
   get 403 / are redirected away.
3. **Given** an operator runs `danni admin-grant <email>` for an existing user, **When** that user
   next calls `/api/admin/*`, **Then** they get through (role is `admin`).
4. **Given** `ADMIN_BOOTSTRAP_EMAILS` is set, **When** a matching email first logs in, **Then** that
   user is created as `admin` (optional convenience; documented trade-off).

---

### User Story 3 - Admin configures the LLM provider + platform toggles at runtime (Priority: P3)

An admin opens the settings page and changes the chat's default LLM provider (kind, model, base URL,
API key) and a few platform toggles. The next chat turn uses the new config — no redeploy, no restart.
The stored API key is never shown back in full.

**Why this priority**: This is the stated motivating need (configure the LLM endpoint without editing
`.env` + redeploying). P3 because it depends on US2's admin gate and US1's identity.

**Independent Test**: As admin, `PUT /api/admin/settings` with a new provider; assert the next
`/api/chat` resolves that provider; `GET /api/admin/settings` returns the key masked (never raw).

**Acceptance Scenarios**:

1. **Given** no settings row yet, **When** the API starts, **Then** it seeds the LLM default from
   `EXPLORER_DEFAULT_*`; thereafter the settings store is authoritative.
2. **Given** an admin edits the LLM provider, **When** they save and a user then chats, **Then** the
   turn uses the new provider with no restart.
3. **Given** `GET /api/admin/settings`, **When** it returns, **Then** the API key is masked (e.g.
   last 4 chars) and the raw key never appears in the response or logs.
4. **Given** a `PUT` that omits/empties the key field, **When** it persists, **Then** the existing key
   is retained (editing other fields doesn't wipe the secret).
5. **Given** a normal user, **When** they `PUT /api/admin/settings`, **Then** 403 (no change).

---

### Setup - danni owns its Ory stack

A repo docker-compose stands up Kratos (identity, own Postgres), Oathkeeper (access proxy for gated
routes), and mailpit (dev email). Vite is the single browser entry point and proxies `/kratos/*`
→ Kratos, gated `/api/{chat,admin,auth}` → Oathkeeper, public `/api/*` + `/healthz` → Hono. Config
lives in `infra/ory/`. Ports use a 14xxx/15xxx band to avoid colliding with looper's stack.

### Edge Cases

- **Anonymous on a gated route**: 401 (HTML clients can be redirected to `/auth/login` by Oathkeeper).
- **Session valid but no app user row yet**: found-or-created on the spot; role defaults to `user`.
- **Secret in settings**: masked on read; empty-on-write = keep existing; never logged.
- **LLM provider unset everywhere** (no DB row, no env): the existing `provider_unconfigured` error.
- **SSE under the gate**: `requireAuth` runs before the streaming handler; on success it must not
  buffer the stream; Oathkeeper write/idle timeouts are raised for long turns.
- **Email not verified**: allowed to use the app (gate is on auth, not verification); verification is
  available and encouraged.
- **BYO provider override (017/018)**: unchanged — a user may still supply their own key per request;
  admin sets the platform default used when `useServerDefault`.

## Requirements *(mandatory)*

### Functional Requirements

(Continues the FR series; 018 ended at FR-051.)

- **FR-052**: danni MUST run its own Ory stack (Kratos + Oathkeeper + Postgres + mailpit) via a
  repo docker-compose. Kratos owns identities (minimal schema: email + name) in Postgres; danni app
  data (incl. the new `users`/`platform_settings`) stays in SQLite.
- **FR-053**: Public routes (`GET /api/{datasets,regions,national,facets,entities,…}`, `/healthz`, the
  SPA) MUST remain anonymous. `POST /api/chat`, `/api/admin/*`, and `/api/auth/*` MUST require a valid
  Kratos session.
- **FR-054**: Registration MUST be open self-service (email + password via Kratos), defaulting new
  identities to the `user` tier, auto-login on registration; email verification available, not required.
- **FR-055**: The backend MUST authenticate a gated request from the Kratos session. **Amended (PR #45,
  single-port):** the Hono server reverse-proxies `/kratos/*` and **validates the session itself**
  (`/sessions/whoami`) so it stands alone on one port; Oathkeeper's injected
  `X-User-{ID,Email,Name,Verified,Session-ID}` headers are still honored (and take precedence) when it
  fronts the stack. Gated routes MUST 401 when neither yields an identity.
- **FR-056**: The app MUST keep a `users` table keyed by `kratos_identity_id` with `role ∈ {admin,user}`
  (default `user`). A user row MUST be found-or-created on first authenticated request; admin access
  MUST be enforced in-app (`requireAdmin` → 403 for non-admin).
- **FR-057**: The first admin MUST be promotable via `danni admin-grant <email>`; an optional
  `ADMIN_BOOTSTRAP_EMAILS` env MAY auto-promote matching emails on first login.
- **FR-058**: Platform settings MUST live in an extensible key/value store (`platform_settings`) in
  SQLite; each `value_json` MUST be Zod-validated on load (Constitution VII).
- **FR-059**: The chat's default LLM provider MUST be resolved at request time from `platform_settings`
  (DB authoritative), seeded from `EXPLORER_DEFAULT_*` on first run, falling back to env then to the
  existing `provider_unconfigured` error. Admin edits MUST take effect without a restart.
- **FR-060**: `GET/PUT /api/admin/settings` MUST be admin-only. GET MUST mask the LLM API key (never
  return it raw); PUT MUST treat an empty/omitted key as "keep existing" and MUST NOT log the secret.
- **FR-061**: The SPA MUST provide login / registration / logout / verification UIs driving Kratos
  self-service flows, gate the chat UI behind auth, expose an admin-only settings page, and send
  credentials on gated API calls.
- **FR-062**: The per-request BYO provider override (017/018) MUST continue to work; admin sets the
  platform default used when `useServerDefault`. **Superseded by spec 022 (FR-090):** the in-chat
  per-user provider override was removed (it would bypass the platform LLM config + metering); the
  chat always uses the admin-configured server default.

#### Amendments (Session 2026-06-20 — shipped in PR #49)

- **FR-091**: The identity stack MUST support **passwordless passkeys (WebAuthn)** in addition to
  passwords: register or log in with a passkey, and add/remove passkeys from the account settings.
  Implemented via Kratos's `passkey` method (relying-party id `localhost`, origins for the
  single-port app + the optional Vite-dev origin); the custom flow UI injects Kratos's `webauthn.js`
  and submits the credential natively. Registration stays single-screen (`enable_legacy_one_step`)
  so traits + password + passkey appear together.
- **FR-092**: Recovery + email verification MUST use **link (magic-link)** flows with danni-branded
  emails; in dev they MUST be caught by **Mailpit**. Links MUST resolve through the single-port
  `/kratos` proxy and complete on the app origin (`serve.public.base_url = http://localhost:8790/kratos/`).
- **FR-093**: The Ory stack MUST run **Kratos + Oathkeeper v26.2.0** (Ory's unified CalVer) with
  Mailpit for dev mail (replacing Mailslurper, whose shared web UI showed another instance's inbox).

### Key Entities *(include if feature involves data)*

- **Kratos identity**: email (password identifier + recovery + verification) + optional name. Owned by
  Kratos (Postgres). No role.
- **App user** (`users`): `id`, `kratos_identity_id` (UNIQUE), `email`, `display_name`, `role`
  (admin|user), `email_verified`, `created_at`, `updated_at`, `last_login_at`. In danni SQLite.
- **Platform setting** (`platform_settings`): `key` (PK), `value_json`, `updated_at`, `updated_by`.
  LLM default under key `llm.default`; toggles under their own keys.
- **Injected identity headers**: `X-User-ID/Email/Verified/Session-ID` (from Oathkeeper) → the backend's
  request-scoped auth context.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `docker compose up` brings Kratos + Oathkeeper + mailpit healthy; an anonymous gated
  route returns 401 and an anonymous public route returns 200. *(Phase A — verified.)*
- **SC-002**: A new visitor registers, is auto-logged-in, and can use the chat; anonymous → chat 401
  but map/datasets work.
- **SC-003**: An authenticated request carries `X-User-*`; the app user row is created once
  (idempotent) and `last_login_at` is updated.
- **SC-004**: A normal user gets 403 on `/api/admin/*`; after `danni admin-grant`, 200.
- **SC-005**: An admin changes the LLM provider; the next chat turn uses it with no restart; GET never
  returns the raw API key.
- **SC-006**: The full `bun:test` suite passes hermetically (header injection + mocked Kratos SDK, no
  live network — Constitution VI), with 100% line+branch on new logic (VIII); infra YAML/JSON are
  exempt as config.
- **SC-007**: The new endpoints (`/api/chat` gated, `/api/admin/settings` GET/PUT, `/api/auth/*`) are
  in `apps/explorer-api/tests/parity-matrix.json`.

## Assumptions

- **Header-injection trust boundary**: in dev/prod, gated traffic reaches Hono only via Oathkeeper, so
  trusting `X-User-*` is safe. Tests set the headers directly (no live Kratos).
- **Roles in the app DB** (not Kratos), checked in-app — mirrors looper; keeps the identity schema
  minimal and role edits trivial.
- **Secrets**: the LLM API key in `platform_settings` is single-tenant admin config; masked on read,
  never logged. `kratos.yaml` cookie/cipher secrets are dev placeholders to rotate for any deploy.
- **Dev email** via mailpit; production SMTP is out of scope here.
- **Out of scope (now)**: Ory Hydra (OAuth2 server), Keto (relationship RBAC), social/OIDC login, MFA,
  API keys, org/team multi-tenancy. The 2-tier model is intentionally simple.
- **Builds on 017/018**: reuses the chat provider seam (`selectModel`/`ServerDefault`), the existing
  per-user BYO override, and the SQLite store/migration/repo patterns.
