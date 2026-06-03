import { describe, expect, it } from 'bun:test';
import { BackoffRunner } from '../../../src/crawler/backoff.ts';
import { PortalHttp } from '../../../src/crawler/http.ts';
import { RateLimiter } from '../../../src/crawler/rate-limit.ts';
import { RobotsCache } from '../../../src/crawler/robots.ts';

function makeHttp(fetcher: typeof fetch, robotsBody = 'User-agent: *\nAllow: /\n'): PortalHttp {
  return new PortalHttp({
    userAgent: 'danni-bg/test',
    rateLimiter: new RateLimiter({ requestsPerSecond: 100, concurrency: 4 }),
    backoff: new BackoffRunner({
      initialMs: 5,
      maxMs: 20,
      failureBudget: 1,
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
});
