// RED metrics + request-log middleware (spec 030, FR-138) — hermetic.

import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { Metrics } from '../src/metrics.ts';
import { requestLog } from '../src/middleware/request-log.ts';

describe('Metrics (spec 030)', () => {
  it('counts requests, 5xx errors, status classes, and averages latency', () => {
    const m = new Metrics();
    m.record(200, 10);
    m.record(404, 20);
    m.record(500, 30);
    const s = m.snapshot();
    expect(s.requestsTotal).toBe(3);
    expect(s.errorsTotal).toBe(1); // only the 5xx
    expect(s.avgLatencyMs).toBe(20);
    expect(s.byStatusClass).toEqual({ '2xx': 1, '4xx': 1, '5xx': 1 });
  });

  it('reset clears the snapshot', () => {
    const m = new Metrics();
    m.record(200, 5);
    m.reset();
    expect(m.snapshot()).toEqual({
      requestsTotal: 0,
      errorsTotal: 0,
      avgLatencyMs: 0,
      byStatusClass: {},
    });
  });
});

describe('requestLog middleware (spec 030)', () => {
  function appWith(metrics: Metrics) {
    // A controllable clock so latency is deterministic (advance 7ms per request).
    let t = 1000;
    const now = () => {
      t += 7;
      return t;
    };
    const app = new Hono();
    app.use('*', requestLog(metrics, now));
    app.get('/api/ok', (c) => c.json({ ok: true }));
    app.get('/api/boom', (c) => c.json({ error: 'x' }, 500));
    app.get('/static.js', (c) => c.text('asset'));
    return app;
  }

  it('meters observed API requests with their status + latency', async () => {
    const m = new Metrics();
    const app = appWith(m);
    expect((await app.request('/api/ok')).status).toBe(200);
    expect((await app.request('/api/boom')).status).toBe(500);
    const s = m.snapshot();
    expect(s.requestsTotal).toBe(2);
    expect(s.errorsTotal).toBe(1);
    expect(s.avgLatencyMs).toBe(7);
  });

  it('does not meter static/non-observed paths', async () => {
    const m = new Metrics();
    const app = appWith(m);
    await app.request('/static.js');
    expect(m.snapshot().requestsTotal).toBe(0);
  });
});
