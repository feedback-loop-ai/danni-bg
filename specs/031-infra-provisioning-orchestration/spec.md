# Feature Specification: Infrastructure provisioning & orchestration

**Feature Branch**: `031-infra-provisioning-orchestration`
**Created**: 2026-06-21
**Status**: **Implemented** (Hetzner+k3s Terraform + portable Kustomize manifests; cluster operators + host substitution are operator steps, not code)
**Input**: Productization roadmap — spec 030 packages the **app** (Dockerfile, migrate-on-release, CI
deploy) but assumes a target already exists. This spec is the target: the **environment is provisioned
and orchestrated as code** — the cloud resources, the orchestrator that runs the containers,
networking, the secret backend, and scaling.

## Overview

Define the runtime platform declaratively so any environment (dev/staging/prod) is reproducible from
zero, self-healing, and reviewable — no click-ops. danni's services (app + `explorer-api`, Kratos
[+ Oathkeeper optional], Kratos Postgres, prod SMTP in place of Mailpit, and — when multi-node — the
app-state Postgres + a shared rate-limit/cache store) run under an orchestrator with health-gated
rollouts and rollback.

Single responsibility: **provision and orchestrate where + how the system runs.** What gets shipped
onto it is spec 030; what we watch on it is spec 032.

## Requirements

- **FR-141**: All infrastructure MUST be **defined as code** (Terraform/Pulumi/equivalent), version-
  controlled, plan-reviewed, and idempotently apply/destroy-able; remote state with locking. No
  console-created resources.
- **FR-142**: Services MUST run under an **orchestrator** (managed container platform / k8s / Nomad)
  with declarative definitions, **health-gated rolling deploys** (readiness from 030/032), automatic
  restart/reschedule on failure, and one-command **rollback** to the previous release.
- **FR-143**: **Networking & ingress** — TLS termination at the edge; the **single-port `/kratos`
  proxy** model preserved (Kratos public stays internal); private networking between app ↔ app-Postgres
  ↔ Kratos-Postgres ↔ Kratos; DNS; a CDN/static host for the built SPA.
- **FR-144**: Secrets MUST come from a **secret manager** (not env files committed or baked) — Kratos
  `cookie`/`cipher`, LLM provider key(s), DB creds, API-signing material — injected at runtime and
  **rotatable** (realizes spec 030 FR-136; CI still blocks placeholder secrets).
- **FR-145**: The app tier MUST be provisionable as **horizontally scalable** (stateless replicas
  behind the orchestrator). This depends on app/control-plane state living in Postgres (specs 029/030 +
  `db-architecture-decision`) and a **shared** rate-limit/quota store (spec 028); the **read substrate
  (SQLite) is per-node** — a baked image or a read-only shared volume, refreshed by the pipeline, never
  a shared writable file.
- **FR-146**: **Environment parity + cost control** — dev/staging/prod from the same modules
  (parameterized sizing); environments are cheap to stand up and **clean to tear down**; non-prod can
  scale to zero.
- **FR-147**: **Stateful backing services** (both Postgres instances, the store volume/image registry,
  the secret store) MUST be provisioned with backups/retention wired to spec 030 FR-139 and access
  locked to the private network.

## Data model
None — this is infrastructure, not application schema. (IaC state lives in its own remote backend.)

## Success criteria
- **SC-E1**: From an empty account, one `apply` brings up a working stack reachable over TLS; one
  `destroy` removes it cleanly.
- **SC-E2**: Killing an app instance self-heals (orchestrator reschedules) with no data loss and no
  downtime under multiple replicas.
- **SC-E3**: Staging and prod are provisioned from identical code (only sized params differ).
- **SC-E4**: No secret is baked into an image or committed; all come from the secret manager and rotate.

## Out of scope / dependencies
- The **app image + release pipeline** that deploys onto this = **spec 030**. **Telemetry/alerting** on
  it = **spec 032**.
- Multi-node app replicas presuppose the SQLite→Postgres app-state move (specs 029/030) + shared store
  (028); single-node provisioning is valid first and needs none of that.
- Specific provider (Fly/Render/AWS/GCP/Hetzner+k8s) is an implementation choice for the plan, not
  fixed here.
