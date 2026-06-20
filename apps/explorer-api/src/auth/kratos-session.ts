// Single-port auth glue (spec 019). Lets the Hono server stand alone — no Oathkeeper required:
//  - `kratosSessionResolver` validates the Kratos session directly via /sessions/whoami using the
//    request's cookie (the fallback `requireAuth` uses when Oathkeeper's X-User-* headers are absent).
//  - `kratosProxy` reverse-proxies /kratos/* to Kratos on the SAME origin, so the SPA's self-service
//    flows + whoami work without a separate dev/proxy server (first-party cookies/CSRF).
// Both take an injectable fetch for hermetic tests.

import type { Context } from 'hono';

export interface ResolvedIdentity {
  userId: string;
  email: string;
  verified: boolean;
  displayName: string | null;
}

export type SessionResolver = (cookie: string | undefined) => Promise<ResolvedIdentity | null>;

interface WhoamiResponse {
  active?: boolean;
  identity?: {
    id: string;
    traits?: { email?: string; name?: { first?: string; last?: string } };
    verifiable_addresses?: { verified: boolean }[];
  };
}

/** Join the `name.{first,last}` traits into a display name; null when both are empty. */
export function displayNameFromTraits(traits?: {
  name?: { first?: string; last?: string };
}): string | null {
  const full = `${traits?.name?.first?.trim() ?? ''} ${traits?.name?.last?.trim() ?? ''}`.trim();
  return full || null;
}

/** Resolve the app identity from a Kratos session cookie via /sessions/whoami; null when invalid. */
export function kratosSessionResolver(
  kratosBaseUrl: string,
  fetchImpl: typeof fetch = fetch,
): SessionResolver {
  const base = kratosBaseUrl.replace(/\/$/, '');
  return async (cookie) => {
    if (!cookie) return null;
    try {
      const res = await fetchImpl(`${base}/sessions/whoami`, { headers: { cookie } });
      if (!res.ok) return null;
      const s = (await res.json()) as WhoamiResponse;
      const id = s.identity?.id;
      const email = s.identity?.traits?.email;
      if (!s.active || !id || !email) return null;
      return {
        userId: id,
        email,
        verified: s.identity?.verifiable_addresses?.[0]?.verified ?? false,
        displayName: displayNameFromTraits(s.identity?.traits),
      };
    } catch {
      return null;
    }
  };
}

/** Hono handler reverse-proxying `/kratos/*` → Kratos (strips the `/kratos` prefix). */
export function kratosProxy(kratosBaseUrl: string, fetchImpl: typeof fetch = fetch) {
  const base = kratosBaseUrl.replace(/\/$/, '');
  return async (c: Context): Promise<Response> => {
    const url = new URL(c.req.url);
    const target = `${base}${url.pathname.replace(/^\/kratos/, '')}${url.search}`;
    const headers = new Headers(c.req.raw.headers);
    headers.delete('host');
    const method = c.req.method;
    const init: RequestInit = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = c.req.raw.body;
      (init as RequestInit & { duplex: 'half' }).duplex = 'half';
    }
    const res = await fetchImpl(target, init);
    // fetch already decoded the body; drop encoding/length headers so the browser doesn't re-decode.
    const out = new Headers(res.headers);
    out.delete('content-encoding');
    out.delete('content-length');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  };
}
