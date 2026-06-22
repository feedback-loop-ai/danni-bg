# Feature Specification: Observability (metrics, logs, traces, SLOs, alerting)

**Feature Branch**: `032-observability`
**Created**: 2026-06-21
**Status**: **Implemented** (app emits Prometheus metrics + request-id logs + span events + cost; backends/dashboards/alerts are config under `infra/observability`. OTLP exporter wiring + per-key labelled cost series + the FR-154 nightly eval gauge are documented ops follow-ons)
**Input**: Productization roadmap — spec 030 includes only a readiness probe + basic logs (FR-138).
Running danni for real (and protecting **margins** on metered LLM spend) needs first-class
observability: structured telemetry, dashboards, SLOs, alerting, and per-tenant cost visibility.

## Overview

Make the running system legible: emit metrics/logs/traces from `explorer-api` (and the pipeline),
ship them to a backend, and turn them into dashboards, SLOs, and alerts. Domain signals matter as much
as infra ones — LLM cost/tokens, quota/rate-limit rejections, grounding quality, search latency,
index freshness — because cost and trust are the product's economics.

Single responsibility: **know what the system is doing + alert when it misbehaves.** It deepens spec
030 FR-138; it runs on the platform from spec 031; it consumes the usage signals from 026/028.

## Requirements

- **FR-148**: **Structured logs** — JSON with a correlation/request id threaded through a request
  (incl. the detached chat generation), shipped to a log backend. Secrets/credentials and (by default)
  **chat content + prompts** MUST be redacted/omitted — only metadata is logged unless explicitly opted
  in (privacy of user questions).
- **FR-149**: **Metrics** — RED (rate/errors/duration) per route class (`data` | `chat` | `admin`),
  plus domain metrics: LLM **tokens + cost** per turn (from the 026 `usage` signal), quota/rate-limit
  429s (028), chat outcomes (grounded / no-data / refusal / error), search latency, **index freshness**
  / stale-bucket size, and detached-generation count/age.
- **FR-150**: **Distributed tracing** across app → Kratos (whoami) → Postgres → **LLM provider**, so a
  slow chat turn is attributable per tool-loop step + provider latency; trace ids correlate with logs.
- **FR-151**: **Dashboards** — a versioned, deployable dashboard set (Grafana/equivalent) covering the
  metrics above, including a **per-tenant / per-API-key** view once 028/029 land.
- **FR-152**: **SLOs + alerting** — defined SLOs (e.g. chat availability + p95 latency, data-API error
  rate) with burn-rate alerts routed to on-call; the spec-030 readiness probe feeds uptime; alerts are
  actionable (runbook links), not noisy.
- **FR-153**: **Cost observability** — per-tenant/per-key LLM spend (026 usage × model pricing × the
  cache discount) surfaced for **margin monitoring** and anomaly alerts (a runaway key), directly
  supporting pricing/quota decisions.
- **FR-154**: **Quality signal (optional)** — surface the agentic-eval (spec 024) pass/xfail trend over
  time (e.g. nightly run → a gauge), so grounding/faithfulness regressions are visible as an operational
  metric, not just a CI artifact.

## Data model
None new for telemetry (sinks are external: logs/metrics/traces backends). Cost + quota views reuse the
spec-021/026 `token_usage` and the spec-028 `api_usage` tables; no schema change required.

## Success criteria
- **SC-F1**: A chat turn produces a trace showing tool-loop steps + provider latency, correlatable to
  its logs by request id; no prompt/answer text leaks into logs by default.
- **SC-F2**: An induced error spike (or SLO burn) fires an actionable alert to on-call.
- **SC-F3**: A dashboard shows per-tenant LLM cost + token usage and request rate; a runaway key is
  visible/alertable.

## Out of scope / dependencies
- Runs on the platform provisioned by **spec 031**; deepens **spec 030** FR-138. Per-tenant/key views
  depend on **028/029**; cost figures depend on the **026** usage signal.
- Choice of stack (OpenTelemetry + Grafana/Loki/Tempo/Prometheus, or a hosted APM) is a plan-time
  decision; the requirements are vendor-neutral (OTel-first recommended).
- Product analytics (funnel/usage UX analytics) is a separate concern, not covered here.
