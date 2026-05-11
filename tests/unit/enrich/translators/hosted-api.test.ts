import { describe, expect, it } from 'bun:test';
import { HostedApiTranslator } from '../../../../src/enrich/translators/hosted-api.ts';

describe('enrich.translators.hosted-api', () => {
  it('POSTs JSON and uses bearer when supplied', async () => {
    let captured: { url: string; init: RequestInit | undefined } | null = null;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit | undefined) => {
      captured = { url: typeof url === 'string' ? url : url.toString(), init };
      return new Response(JSON.stringify({ text: 'Hello', confidence: 0.9 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }) as unknown as Response;
    }) as unknown as typeof fetch;
    const t = new HostedApiTranslator({
      endpointUrl: 'https://api/x',
      bearer: 'TOKEN',
      fetcher,
      model: 'foo',
    });
    const r = await t.translate('Здравей', 'bg', 'en');
    expect(r.text).toBe('Hello');
    expect(r.confidence).toBe(0.9);
    expect(captured).not.toBeNull();
    const headers = (captured as unknown as { init: RequestInit }).init.headers as Record<
      string,
      string
    >;
    expect(headers.authorization).toBe('Bearer TOKEN');
    expect(t.id).toBe('hosted-api:foo');
  });

  it('throws on non-2xx', async () => {
    const fetcher = (async () =>
      new Response('boom', { status: 500 }) as unknown as Response) as unknown as typeof fetch;
    const t = new HostedApiTranslator({ endpointUrl: 'https://api/x', fetcher });
    await expect(t.translate('hi', 'bg', 'en')).rejects.toThrow();
  });

  it('defaults id to endpoint when no model', () => {
    const fetcher = (async () =>
      new Response('{}', { status: 200 }) as unknown as Response) as unknown as typeof fetch;
    const t = new HostedApiTranslator({ endpointUrl: 'https://api/y', fetcher });
    expect(t.id).toBe('hosted-api:https://api/y');
  });

  it('handles missing body fields with defaults', async () => {
    const fetcher = (async () =>
      new Response('{}', { status: 200 }) as unknown as Response) as unknown as typeof fetch;
    const t = new HostedApiTranslator({ endpointUrl: 'https://api/z', fetcher });
    const r = await t.translate('hi', 'bg', 'en');
    expect(r.text).toBe('');
    expect(r.confidence).toBe(0.5);
  });
});
