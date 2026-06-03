import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackoffRunner } from '../../../src/crawler/backoff.ts';
import { EgovBgClient } from '../../../src/crawler/egov-bg-client.ts';
import { PortalHttp } from '../../../src/crawler/http.ts';
import { RateLimiter } from '../../../src/crawler/rate-limit.ts';
import { RobotsCache } from '../../../src/crawler/robots.ts';

const FIX = fileURLToPath(new URL('../../fixtures/egov/', import.meta.url));
const fixture = (name: string): string => readFileSync(join(FIX, `${name}.json`), 'utf-8');

interface Captured {
  url: string;
  body: unknown;
}

function makeClient(
  responder: (method: string, body: unknown) => { status?: number; json: unknown },
  captured: Captured[] = [],
  apiKey?: string,
): EgovBgClient {
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const u = url.toString();
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    captured.push({ url: u, body });
    const method = u.split('/').pop() ?? '';
    const { status = 200, json } = responder(method, body);
    return new Response(JSON.stringify(json), { status }) as unknown as Response;
  }) as unknown as typeof fetch;

  const http = new PortalHttp({
    userAgent: 'danni-bg/test',
    rateLimiter: new RateLimiter({ requestsPerSecond: 100, concurrency: 4 }),
    backoff: new BackoffRunner({
      initialMs: 10,
      maxMs: 100,
      failureBudget: 1,
      sleep: async () => {},
    }),
    robots: new RobotsCache({ recheckIntervalSeconds: 86400, obey: false }),
    fetcher,
  });
  return new EgovBgClient({ baseUrl: 'https://data.egov.bg/api/', http, apiKey });
}

const fixtureResponder = (method: string) => ({ json: JSON.parse(fixture(method)) });

describe('crawler.egov-bg-client', () => {
  it('lists datasets', async () => {
    const res = await makeClient(fixtureResponder).listDatasets({ recordsPerPage: 3 });
    expect(res.success).toBe(true);
    expect(res.datasets.length).toBe(3);
    expect(res.datasets[0]?.uri).toBe('2e634036-6ab9-4efd-bd8e-c8e14a931911');
  });

  it('gets dataset details with tags and resources', async () => {
    const det = await makeClient(fixtureResponder).getDatasetDetails('2e634036');
    expect(det.data.name.length).toBeGreaterThan(0);
    expect((det.data.tags ?? []).map((t) => t.name)).toContain('ППС');
    const res = await makeClient(fixtureResponder).listResources('2e634036');
    expect(res.resources[0]?.file_format).toBe('CSV');
  });

  it('gets datastore rows (array-of-arrays with a header) and organisations', async () => {
    const data = await makeClient(fixtureResponder).getResourceData('f3a30929');
    expect(Array.isArray(data.data[0])).toBe(true);
    const orgs = await makeClient(fixtureResponder).listOrganisations();
    expect(orgs.organisations.length).toBeGreaterThan(0);
  });

  it('sends method as the URL path segment and POSTs a JSON body', async () => {
    const captured: Captured[] = [];
    await makeClient(fixtureResponder, captured).listDatasets({ recordsPerPage: 7, pageNumber: 2 });
    expect(captured[0]?.url).toBe('https://data.egov.bg/api/listDatasets');
    expect(captured[0]?.body).toMatchObject({ records_per_page: 7, page_number: 2 });
  });

  it('includes api_key in the body when configured', async () => {
    const captured: Captured[] = [];
    await makeClient(fixtureResponder, captured, 'SECRET').listDatasets();
    expect((captured[0]?.body as { api_key?: string }).api_key).toBe('SECRET');
  });

  it('throws on a {success:false} error envelope', async () => {
    const client = makeClient(() => ({
      json: { success: false, errors: { criteria: ['required'] }, error: { type: 'Обща' } },
    }));
    await expect(client.listResources('x')).rejects.toThrow(/egov-bg listResources failed/);
  });

  it('throws on a schema violation (missing required field)', async () => {
    const client = makeClient(() => ({ json: { success: true } }));
    await expect(client.listDatasets()).rejects.toThrow(/schema violation/);
  });
});
