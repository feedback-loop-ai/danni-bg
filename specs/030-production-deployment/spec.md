# Feature Specification: Production deployment & operations

**Feature Branch**: `030-production-deployment`
**Created**: 2026-06-21
**Status**: **Implemented** (FR-140 multi-node is documented plan, not migration; image push/release target is deployment-specific)
**Input**: Productization finding — deployment is dev-only: docker-compose covers the **Ory deps**, but
the app runs via `bun … server.ts` (single, non-hot process), there is **no app Dockerfile**, CI is
build-test only (no deploy), migrations are manual, Kratos `cookie`/`cipher` secrets are placeholders,
and the store is single-node SQLite. Required before anyone runs this for real.

## Overview

Make danni deployable and operable as a product: a container image for the app, a deploy pipeline,
managed secrets, migration-on-release, health/observability, and a documented path from single-node to
multi-node. This is independent of 027–029 (they need a place to run; this is that place) but its
multi-node section is what the SQLite→Postgres app-tables decision hinges on.

Single responsibility: **ship and operate the running system safely.**

## Requirements

- **FR-134**: Provide an **app Dockerfile** (Bun runtime, the built SPA + `explorer-api`) and a
  compose/overlay that runs the app + Kratos (+ Oathkeeper optional) + Postgres + Mailpit as one
  bring-up, parameterized by environment.
- **FR-135**: **Migrations run on release**, not by hand — a deploy step runs `db:migrate` (the server
  does not auto-migrate) and fails the release on migration error (the per-turn-tokens 500 came from a
  forgotten `db:migrate`; make that impossible).
- **FR-136**: **Secrets are externalized**, never placeholders in committed config — Kratos
  `cookie`/`cipher`, the LLM provider key, and DB creds come from the environment / a secret store and
  are rotatable. CI MUST fail if a known placeholder secret reaches a non-dev profile.
- **FR-137**: **CI deploys** — extend `ci.yml` (build-test today) with a gated deploy job (image build
  + push + release) on the chosen target; keep the hermetic test gate as the precondition.
- **FR-138**: **Health + observability** — a real readiness probe (DB reachable, migrations current,
  provider configured) beyond the current `/healthz`, plus structured request/error logs and basic
  metrics (request rate, latency, error rate, LLM cost) suitable for an SLO.
- **FR-139**: **Backups + recovery** — a documented, tested backup of the SQLite store (e.g.
  Litestream/streaming snapshot) and of the Kratos Postgres; restore is rehearsed.
- **FR-140**: **Single-node → multi-node path** — document that the SQLite store is single-host
  (read-mostly substrate + mutable app tables). Horizontal scaling requires moving the **app/control-
  plane tables** (users, orgs, keys, usage, chat) to Postgres (per the `db-architecture-decision`
  memo); the **read substrate stays SQLite per node** (a baked image or shared read-only volume). This
  spec captures the trigger + plan, not the migration itself.

## Success criteria

- **SC-D1**: `docker compose -f <prod overlay> up` brings the whole stack up from images; the app is a
  built container, not `bun src/...`.
- **SC-D2**: A release with a pending migration applies it automatically; a bad migration blocks the
  release.
- **SC-D3**: No placeholder secret can ship to a non-dev profile (CI check); secrets are env-sourced
  and rotatable.
- **SC-D4**: A store backup can be restored into a fresh deployment and serves identical results.

## Out of scope / dependencies
- Independent of 027–029 functionally, but its **multi-node** section (FR-140) is the precondition that
  makes 029's per-org app state worth moving to Postgres. Keep single-node until a real multi-instance
  need exists (recorded decision).
- Choice of host (Fly/Render/k8s/VM) and a CDN for the SPA — an implementation detail for the plan, not
  fixed here.
