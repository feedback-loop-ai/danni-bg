import { describe, expect, it } from 'bun:test';
import { RobotsCache } from '../../../src/crawler/robots.ts';

function staticFetcher(
  map: Record<string, { status: number; body: string }>,
): (url: string) => Promise<{ status: number; body: string }> {
  return async (url) => map[url] ?? { status: 404, body: '' };
}

describe('crawler.RobotsCache', () => {
  it('allows everything when robots.txt is absent', async () => {
    const cache = new RobotsCache({
      recheckIntervalSeconds: 60,
      fetcher: async () => ({ status: 404, body: '' }),
    });
    expect(await cache.isAllowed('https://example.com/api/x', 'agent')).toBe(true);
  });

  it('honors a Disallow rule', async () => {
    const cache = new RobotsCache({
      recheckIntervalSeconds: 60,
      fetcher: staticFetcher({
        'https://example.com/robots.txt': {
          status: 200,
          body: 'User-agent: *\nDisallow: /private\n',
        },
      }),
    });
    expect(await cache.isAllowed('https://example.com/private/x', 'agent')).toBe(false);
    expect(await cache.isAllowed('https://example.com/public/x', 'agent')).toBe(true);
  });

  it('honors a more specific Allow over a Disallow', async () => {
    const cache = new RobotsCache({
      recheckIntervalSeconds: 60,
      fetcher: staticFetcher({
        'https://example.com/robots.txt': {
          status: 200,
          body: 'User-agent: *\nDisallow: /api/\nAllow: /api/public/\n',
        },
      }),
    });
    expect(await cache.isAllowed('https://example.com/api/public/x', 'agent')).toBe(true);
    expect(await cache.isAllowed('https://example.com/api/private/x', 'agent')).toBe(false);
  });

  it('matches user-agent group', async () => {
    const cache = new RobotsCache({
      recheckIntervalSeconds: 60,
      fetcher: staticFetcher({
        'https://example.com/robots.txt': {
          status: 200,
          body: 'User-agent: danni-bg\nDisallow: /\nUser-agent: *\nAllow: /\n',
        },
      }),
    });
    expect(await cache.isAllowed('https://example.com/x', 'danni-bg/0.1.0')).toBe(false);
    expect(await cache.isAllowed('https://example.com/x', 'OtherBot')).toBe(true);
  });

  it('caches and re-checks after the configured interval', async () => {
    let now = 0;
    let calls = 0;
    const cache = new RobotsCache({
      recheckIntervalSeconds: 60,
      now: () => now,
      fetcher: async () => {
        calls++;
        return { status: 200, body: 'User-agent: *\n' };
      },
    });
    await cache.isAllowed('https://example.com/x', 'a');
    await cache.isAllowed('https://example.com/y', 'a');
    expect(calls).toBe(1);
    now += 61_000;
    await cache.isAllowed('https://example.com/z', 'a');
    expect(calls).toBe(2);
  });

  it('returns age in seconds, undefined for unseen origins', async () => {
    let now = 0;
    const cache = new RobotsCache({
      recheckIntervalSeconds: 60,
      now: () => now,
      fetcher: async () => ({ status: 200, body: '' }),
    });
    expect(await cache.ageSeconds('https://example.com')).toBeUndefined();
    await cache.isAllowed('https://example.com/x', 'a');
    now += 5000;
    expect(await cache.ageSeconds('https://example.com')).toBe(5);
  });

  it('rejects malformed URLs', async () => {
    const cache = new RobotsCache({
      recheckIntervalSeconds: 60,
      fetcher: async () => ({ status: 200, body: '' }),
    });
    expect(await cache.isAllowed('not-a-url', 'a')).toBe(false);
  });
});
