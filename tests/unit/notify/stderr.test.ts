import { describe, expect, it } from 'bun:test';
import { StderrNotifier } from '../../../src/notify/notifier.ts';

describe('notify.stderr', () => {
  it('writes a JSON line with payload', async () => {
    const out: string[] = [];
    const n = new StderrNotifier((line) => out.push(line));
    await n.dispatch({ runId: 'r1', kind: 'run_failed', summary: 'boom' });
    expect(out.length).toBe(1);
    const parsed = JSON.parse(out[0] ?? '{}');
    expect(parsed.notifier).toBe('stderr');
    expect(parsed.runId).toBe('r1');
    expect(parsed.kind).toBe('run_failed');
  });

  it('default sink writes to process.stderr', async () => {
    const original = process.stderr.write;
    let captured = '';
    (process.stderr as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      captured += s;
      return true;
    };
    try {
      const n = new StderrNotifier();
      await n.dispatch({ runId: 'r1', kind: 'run_failed', summary: 's' });
    } finally {
      process.stderr.write = original;
    }
    expect(captured).toContain('"runId":"r1"');
  });

  it('exposes channel name', () => {
    const n = new StderrNotifier();
    expect(n.channel).toBe('stderr');
  });
});
