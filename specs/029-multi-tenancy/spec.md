# Feature Specification: Multi-tenancy (organizations / per-portal tenants)

**Feature Branch**: `029-multi-tenancy`
**Created**: 2026-06-21
**Status**: **Proposed** (sketch — not yet implemented)
**Input**: Productization finding — `users` is a **flat** table (no org/tenant column) and there is one
shared store, so a deployment is single-tenant. The B2G/SaaS plays (sell per portal; host several
customers) need tenant isolation: organizations, membership, and tenant-scoped data + keys + config.

## Overview

Introduce a **tenant** (organization) as the top-level owner of users, API keys, usage, chat sessions,
and a portal configuration. Every gated request resolves to a tenant; all tenant-owned reads/writes are
scoped to it. This is the heaviest of the four proposals and gates the "one deployment, many customers"
model — but is **not** required for the single-portal product (a single implicit tenant).

Single responsibility: **isolate data + config by tenant.** Auth mechanics are spec 027; metering
rollup consumes the tenant from here.

## Requirements

- **FR-128**: Introduce `organizations` (tenants) and `org_members` (user↔org with an org-level role:
  `owner`/`admin`/`member`). A user belongs to ≥1 org; a request resolves an **active org**.
- **FR-129**: Tenant-owned rows (`api_keys`, chat `sessions`/`messages`, usage, and any saved
  views/quotas) MUST carry `org_id`, and every query MUST filter by the active org. A caller MUST NOT
  read or act on another org's data (extends the spec-020 "never another user's session" guarantee to
  the org boundary).
- **FR-130**: An **API key belongs to an org** (supersedes spec 027's user-ownership); its calls,
  usage, quotas, and rate limits (spec 028) are attributed to that org.
- **FR-131**: Per-tenant **portal configuration** — which source portal/mirror this tenant sees and its
  LLM/quota policy — MUST live in (org-scoped) `platform_settings`, so one deployment can serve
  different portals/policies per tenant. (The mirror substrate itself stays per-deployment unless/until
  multiple mirrors are hosted — call that out as a follow-on.)
- **FR-132**: Org admins manage their own members + keys + plan; a danni super-admin manages orgs.
  Human identity stays in Kratos; org/role mapping stays in the danni DB (consistent with spec 019).
- **FR-133**: Existing single-tenant data MUST migrate into a **default org** with no behavior change
  for the current deployment (backfill `org_id`).

## Data model

- `organizations` (id, name, slug, plan, created_at), `org_members` (org_id, user_id, role).
- Add `org_id` to `api_keys`, `chat_sessions`, `token_usage`/`api_usage`, and org-scoped
  `platform_settings` (key namespaced by org). Migration `016_multi_tenancy.sql` + a backfill into a
  `default` org.
- **Substrate note:** the read substrate (`datasets`, FTS5, vectors) is per-deployment; true
  multi-portal hosting means either one mirror per tenant-deployment (simplest) or a tenant-tagged
  mirror (large) — kept out of this spec, which scopes the **app/control plane**, not the data plane.

## Success criteria

- **SC-C1**: Two orgs in one deployment cannot see each other's keys, chat sessions, or usage
  (authorization tests across the org boundary).
- **SC-C2**: The current single deployment migrates into a `default` org with identical behavior.
- **SC-C3**: An org key's usage rolls up under that org in the admin/billing view (with spec 028).

## Out of scope / dependencies
- Builds on **spec 027** (keys) + **spec 028** (metering, now per-org). Multi-node storage of all this
  app state → **spec 030** (this is the change that makes the SQLite→Postgres app-tables move
  worthwhile; see the `db-architecture-decision` memo).
- Hosting multiple **data mirrors** in one process (tenant-tagged substrate) — explicitly deferred.
