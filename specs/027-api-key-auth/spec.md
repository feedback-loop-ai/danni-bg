# Feature Specification: API-key authentication for machine clients

**Feature Branch**: `027-api-key-auth`
**Created**: 2026-06-21
**Status**: **Proposed** (sketch — not yet implemented)
**Input**: Productization finding — the API is reachable only with an Ory Kratos **browser session**
(`X-User-*` headers injected by Oathkeeper). There is no machine-to-machine auth, so enterprise /
agent consumers can't call the data API or chat programmatically. This is the prerequisite for the
"public/enterprise API" business wedge.

## Overview

Add **API keys** as a second, first-class auth path alongside human Kratos sessions, so a program (an
ESG/regtech backend, a research script, a hosted MCP client) can authenticate without a browser. A key
is a long-lived bearer credential owned by a principal, carrying scopes, and resolvable by the same
`requireAuth` machinery that today resolves a session — so handlers stay auth-mechanism-agnostic.

Single responsibility: **identify and authorize a non-browser caller.** Metering/rate-limits are spec
028; org ownership of keys is spec 029 (this spec works single-tenant, keys owned by a `users` row).

## Requirements

- **FR-116**: The API MUST accept an API key via `Authorization: Bearer <key>` on the gated routes,
  authenticating the caller without a Kratos session. A request may present a session OR a key, never
  needing both.
- **FR-117**: Keys MUST be stored **hashed** (e.g. SHA-256 of a high-entropy secret); the plaintext is
  shown **once** at creation and never retrievable. A displayable prefix (e.g. `dnk_live_ab12…`) is
  kept for identification.
- **FR-118**: `requireAuth` MUST resolve a key to the same `user` context it builds for a session
  (so existing handlers, citations, and grounding are unchanged), recording `authMethod: 'session' |
  'apiKey'` and the key id for downstream metering.
- **FR-119**: Keys MUST carry **scopes** (at minimum `read` for the data API, `chat` for `/api/chat`);
  a handler checks the scope it needs. Admin routes are NEVER reachable by key (human-only).
- **FR-120**: A user MUST be able to create / name / list (prefix + last-used + created) / **revoke**
  keys from the account page; revocation takes effect immediately.
- **FR-121**: Keys MAY have an optional expiry; expired or revoked keys are rejected as 401 with a
  clear code (`api_key_revoked` / `api_key_expired`).

## Data model (new — `api_keys`)

| Column | Notes |
|---|---|
| `id` | PK |
| `user_id` | owner (FK `users.id`); becomes tenant-scoped under spec 029 |
| `name` | human label |
| `key_hash` | SHA-256 of the secret (unique) |
| `prefix` | shown for identification (e.g. `dnk_live_ab12`) |
| `scopes` | JSON array (`['read','chat']`) |
| `created_at` / `last_used_at` / `expires_at` / `revoked_at` | lifecycle |

Migration `015_api_keys.sql`. `ApiKeyRepo` (mirrors existing repos): `create` (returns plaintext once),
`resolve(plaintext)` (hash → row, reject revoked/expired, bump `last_used_at`), `listForUser`, `revoke`.

## Success criteria

- **SC-A1**: `curl -H "Authorization: Bearer <key>" /api/datasets?…` and `/api/chat` succeed with no
  cookie; a revoked key returns 401 immediately.
- **SC-A2**: The key secret is never stored or returned after creation (assert plaintext absent from DB
  + from any GET).
- **SC-A3**: A `chat`-scope-less key is 403 on `/api/chat`; no key reaches `/api/admin/*`.

## Out of scope / dependencies
- Per-key request metering, quotas, rate limits → **spec 028** (this spec only authenticates).
- Org ownership / tenant isolation of keys → **spec 029** (keys are user-owned until then).
- OAuth2 client-credentials / JWT (a heavier alternative) — deferred; bearer keys first.
