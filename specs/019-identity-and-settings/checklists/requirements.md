# Requirements Quality Checklist: Identity + admin platform settings

**Purpose**: Validate that the 019 spec is complete, unambiguous, testable, and traceable.
**Created**: 2026-06-19
**Feature**: [spec.md](../spec.md)

## Access model & identity

- [X] CHK001 Public-vs-gated split is explicit and enumerated (public browse; gated chat + admin) (FR-053, US1)
- [X] CHK002 Open self-service signup + default `user` tier + auto-login is specified (FR-054, US1 scenario 2)
- [X] CHK003 The Oathkeeper→header-injection trust boundary and the backend "trust only headers / 401 if absent" rule are specified (FR-055, Assumptions)
- [X] CHK004 danni-owned Ory stack (Kratos+Oathkeeper+Postgres+mailslurper) + Kratos-Postgres vs danni-SQLite separation is specified (FR-052, Setup)

## Tiers & bootstrap

- [X] CHK005 The `users` table (kratos_identity_id, role) + find-or-create on first authed request is specified (FR-056, data-model)
- [X] CHK006 Roles in the app DB (not Kratos) with in-app `requireAdmin` is stated and justified (FR-056, Clarifications)
- [X] CHK007 First-admin bootstrap (`danni admin-grant`, optional `ADMIN_BOOTSTRAP_EMAILS`) is specified (FR-057, US2)

## Runtime settings & secrets

- [X] CHK008 Extensible `platform_settings` store with Zod-validated value_json is specified (FR-058, data-model)
- [X] CHK009 Per-request resolution (DB→env seed/fallback→error) + no-restart + first-run seed is specified (FR-059, US3 scenarios 1–2)
- [X] CHK010 API-key masking on GET + empty-write-keeps-existing + never-logged is specified (FR-060, US3 scenarios 3–4)
- [X] CHK011 Admin-only enforcement on the settings endpoints (401 anon / 403 user) is specified (FR-060, US3 scenario 5, contracts)

## Frontend & compatibility

- [X] CHK012 SPA auth UIs (login/register/logout/verification), chat gating, admin page, `credentials:include` are specified (FR-061, US1/US3)
- [X] CHK013 The existing per-user BYO provider override is preserved alongside the admin default (FR-062, Edge Cases)

## Quality, testability & honesty

- [X] CHK014 Every FR (FR-052…FR-062) is specific and verifiable; no `NEEDS CLARIFICATION`/placeholders
- [X] CHK015 SC-001…SC-007 are measurable (401/200 probes, find-or-create idempotency, 403→200 after grant, no-restart provider swap, masked key)
- [X] CHK016 User stories are prioritised P1–P3 with Why / Independent Test / Given-When-Then scenarios
- [X] CHK017 Key Entities cover the Kratos identity, app `users`, `platform_settings`, and injected headers
- [X] CHK018 Edge cases cover anon-on-gated, no-user-row-yet, secret masking, provider-unset, SSE-under-gate, unverified-email, BYO override
- [X] CHK019 Constitution VI (hermetic unit suite; live stack dev/e2e only) and VIII (100% on TS logic; infra config-exempt) stances are explicit (plan)
- [X] CHK020 Out-of-scope is stated (Hydra, Keto, OIDC/social, MFA, API keys, multi-tenancy)

## Notes

- Forward-looking spec for in-progress phased work (Phase A shipped; B–D pending). FR series continues
  from 018 (…FR-051); this feature adds FR-052…FR-062.
