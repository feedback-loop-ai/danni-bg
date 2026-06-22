import { describe, expect, it } from 'bun:test';
import { RateLimiter } from '../src/middleware/rate-limiter.ts';

describe('RateLimiter (token bucket)', () => {
  it('allows up to the per-minute capacity, then 429s with a Retry-After', () => {
    const t = 1_000_000;
    const rl = new RateLimiter(() => t);
    expect(rl.take('u1:data', 2).ok).toBe(true);
    expect(rl.take('u1:data', 2).ok).toBe(true);
    const d = rl.take('u1:data', 2);
    expect(d.ok).toBe(false);
    expect(d.retryAfterSec).toBeGreaterThan(0);
  });

  it('refills continuously over time', () => {
    let t = 0;
    const rl = new RateLimiter(() => t);
    rl.take('k:data', 2); // capacity 2 → 1 left
    rl.take('k:data', 2); // → 0 left
    expect(rl.take('k:data', 2).ok).toBe(false);
    t += 30_000; // 30s at 2/min = +1 token
    expect(rl.take('k:data', 2).ok).toBe(true);
  });

  it('treats a non-positive rate as unlimited', () => {
    const rl = new RateLimiter(() => 0);
    for (let i = 0; i < 100; i++) expect(rl.take('k:data', 0).ok).toBe(true);
  });

  it('keys are independent', () => {
    const t = 0;
    const rl = new RateLimiter(() => t);
    rl.take('a:data', 1);
    expect(rl.take('a:data', 1).ok).toBe(false);
    expect(rl.take('b:data', 1).ok).toBe(true); // different principal
  });
});
