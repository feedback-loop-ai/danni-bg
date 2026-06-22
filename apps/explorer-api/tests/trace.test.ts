// Span tracer + request-id middleware (spec 032) — hermetic.

import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { requestId } from '../src/middleware/request-id.ts';
import { type SpanAttrs, Tracer } from '../src/trace.ts';

describe('Tracer (spec 032)', () => {
  function capturing() {
    const spans: { name: string; requestId?: string; durationMs: number; attrs: SpanAttrs }[] = [];
    let t = 0;
    const now = () => {
      t += 5;
      return t;
    };
    const tracer = new Tracer('req-1', now, (e) => spans.push(e));
    return { spans, tracer };
  }

  it('emits one span with requestId, duration, and merged attrs', () => {
    const { spans, tracer } = capturing();
    const s = tracer.startSpan('chat.tool', { tool: 'mirrorSearch' });
    s.setAttrs({ hits: 3 });
    s.end({ ok: true });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({
      name: 'chat.tool',
      requestId: 'req-1',
      attrs: { tool: 'mirrorSearch', hits: 3, ok: true },
    });
    expect(spans[0]?.durationMs).toBeGreaterThan(0);
  });

  it('end is idempotent', () => {
    const { spans, tracer } = capturing();
    const s = tracer.startSpan('x');
    s.end();
    s.end();
    expect(spans).toHaveLength(1);
  });

  it('withSpan records ok=true on success and re-throws with ok=false on error', async () => {
    const { spans, tracer } = capturing();
    await tracer.withSpan('ok', async () => 42);
    await expect(
      tracer.withSpan('boom', async () => {
        throw new TypeError('nope');
      }),
    ).rejects.toThrow('nope');
    expect(spans.map((s) => [s.name, s.attrs.ok])).toEqual([
      ['ok', true],
      ['boom', false],
    ]);
    expect(spans[1]?.attrs.error).toBe('TypeError');
  });
});

describe('requestId middleware (spec 032)', () => {
  it('mints an id and echoes it on the response', async () => {
    const app = new Hono<{ Variables: { requestId: string } }>();
    app.use(
      '*',
      requestId(() => 'generated-id'),
    );
    app.get('/x', (c) => c.json({ id: c.get('requestId') }));
    const res = await app.request('/x');
    expect(res.headers.get('x-request-id')).toBe('generated-id');
    expect(((await res.json()) as { id: string }).id).toBe('generated-id');
  });

  it('reuses a sane inbound id but rejects a malformed one', async () => {
    const app = new Hono<{ Variables: { requestId: string } }>();
    app.use(
      '*',
      requestId(() => 'minted'),
    );
    app.get('/x', (c) => c.text(c.get('requestId') as string));
    const good = await app.request('/x', { headers: { 'x-request-id': 'edge-abc.123' } });
    expect(await good.text()).toBe('edge-abc.123');
    const bad = await app.request('/x', { headers: { 'x-request-id': 'has spaces!' } });
    expect(await bad.text()).toBe('minted');
  });
});
