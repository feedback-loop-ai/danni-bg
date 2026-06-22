// Request logging + RED metrics middleware (spec 030, deepened in 032). Emits one structured line per
// request (method, path, status, durationMs, requestId, route class) via the redacting logger and feeds
// the metrics registry per route class. Static asset + probe traffic is skipped to keep the signal
// clean — only API + auth flows are logged/metered. The request id (request-id.ts) correlates the log
// line, the metrics, and the span trace for a turn (FR-148).

import type { MiddlewareHandler } from 'hono';
import { log } from '../logging.ts';
import { type Metrics, routeClassOf } from '../metrics.ts';

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
    const route = routeClassOf(c.req.path);
    metrics?.recordRequest(route, status, durationMs);
    const requestId = c.get('requestId') as string | undefined;
    const fields = {
      method: c.req.method,
      path: c.req.path,
      route,
      status,
      durationMs,
      ...(requestId ? { requestId } : {}),
    };
    if (status >= 500) log.error('request', fields);
    else log.info('request', fields);
    return undefined;
  };
}
