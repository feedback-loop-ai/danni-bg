// Single-port auth glue (spec 019): the Kratos session resolver + the /kratos reverse proxy. Hermetic
// via an injected fetch — no live Kratos.

import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { kratosProxy, kratosSessionResolver } from '../src/auth/kratos-session.ts';

function fetchReturning(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; method?: string | undefined; cookie?: string | undefined }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      cookie: new Headers(init?.headers).get('cookie') ?? undefined,
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('kratosSessionResolver', () => {
  it('returns the identity for an active session', async () => {
    const { impl, calls } = fetchReturning(200, {
      active: true,
      identity: {
        id: 'k-1',
        traits: { email: 'u@example.com' },
        verifiable_addresses: [{ verified: true }],
      },
    });
    const resolve = kratosSessionResolver('http://kratos:4433/', impl);
    expect(await resolve('ory_kratos_session=abc')).toEqual({
      userId: 'k-1',
      email: 'u@example.com',
      verified: true,
    });
    expect(calls[0]?.url).toBe('http://kratos:4433/sessions/whoami');
    expect(calls[0]?.cookie).toBe('ory_kratos_session=abc');
  });

  it('returns null without a cookie (no request made)', async () => {
    const { impl, calls } = fetchReturning(200, {});
    expect(await kratosSessionResolver('http://kratos:4433', impl)(undefined)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns null on a non-OK response, inactive session, or missing email', async () => {
    expect(await kratosSessionResolver('http://k', fetchReturning(401, {}).impl)('c')).toBeNull();
    expect(
      await kratosSessionResolver('http://k', fetchReturning(200, { active: false }).impl)('c'),
    ).toBeNull();
    expect(
      await kratosSessionResolver(
        'http://k',
        fetchReturning(200, { active: true, identity: { id: 'x', traits: {} } }).impl,
      )('c'),
    ).toBeNull();
  });

  it('returns null (does not throw) when the request fails', async () => {
    const impl = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await kratosSessionResolver('http://k', impl)('c')).toBeNull();
  });
});

describe('kratosProxy', () => {
  it('forwards to Kratos with the /kratos prefix stripped and drops content-encoding', async () => {
    const { impl, calls } = fetchReturning(200, { ok: true }, { 'content-encoding': 'gzip' });
    const app = new Hono();
    app.all('/kratos/*', kratosProxy('http://kratos:4433', impl));

    const res = await app.request('/kratos/self-service/login/browser?return_to=x', {
      headers: { cookie: 'csrf=1' },
    });
    expect(res.status).toBe(200);
    expect(calls[0]?.url).toBe('http://kratos:4433/self-service/login/browser?return_to=x');
    expect(calls[0]?.cookie).toBe('csrf=1');
    // content-encoding must be stripped (fetch already decoded the body).
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(await res.json()).toEqual({ ok: true });
  });
});
