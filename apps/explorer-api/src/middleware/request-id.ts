// Request-id correlation (spec 032, FR-148). Reuse an inbound X-Request-Id (e.g. from the edge/ingress)
// or mint one, stash it on the context, and echo it on the response. request-log + the span tracer read
// it so a single turn's log line, metrics, and spans all correlate by the same id (SC-F1).

import type { MiddlewareHandler } from 'hono';

const VALID = /^[A-Za-z0-9._-]{1,128}$/; // accept only a sane inbound id; otherwise mint our own

export function requestId(generate: () => string = () => crypto.randomUUID()): MiddlewareHandler {
  return async (c, next) => {
    const inbound = c.req.header('x-request-id');
    const id = inbound && VALID.test(inbound) ? inbound : generate();
    c.set('requestId', id);
    c.header('x-request-id', id);
    await next();
    return undefined;
  };
}
