import { describe, expect, it } from 'bun:test';
import { RateLimiter } from '../../../src/crawler/rate-limit.ts';

describe('crawler.RateLimiter', () => {
  it('rejects bad config', () => {
    expect(() => new RateLimiter({ requestsPerSecond: 0, concurrency: 1 })).toThrow();
    expect(() => new RateLimiter({ requestsPerSecond: 1, concurrency: 0 })).toThrow();
  });

  it('serializes interval-based acquires', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const rl = new RateLimiter({
      requestsPerSecond: 2,
      concurrency: 4,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    await rl.acquire('h1');
    await rl.acquire('h1');
    // first acquire is immediate (no sleep), second waits 500ms (1000 / requestsPerSecond)
    expect(sleeps).toEqual([500]);
  });

  it('blocks when concurrency cap is reached and resumes on release', async () => {
    let now = 0;
    const rl = new RateLimiter({
      requestsPerSecond: 100,
      concurrency: 1,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await rl.acquire('h1');
    let secondAcquired = false;
    const second = rl.acquire('h1').then(() => {
      secondAcquired = true;
    });
    expect(secondAcquired).toBe(false);
    rl.release('h1');
    await second;
    expect(secondAcquired).toBe(true);
  });

  it('release is a no-op for unknown hosts', () => {
    const rl = new RateLimiter({ requestsPerSecond: 1, concurrency: 1 });
    rl.release('unknown');
  });
});
