# Observability (spec 032)

Make the running system legible: metrics, logs, traces, dashboards, SLOs/alerts, and **cost** for
margin monitoring. Deepens spec 030's basic readiness+logs (FR-138); runs on the spec 031 platform;
consumes the 026/028 usage signals.

## What the app emits (in code)

- **Metrics** (`apps/explorer-api/src/metrics.ts`) at `GET /metrics` in Prometheus format: RED by route
  class (`data`/`chat`/`admin`) + status class, plus domain signals — `danni_llm_tokens_total`,
  `danni_llm_cost_usd_total`, `danni_rate_limit_rejections_total`, `danni_chat_outcomes_total`, and
  scrape-time gauges `danni_active_generations` + `danni_index_stale`. (FR-149)
- **Structured logs** (`logging.ts` + `request-log` middleware): one JSON line per API/auth request
  with method/path/route/status/durationMs and a **request id** (`request-id` middleware, FR-148). The
  logger redacts secrets; prompt/answer text is never logged.
- **Spans** (`trace.ts`): a chat turn emits a `chat.turn` span (provider latency) + a `chat.tool` span
  per tool-loop step, correlated by request id — metadata only (FR-150 / SC-F1). Vendor-neutral: an
  OTLP exporter can back the `Tracer` seam without touching call sites.
- **Cost** (`src/lib/llm-cost.ts`): `estimateCost(usage, pricing, cacheWeight)` — tokens × per-model
  price × the cache discount; feeds `danni_llm_cost_usd_total`. Per-tenant/key cost reuses the
  `api_usage`/`token_usage` tables (no schema change). (FR-153)

## What this directory provides (config)

- `otel-collector.yaml` — OpenTelemetry Collector: scrapes `/metrics`, receives OTLP traces/logs, fans
  out to Prometheus/Tempo/Loki (swap for a hosted APM). Drops content attributes defensively.
- `prometheus-rules.yaml` — SLO burn alerts (data-API error rate, chat error rate, readiness) + cost
  anomaly (runaway-key spike) + sustained 429s, each with a runbook link. (FR-152/153)
- `grafana-dashboard.json` — overview dashboard: RED by route, LLM cost/tokens, chat outcomes, 429s,
  active generations, index freshness. (FR-151)

## Success criteria → where

| | |
|---|---|
| SC-F1 chat trace (tool steps + provider latency) correlatable by request id; no prompt/answer in logs | `trace.ts` + `request-id` + redaction |
| SC-F2 induced error/SLO burn fires an actionable alert | `prometheus-rules.yaml` |
| SC-F3 dashboard shows per-tenant LLM cost + usage; runaway key visible | `grafana-dashboard.json` + `DanniLlmCostSpike` |

## Not wired here (plan-time / ops)

- A concrete metrics/trace/log **backend** (Prometheus/Tempo/Loki or a hosted APM) — deploy on the
  spec 031 cluster and point the collector at it.
- Per-tenant/per-key cost as **labelled** Prometheus series (vs. the in-app aggregate counter): export
  the `api_usage`/`token_usage` rollups (specs 028/029) as a labelled series or query them directly in
  the dashboard datasource.
- **Quality signal** (FR-154, optional): schedule the agentic eval (`bun run eval:agentic`, spec 024)
  nightly and push its pass-rate as a gauge — a small exporter job, left as an ops task.
