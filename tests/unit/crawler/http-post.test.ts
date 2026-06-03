import { describe, expect, it } from 'bun:test';
import { BackoffRunner } from '../../../src/crawler/backoff.ts';
import { PortalHttp } from '../../../src/crawler/http.ts';
import { RateLimiter } from '../../../src/crawler/rate-limit.ts';
import { RobotsCache } from '../../../src/crawler/robots.ts';

function makeHttp(
  fetcher: typeof fetch,
  robotsBody = 'User-agent: *\nAllow: /\n',
  failureBudget = 1,
): PortalHttp {
  return new PortalHttp({
    userAgent: 'danni-bg/test',
    rateLimiter: new RateLimiter({ requestsPerSecond: 100, concurrency: 4 }),
    backoff: new BackoffRunner({
      initialMs: 5,
      maxMs: 20,
      failureBudget,
      sleep: async () => {},
    }),
    robots: new RobotsCache({
      recheckIntervalSeconds: 86400,
      fetcher: async () => ({ status: 200, body: robotsBody }),
    }),
    fetcher,
  });
}

describe('crawler.PortalHttp.postJson', () => {
  it('POSTs a JSON body with content-type and returns the parsed envelope', async () => {
    const seen: { method: string; body: unknown; ct: string | null } = {
      method: '',
      body: undefined,
      ct: null,
    };
    const fetcher = (async (_url: string, init?: RequestInit) => {
      seen.method = init?.method ?? '';
      seen.body = init?.body ? JSON.parse(init.body as string) : undefined;
      seen.ct = new Headers(init?.headers).get('content-type');
      return new Response(JSON.stringify({ success: true, n: 1 }), {
        status: 200,
      }) as unknown as Response;
    }) as unknown as typeof fetch;

    const res = await makeHttp(fetcher).postJson<{ success: boolean; n: number }>(
      'https://data.egov.bg/api/listDatasets',
      { page_number: 1 },
    );
    expect(res.body.success).toBe(true);
    expect(seen.method).toBe('POST');
    expect(seen.body).toEqual({ page_number: 1 });
    expect(seen.ct).toBe('application/json');
  });

  it('forwards extra headers (e.g. api_key)', async () => {
    const seen: { key: string | null } = { key: null };
    const fetcher = (async (_url: string, init?: RequestInit) => {
      seen.key = new Headers(init?.headers).get('x-api-key');
      return new Response('{"success":true}', { status: 200 }) as unknown as Response;
    }) as unknown as typeof fetch;
    await makeHttp(fetcher).postJson('https://data.egov.bg/api/x', {}, { 'x-api-key': 'K' });
    expect(seen.key).toBe('K');
  });

  it('refuses to POST when robots.txt disallows the path', async () => {
    const fetcher = (async () =>
      new Response('{}', { status: 200 }) as unknown as Response) as unknown as typeof fetch;
    const http = makeHttp(fetcher, 'User-agent: *\nDisallow: /\n');
    await expect(http.postJson('https://blocked.example/api/x', {})).rejects.toThrow(
      /robots\.txt disallows/,
    );
  });

  it('retries a 429 honoring Retry-After, then succeeds', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      if (calls === 1) {
        return new Response('{}', {
          status: 429,
          headers: { 'retry-after': '0' },
        }) as unknown as Response;
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
      }) as unknown as Response;
    }) as unknown as typeof fetch;
    const res = await makeHttp(fetcher, undefined, 3).postJson<{ success: boolean }>(
      'https://data.egov.bg/api/x',
      {},
    );
    expect(calls).toBe(2);
    expect(res.body.success).toBe(true);
  });

  it('retries a 503 without Retry-After, then succeeds', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return calls === 1
        ? (new Response('err', { status: 503 }) as unknown as Response)
        : (new Response('{"success":true}', { status: 200 }) as unknown as Response);
    }) as unknown as typeof fetch;
    await makeHttp(fetcher, undefined, 3).postJson('https://data.egov.bg/api/x', {});
    expect(calls).toBe(2);
  });

  it('fails terminally (no retry) on a non-JSON body from a final response', async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return new Response('<html>Moved</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }) as unknown as Response;
    }) as unknown as typeof fetch;
    // failureBudget 3, but a non-JSON final response must NOT be retried.
    await expect(
      makeHttp(fetcher, undefined, 3).postJson('https://data.egov.bg/api/3/action/x', {}),
    ).rejects.toThrow(/returned non-JSON.*text\/html/);
    expect(calls).toBe(1);
  });
});
