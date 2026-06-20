// In-flight generation registry (mid-stream resume): live streaming, snapshot replay, stop, eviction.

import { describe, expect, it } from 'bun:test';
import { type GenEvent, GenerationManager } from '../src/chat/generation-manager.ts';

const tick = () => new Promise((r) => setTimeout(r, 5));

/** Subscribe and resolve with all events once the generation ends. */
function collect(m: GenerationManager, id: string): Promise<GenEvent[]> {
  return new Promise((resolve) => {
    const events: GenEvent[] = [];
    const sub = m.subscribe(id, (e) => {
      events.push(e);
      if (e.type === 'done' || e.type === 'error') resolve(events);
    });
    if (!sub) resolve(events);
  });
}

describe('GenerationManager', () => {
  it('streams tokens live to a subscriber and records the final snapshot', async () => {
    const m = new GenerationManager(50);
    m.start({
      messageId: 'g1',
      sessionId: 's1',
      userId: 'u1',
      run: async (h) => {
        h.onToken('Hello');
        h.onToken(' world');
        h.onCitations([{ datasetId: 'd1' }] as never);
      },
    });
    const events = await collect(m, 'g1');
    expect(
      events
        .filter((e) => e.type === 'token')
        .map((e) => (e as { delta: string }).delta)
        .join(''),
    ).toBe('Hello world');
    expect(events.some((e) => e.type === 'citations')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
    expect(m.snapshot('g1')).toMatchObject({ userId: 'u1', status: 'done', text: 'Hello world' });
  });

  it('replays a snapshot to a late (reconnecting) subscriber', async () => {
    const m = new GenerationManager(50);
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    m.start({
      messageId: 'g2',
      sessionId: 's1',
      userId: 'u1',
      run: async (h) => {
        h.onToken('part');
        await gate;
        h.onToken(' more');
      },
    });
    await tick(); // 'part' has streamed; the run is paused at the gate
    expect(m.subscribe('g2', () => {})?.snapshot.text).toBe('part');
    const done = collect(m, 'g2');
    release();
    expect((await done).some((e) => e.type === 'done')).toBe(true);
    expect(m.snapshot('g2')?.text).toBe('part more');
  });

  it('reflects the active generation per session and supports server-side stop', async () => {
    const m = new GenerationManager(50);
    m.start({
      messageId: 'g3',
      sessionId: 's9',
      userId: 'u1',
      run: (_h, signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped')));
        }),
    });
    await tick();
    expect(m.activeForSession('s9')).toBe('g3');
    const done = collect(m, 'g3');
    expect(m.stop('g3')).toBe(true);
    expect((await done).at(-1)).toMatchObject({ type: 'error', message: 'stopped' });
    expect(m.activeForSession('s9')).toBeUndefined();
    expect(m.stop('missing')).toBe(false);
  });

  it('returns null when subscribing to an unknown generation', () => {
    expect(new GenerationManager(50).subscribe('nope', () => {})).toBeNull();
  });
});
