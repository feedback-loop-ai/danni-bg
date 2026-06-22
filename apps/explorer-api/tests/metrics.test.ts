// Metrics registry + request-log middleware (spec 030 RED, deepened in 032) — hermetic.

import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { Metrics, routeClassOf } from '../src/metrics.ts';
import { requestLog } from '../src/middleware/request-log.ts';

describe('Metrics (spec 032)', () => {
  it('aggregates RED across route classes for the snapshot', () => {
    const m = new Metrics();
    m.recordRequest('data', 200, 10);
    m.recordRequest('chat', 404, 20);
    m.recordRequest('chat', 500, 30);
    const s = m.snapshot();
    expect(s.requestsTotal).toBe(3);
    expect(s.errorsTotal).toBe(1);
    expect(s.avgLatencyMs).toBe(20);
    expect(s.byStatusClass).toEqual({ '2xx': 1, '4xx': 1, '5xx': 1 });
  });

  it('records domain signals: llm tokens/cost, 429s, chat outcomes', () => {
    const m = new Metrics();
    m.recordLlm({ inputTokens: 100, outputTokens: 40, cachedInputTokens: 25 }, 0.0123);
    m.recordRateLimitRejection('data');
    m.recordChatOutcome('grounded');
    m.recordChatOutcome('no_data');
    const s = m.snapshot();
    expect(s.llmTokens).toEqual({ input: 100, output: 40, cached: 25 });
    expect(s.llmCostUsd).toBeCloseTo(0.0123);
    expect(s.rateLimitRejections).toBe(1);
    expect(s.chatOutcomes).toEqual({ grounded: 1, no_data: 1 });
  });

  it('emits Prometheus exposition with labels + scrape-time gauges', () => {
    const m = new Metrics();
    m.recordRequest('data', 200, 5);
    m.recordLlm({ inputTokens: 10, outputTokens: 5 }, 0.5);
    m.recordChatOutcome('error');
    const text = m.prometheus({ danni_active_generations: 2, danni_index_stale_datasets: 7 });
    expect(text).toContain('# TYPE danni_http_requests_total counter');
    expect(text).toContain('danni_http_requests_total{route="data",status="2xx"} 1');
    expect(text).toContain('danni_llm_cost_usd_total 0.5');
    expect(text).toContain('danni_chat_outcomes_total{outcome="error"} 1');
    expect(text).toContain('danni_active_generations 2');
    expect(text).toContain('danni_index_stale_datasets 7');
  });

  it('routeClassOf maps paths to classes', () => {
    expect(routeClassOf('/api/chat')).toBe('chat');
    expect(routeClassOf('/api/admin/usage')).toBe('admin');
    expect(routeClassOf('/api/datasets')).toBe('data');
    expect(routeClassOf('/assets/x.js')).toBe('other');
  });

  it('reset clears everything', () => {
    const m = new Metrics();
    m.recordRequest('data', 200, 5);
    m.recordLlm({ inputTokens: 1, outputTokens: 1 }, 1);
    m.reset();
    const s = m.snapshot();
    expect(s.requestsTotal).toBe(0);
    expect(s.llmCostUsd).toBe(0);
  });
});

describe('requestLog middleware (spec 032)', () => {
  function appWith(metrics: Metrics) {
    let t = 1000;
    const now = () => {
      t += 7;
      return t;
    };
    const app = new Hono<{ Variables: { requestId: string } }>();
    app.use('*', async (c, next) => {
      c.set('requestId', 'req-test');
      await next();
    });
    app.use('*', requestLog(metrics, now));
    app.get('/api/datasets', (c) => c.json({ ok: true }));
    app.post('/api/chat', (c) => c.json({ error: 'x' }, 500));
    app.get('/static.js', (c) => c.text('asset'));
    return app;
  }

  it('meters observed requests by route class + status, skips static', async () => {
    const m = new Metrics();
    const app = appWith(m);
    expect((await app.request('/api/datasets')).status).toBe(200);
    expect((await app.request('/api/chat', { method: 'POST' })).status).toBe(500);
    await app.request('/static.js');
    const text = m.prometheus();
    expect(text).toContain('danni_http_requests_total{route="data",status="2xx"} 1');
    expect(text).toContain('danni_http_requests_total{route="chat",status="5xx"} 1');
    const s = m.snapshot();
    expect(s.requestsTotal).toBe(2); // static skipped
    expect(s.errorsTotal).toBe(1);
  });
});
