// In-process metrics registry (spec 032, FR-149; deepens the spec-030 RED snapshot). Records RED
// (rate/errors/duration) per route class + status class plus domain signals — LLM tokens + cost (from
// the 026 usage signal), rate-limit/quota 429s (028), and chat outcomes — and exposes them in the
// Prometheus text exposition format for a scraper. Single-node/in-memory; an OTel collector (see
// infra/observability) scrapes /metrics and fans out to the metrics backend. snapshot() is kept for the
// quick JSON view + tests.

export type RouteClass = 'data' | 'chat' | 'admin' | 'other';
export type ChatOutcome = 'grounded' | 'no_data' | 'error';

const ROUTE_CLASSES: readonly RouteClass[] = ['data', 'chat', 'admin', 'other'];

/** Map a request path to its route class for RED labelling. */
export function routeClassOf(path: string): RouteClass {
  if (path.startsWith('/api/chat')) return 'chat';
  if (path.startsWith('/api/admin')) return 'admin';
  if (path.startsWith('/api/')) return 'data';
  return 'other';
}

export interface MetricsSnapshot {
  requestsTotal: number;
  errorsTotal: number; // 5xx responses
  avgLatencyMs: number;
  byStatusClass: Record<string, number>;
  llmTokens: { input: number; output: number; cached: number };
  llmCostUsd: number;
  rateLimitRejections: number;
  chatOutcomes: Record<string, number>;
}

const statusClass = (status: number): string => `${Math.floor(status / 100)}xx`;
const inc = (m: Map<string, number>, key: string, by = 1) => m.set(key, (m.get(key) ?? 0) + by);

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export class Metrics {
  // RED: keyed by `${route}|${statusClass}` (counts) and per-route latency sums.
  private readonly reqTotal = new Map<string, number>();
  private readonly durSumMs = new Map<string, number>(); // per route
  private readonly durCount = new Map<string, number>(); // per route
  // Domain.
  private readonly llmTokens = { input: 0, output: 0, cached: 0 };
  private llmCostUsd = 0;
  private readonly rateLimitRejections = new Map<string, number>(); // per route
  private readonly chatOutcomes = new Map<string, number>();

  /** Record one completed HTTP request. */
  recordRequest(route: RouteClass, status: number, durationMs: number): void {
    inc(this.reqTotal, `${route}|${statusClass(status)}`);
    inc(this.durSumMs, route, Math.max(0, durationMs));
    inc(this.durCount, route);
  }

  /** Record an LLM turn's tokens + computed cost (USD). */
  recordLlm(
    usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
    costUsd: number,
  ): void {
    this.llmTokens.input += Math.max(0, usage.inputTokens || 0);
    this.llmTokens.output += Math.max(0, usage.outputTokens || 0);
    this.llmTokens.cached += Math.max(0, usage.cachedInputTokens || 0);
    this.llmCostUsd += Math.max(0, costUsd || 0);
  }

  recordRateLimitRejection(route: RouteClass): void {
    inc(this.rateLimitRejections, route);
  }

  recordChatOutcome(outcome: ChatOutcome): void {
    inc(this.chatOutcomes, outcome);
  }

  snapshot(): MetricsSnapshot {
    let requestsTotal = 0;
    let errorsTotal = 0;
    const byStatusClass: Record<string, number> = {};
    let durSum = 0;
    for (const [key, n] of this.reqTotal) {
      const cls = key.split('|')[1] as string;
      requestsTotal += n;
      byStatusClass[cls] = (byStatusClass[cls] ?? 0) + n;
      if (cls === '5xx') errorsTotal += n;
    }
    for (const v of this.durSumMs.values()) durSum += v;
    return {
      requestsTotal,
      errorsTotal,
      avgLatencyMs: requestsTotal === 0 ? 0 : durSum / requestsTotal,
      byStatusClass,
      llmTokens: { ...this.llmTokens },
      llmCostUsd: this.llmCostUsd,
      rateLimitRejections: [...this.rateLimitRejections.values()].reduce((a, b) => a + b, 0),
      chatOutcomes: Object.fromEntries(this.chatOutcomes),
    };
  }

  /**
   * Prometheus text exposition (FR-149). `gauges` are point-in-time values computed at scrape time
   * (e.g. active detached generations, stale-dataset count) — the registry only holds counters.
   */
  prometheus(gauges: Record<string, number> = {}): string {
    const out: string[] = [];
    const help = (name: string, type: string, text: string) => {
      out.push(`# HELP ${name} ${text}`, `# TYPE ${name} ${type}`);
    };

    help('danni_http_requests_total', 'counter', 'HTTP requests by route class and status class.');
    for (const route of ROUTE_CLASSES) {
      for (const cls of ['2xx', '3xx', '4xx', '5xx']) {
        const n = this.reqTotal.get(`${route}|${cls}`);
        if (n) out.push(`danni_http_requests_total{route="${route}",status="${cls}"} ${n}`);
      }
    }

    help(
      'danni_http_request_duration_ms_sum',
      'counter',
      'Sum of request durations (ms) by route class.',
    );
    for (const route of ROUTE_CLASSES) {
      const s = this.durSumMs.get(route);
      if (s != null) out.push(`danni_http_request_duration_ms_sum{route="${route}"} ${s}`);
    }
    help('danni_http_request_duration_ms_count', 'counter', 'Request count by route class.');
    for (const route of ROUTE_CLASSES) {
      const c = this.durCount.get(route);
      if (c != null) out.push(`danni_http_request_duration_ms_count{route="${route}"} ${c}`);
    }

    help('danni_llm_tokens_total', 'counter', 'LLM tokens by kind.');
    out.push(
      `danni_llm_tokens_total{kind="input"} ${this.llmTokens.input}`,
      `danni_llm_tokens_total{kind="output"} ${this.llmTokens.output}`,
      `danni_llm_tokens_total{kind="cached"} ${this.llmTokens.cached}`,
    );

    help('danni_llm_cost_usd_total', 'counter', 'Estimated LLM spend (USD).');
    out.push(`danni_llm_cost_usd_total ${this.llmCostUsd}`);

    help('danni_rate_limit_rejections_total', 'counter', 'Rate-limit/quota 429s by route class.');
    for (const [route, n] of this.rateLimitRejections) {
      out.push(`danni_rate_limit_rejections_total{route="${route}"} ${n}`);
    }

    help('danni_chat_outcomes_total', 'counter', 'Chat turn outcomes.');
    for (const [outcome, n] of this.chatOutcomes) {
      out.push(`danni_chat_outcomes_total{outcome="${escapeLabel(outcome)}"} ${n}`);
    }

    for (const [name, value] of Object.entries(gauges)) {
      if (Number.isFinite(value)) {
        help(name, 'gauge', 'Point-in-time value.');
        out.push(`${name} ${value}`);
      }
    }

    return `${out.join('\n')}\n`;
  }

  reset(): void {
    this.reqTotal.clear();
    this.durSumMs.clear();
    this.durCount.clear();
    this.llmTokens.input = this.llmTokens.output = this.llmTokens.cached = 0;
    this.llmCostUsd = 0;
    this.rateLimitRejections.clear();
    this.chatOutcomes.clear();
  }
}
