# Feature Specification: API metering, quotas & rate limiting

**Feature Branch**: `028-api-metering-rate-limits`
**Created**: 2026-06-21
**Status**: **Proposed** (sketch — not yet implemented)
**Input**: Productization finding — metering today counts **chat tokens per human user** (spec 021)
only. There is no per-API-key **request** metering, no rate limiting on any route, and no usage basis
for billing API consumers. Required before exposing a paid/public API.

## Overview

Meter and bound **API usage per credential**: count requests (and reuse the existing token accounting
for chat), enforce a **rate limit** (burst protection) and a **quota** (plan cap), and expose a usage
view a customer/admin can read. Reuses the spec-021 `token_usage` + `chat/quota.ts` patterns rather
than inventing a parallel system.

Single responsibility: **count and bound calls to the API.** It builds on the caller identity from
spec 027 (works for keys and sessions); per-org aggregation is spec 029.

## Requirements

- **FR-122**: Every gated request MUST record a usage event keyed by principal (api-key id or user id),
  route class (`data` | `chat`), timestamp, and — for chat — the existing token counts. Recording is
  best-effort and MUST NOT add meaningful latency to the response.
- **FR-123**: A **rate limit** (per-key requests/window, e.g. token-bucket) MUST reject bursts with
  **429** + `Retry-After`; limits are configurable per plan with a sane default. The data API and chat
  MAY have distinct limits (chat is far costlier).
- **FR-124**: A **quota** (per-period request and/or token cap) MUST be enforced; exceeding it returns
  429 `quota_exceeded` (consistent with the existing chat quota). Chat token quotas (spec 021) remain
  the cost control for LLM spend; this adds request quotas for the data API.
- **FR-125**: A usage endpoint (`GET /api/me/api-usage`, and admin `GET /api/admin/api-usage`) MUST
  report per-key/per-user counts + remaining quota over a window, enough to drive billing or a plan UI.
- **FR-126**: Limits/quotas MUST be **admin-configurable at runtime** via `platform_settings` (like
  `defaultTokenLimit`), with per-key overrides — no redeploy to change a plan.
- **FR-127**: Rate-limit + quota state MUST be correct under the **single-node** deployment now, and
  the design MUST name the shared-store requirement for multi-node (see spec 029/030 — Postgres or a
  shared counter like Redis; in-memory token buckets don't survive multi-instance).

## Data model

- Extend the spec-021 usage tables, or add `api_usage` (principal id, kind, ts, request_count, tokens)
  rolled up per window. Rate-limit counters live in-process now (documented as single-node); a shared
  backend is a spec-030 concern.
- `platform_settings` keys: `api.rateLimit.{data,chat}`, `api.quota.default`, per-key overrides on the
  `api_keys` row (spec 027).

## Success criteria

- **SC-B1**: Bursting a key past its rate limit returns 429 + `Retry-After`; normal traffic is
  unaffected; recording adds <~1ms.
- **SC-B2**: A key over its period quota returns 429 `quota_exceeded`; `/api/me/api-usage` shows the
  count + remaining.
- **SC-B3**: An admin changing `api.rateLimit.data` takes effect without a restart.

## Out of scope / dependencies
- Depends on **spec 027** (a credential to meter). Per-org rollup/billing export → **spec 029**.
- Distributed rate-limit store (Redis) → only when multi-node (**spec 030**); single-node uses
  in-process buckets.
- Actual billing/invoicing integration (Stripe etc.) — out of scope; this provides the usage basis.
