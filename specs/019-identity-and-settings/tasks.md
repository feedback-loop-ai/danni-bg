---
description: "Task list for 019-identity-and-settings (phased A→D; in progress)"
---

# Tasks: Identity management (tiered users) + admin platform settings

**Input**: Design documents from `/specs/019-identity-and-settings/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/

**Status**: In progress. Phase A shipped (`[X]`); Phases B–D pending (`[ ]`). Each phase = one PR.

## Format: `[ID] [P?] [Story] Description`  ·  [P] = parallel-safe · [Story] = US1–US3 / SETUP

---

## Phase A — Ory infra + spec (SETUP) — PR 1 (shipped)

- [X] A001 [SETUP] `infra/ory/{kratos.yaml,identity.schema.json,oathkeeper.yaml,access-rules.json}` (mirror looper; danni 14xxx ports; open-signup registration hook)
- [X] A002 [SETUP] `infra/ory/templates/{verification_code,recovery_code}/valid/email.{subject,body}.gotmpl`
- [X] A003 [SETUP] `docker-compose.yml` — kratos-postgres, kratos-migrate (one-shot `migrate sql`), kratos, oathkeeper, mailslurper
- [X] A004 [SETUP] Vite proxy split — `/kratos`→Kratos, gated `/api/{chat,admin,auth}`→Oathkeeper, public `/api/*`+`/healthz`→Hono — `apps/explorer-web/vite.config.ts`
- [X] A005 [SETUP] `.env.example` (KRATOS_*/OATHKEEPER_* + EXPLORER_DEFAULT_* now a seed) + `infra/ory/README.md`
- [X] A006 [SETUP] spec set under `specs/019-identity-and-settings/`
- [X] A007 [SETUP] Verify: stack healthy; anon gated route → 401; anon public route reachable

**Checkpoint**: `docker compose up` healthy; `GET http://localhost:14455/api/admin/settings` (anon) → 401.

---

## Phase B — API auth + users + gate chat + admin CLI — PR 2

- [X] B001 [US1] `migrations/008_users.sql` (users table per data-model)
- [X] B002 [US1] `src/store/repos/users.ts` — `UsersRepo` (findByKratosId, findOrCreateByKratosId, setRole, get)
- [X] B003 [US1] `apps/explorer-api/src/middleware/auth.ts` — pure `X-User-*` header reader
- [X] B004 [US2] `apps/explorer-api/src/middleware/require-auth.ts` — `requireAuth` (401, find-or-create, `c.set('user')`, last_login_at) + `requireAdmin` (403)
- [X] B005 [US1] `apps/explorer-api/src/routes/auth.ts` — `POST /api/auth/callback`, `POST /api/auth/logout`
- [X] B006 [US2] `src/cli/admin.ts` + register in `src/cli/danni.ts` — `admin-grant|admin-revoke|admin-list`
- [X] B007 [US1] Wire `app.ts` (AppContext.users; gate `/api/chat` + `/api/auth/*` with requireAuth) + `server.ts` (construct UsersRepo)
- [X] B008 [US1] Add gated routes to `apps/explorer-api/tests/parity-matrix.json`
- [X] B009 [US1] Tests: `users.test.ts` (idempotency, role default, Cyrillic), `auth-middleware.test.ts` (401/200/403, find-or-create), update `app.test.ts` (chat 401 anon; public still anon)

**Checkpoint**: anon `POST /api/chat` → 401; with `X-User-*` headers → streams; non-admin → 403 on an admin probe.

---

## Phase C — platform_settings + admin API + chat reads settings — PR 3

- [X] C001 [US3] `migrations/009_platform_settings.sql`
- [X] C002 [US3] `src/store/repos/platform-settings.ts` (get/set/all; Zod-validate value_json on load)
- [X] C003 [US3] `apps/explorer-api/src/admin/settings-schema.ts` (LLM + toggles; `maskApiKey`, `mergeSecret`)
- [X] C004 [US3] `apps/explorer-api/src/admin/resolve-default.ts` (`resolveServerDefault`: DB→env→null)
- [X] C005 [US3] `apps/explorer-api/src/routes/admin.ts` — `GET`(masked)/`PUT` `/api/admin/settings` under requireAdmin
- [X] C006 [US3] `app.ts` per-request serverDefault from settings; mount admin; `server.ts` seed `llm.default` from env on first run; health reflects resolved provider
- [X] C007 [US3] Add admin routes to parity-matrix
- [X] C008 [US3] Tests: platform-settings, resolve-default (DB/env/none), settings-schema (mask/merge), admin-routes (mask + 403/401, PUT no-raw-key, toggle), chat-uses-DB-default-after-PUT

**Checkpoint**: admin PUT new provider → next chat uses it (no restart); GET masks the key.

---

## Phase D — Frontend: auth + routing + admin page — PR 4

- [ ] D001 [US1] deps `@ory/client` + `react-router-dom`; `apps/explorer-web/src/lib/kratos.ts`
- [ ] D002 [US1] `auth/AuthContext.tsx` (toSession → /api/auth/callback → {user,isAdmin}; logout)
- [ ] D003 [US1] `auth/{Login,Register,Callback,Verification,AuthError}.tsx` (Kratos flow UIs; submit CSRF node)
- [ ] D004 [US2] `auth/{RequireAuth,RequireAdmin}.tsx` route guards
- [ ] D005 [US3] `admin/SettingsPage.tsx` (GET masked / PUT)
- [ ] D006 [US1] `main.tsx` BrowserRouter+AuthProvider+routes; `App.tsx` header login/logout
- [ ] D007 [US1] `chat/ChatPanel.tsx` gate ("sign in to chat"); `lib/api.ts`+`sendChat.ts` `credentials:'include'`
- [ ] D008 Tests: hermetic unit with mocked `@ory/client` (AuthContext, RequireAdmin, SettingsPage masked-key, kratosUrls); Playwright e2e (`us8-auth`, `us9-admin-settings`); update chat e2e to require login

**Checkpoint**: register→login→chat works in the browser; admin sees + edits settings; non-admin can't.

## Dependencies

A (infra) → B (auth/gate; needs the header contract) → C (admin gate + settings) → D (consumes
`/api/auth/*` from B and `/api/admin/settings` from C). `/api/auth/*` lands in B to unblock D.

## Notes

- Hermetic tests only in `bun:test` (header injection + mocked SDK; no live Kratos — Constitution VI).
- Infra YAML/JSON are config-exempt from coverage (VIII); enumerated in plan Complexity Tracking.
- First admin: register + login once, then `danni admin-grant <email>`.
