// In-process token-bucket rate limiter (spec 028). Per-principal+route-class burst protection.
// SINGLE-NODE: state is in this process's memory — correct for one instance. Multi-node needs a
// shared store (Redis / a DB counter); see spec 030/031. Clock is injectable for deterministic tests.

interface Bucket {
  tokens: number;
  updatedMs: number;
}

export interface RateDecision {
  ok: boolean;
  /** Seconds until at least one token is available (set when !ok). */
  retryAfterSec: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Try to consume one token for `key` at `ratePerMin` (also the burst capacity). A non-positive rate
   * means "unlimited" → always allowed. Refills continuously at ratePerMin/60 tokens/second.
   */
  take(key: string, ratePerMin: number): RateDecision {
    if (!Number.isFinite(ratePerMin) || ratePerMin <= 0) return { ok: true, retryAfterSec: 0 };
    const capacity = ratePerMin;
    const perSec = ratePerMin / 60;
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: capacity, updatedMs: t };
    // Refill for elapsed time, capped at capacity.
    b.tokens = Math.min(capacity, b.tokens + ((t - b.updatedMs) / 1000) * perSec);
    b.updatedMs = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      this.buckets.set(key, b);
      return { ok: true, retryAfterSec: 0 };
    }
    this.buckets.set(key, b);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / perSec)) };
  }

  /** Test/maintenance helper: drop a principal's buckets. */
  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else for (const k of this.buckets.keys()) if (k.startsWith(`${key}:`)) this.buckets.delete(k);
  }
}
