import { describe, expect, it } from 'bun:test';
import { HostedApiEmbedder } from '../../../../src/index/embedders/hosted-api.ts';

describe('index.embedders.hosted-api', () => {
  it('POSTs and parses an OpenAI-style response', async () => {
    let captured: { url: string; init: RequestInit | undefined } | null = null;
    const fetcher = (async (url: string | URL | Request, init?: RequestInit | undefined) => {
      captured = { url: typeof url === 'string' ? url : url.toString(), init };
      return new Response(
        JSON.stringify({ data: [{ embedding: [1, 2, 3, 4] }, { embedding: [5, 6, 7, 8] }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ) as unknown as Response;
    }) as unknown as typeof fetch;
    const e = new HostedApiEmbedder({
      endpointUrl: 'https://api/embed',
      bearer: 'TOK',
      fetcher,
      modelId: 'm',
      dimension: 4,
    });
    const out = await e.embed(['a', 'b']);
    expect(out.length).toBe(2);
    expect(out[0]?.[0]).toBe(1);
    expect(out[1]?.[3]).toBe(8);
    const headers = (captured as unknown as { init: RequestInit }).init.headers as Record<
      string,
      string
    >;
    expect(headers.authorization).toBe('Bearer TOK');
  });

  it('throws on count mismatch', async () => {
    const fetcher = (async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1] }] }), {
        status: 200,
      }) as unknown as Response) as unknown as typeof fetch;
    const e = new HostedApiEmbedder({
      endpointUrl: 'https://api/embed',
      fetcher,
      modelId: 'm',
      dimension: 1,
    });
    await expect(e.embed(['a', 'b'])).rejects.toThrow();
  });

  it('throws on non-2xx', async () => {
    const fetcher = (async () =>
      new Response('boom', { status: 500 }) as unknown as Response) as unknown as typeof fetch;
    const e = new HostedApiEmbedder({ endpointUrl: 'https://api/x', fetcher });
    await expect(e.embed(['a'])).rejects.toThrow();
  });

  it('handles missing data field defensively', async () => {
    const fetcher = (async () =>
      new Response('{}', { status: 200 }) as unknown as Response) as unknown as typeof fetch;
    const e = new HostedApiEmbedder({ endpointUrl: 'https://api/y', fetcher });
    await expect(e.embed(['a'])).rejects.toThrow();
  });

  it('builds id from modelId', () => {
    const fetcher = (async () =>
      new Response('{}', { status: 200 }) as unknown as Response) as unknown as typeof fetch;
    const e = new HostedApiEmbedder({
      endpointUrl: 'https://api/x',
      fetcher,
      modelId: 'multilingual-mini',
    });
    expect(e.id).toBe('hosted-api:multilingual-mini');
    expect(e.dimension).toBe(384);
  });
});
