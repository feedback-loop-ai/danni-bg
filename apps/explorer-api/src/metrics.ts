// In-process RED metrics (spec 030, FR-138): Rate, Errors, Duration over HTTP requests, enough to back
// a basic SLO. Single-node only (in-memory) — spec 032 deepens this into exported metrics + tracing +
// per-tenant LLM cost. Kept tiny and dependency-free; the request-log middleware feeds it.

export interface MetricsSnapshot {
  requestsTotal: number;
  errorsTotal: number; // 5xx responses
  avgLatencyMs: number;
  byStatusClass: Record<string, number>; // '2xx' | '3xx' | '4xx' | '5xx'
}

const statusClass = (status: number): string => `${Math.floor(status / 100)}xx`;

export class Metrics {
  private requestsTotal = 0;
  private errorsTotal = 0;
  private latencySumMs = 0;
  private readonly byStatusClass = new Map<string, number>();

  /** Record one completed request. */
  record(status: number, durationMs: number): void {
    this.requestsTotal += 1;
    this.latencySumMs += Math.max(0, durationMs);
    if (status >= 500) this.errorsTotal += 1;
    const cls = statusClass(status);
    this.byStatusClass.set(cls, (this.byStatusClass.get(cls) ?? 0) + 1);
  }

  snapshot(): MetricsSnapshot {
    return {
      requestsTotal: this.requestsTotal,
      errorsTotal: this.errorsTotal,
      avgLatencyMs: this.requestsTotal === 0 ? 0 : this.latencySumMs / this.requestsTotal,
      byStatusClass: Object.fromEntries(this.byStatusClass),
    };
  }

  reset(): void {
    this.requestsTotal = 0;
    this.errorsTotal = 0;
    this.latencySumMs = 0;
    this.byStatusClass.clear();
  }
}
