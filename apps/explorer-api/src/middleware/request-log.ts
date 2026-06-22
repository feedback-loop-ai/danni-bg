// Request logging + RED metrics middleware (spec 030, FR-138). Emits one structured line per request
// (method, path, status, durationMs) via the redacting logger and feeds the in-process Metrics. Static
// asset + probe traffic is skipped to keep the signal clean — only API + auth flows are logged/metered.

import type { MiddlewareHandler } from 'hono';
import { log } from '../logging.ts';
import type { Metrics } from '../metrics.ts';

/** Paths worth logging/metering: the API surface + auth flows (not static assets or the probes). */
function isObserved(path: string): boolean {
  return path.startsWith('/api/') || path.startsWith('/kratos/');
}

export function requestLog(
  metrics?: Metrics,
  now: () => number = () => Date.now(),
): MiddlewareHandler {
  return async (c, next) => {
    if (!isObserved(c.req.path)) {
      await next();
      return undefined;
    }
    const start = now();
    await next();
    const durationMs = Math.max(0, now() - start);
    const status = c.res.status;
    metrics?.record(status, durationMs);
    const fields = { method: c.req.method, path: c.req.path, status, durationMs };
    if (status >= 500) log.error('request', fields);
    else log.info('request', fields);
    return undefined;
  };
}
