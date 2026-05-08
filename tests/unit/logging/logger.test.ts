import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  type LogLevel,
  _resetLogger,
  createLogger,
  getLogger,
  withContext,
} from '../../../src/logging/logger.ts';

function captured(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (l) => lines.push(l) };
}

describe('logger.createLogger', () => {
  it('writes JSON records with level/ts/event', () => {
    const c = captured();
    const log = createLogger({
      level: 'info',
      sink: c.sink,
      now: () => new Date('2026-05-08T10:00:00.000Z'),
    });
    log.info('hello', { run_id: 'r1' });
    expect(c.lines).toHaveLength(1);
    const firstLine = c.lines[0];
    if (!firstLine) throw new Error('no log line');
    const r = JSON.parse(firstLine) as Record<string, unknown>;
    expect(r['level']).toBe('info');
    expect(r['event']).toBe('hello');
    expect(r['ts']).toBe('2026-05-08T10:00:00.000Z');
    expect(r['run_id']).toBe('r1');
  });

  it('filters records below the configured level', () => {
    const c = captured();
    const log = createLogger({ level: 'warn', sink: c.sink });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(c.lines.map((l) => (JSON.parse(l) as { event: string }).event)).toEqual(['w', 'e']);
  });

  it('emits all four levels at debug', () => {
    const c = captured();
    const log = createLogger({ level: 'debug', sink: c.sink });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(c.lines).toHaveLength(4);
  });

  it('child() merges base context, then call fields override', () => {
    const c = captured();
    const log = createLogger({ level: 'debug', sink: c.sink, baseContext: { app: 'danni' } });
    const child = log.child({ run_id: 'r1', app: 'override' });
    child.info('e', { dataset_id: 'd1' });
    const firstLine = c.lines[0];
    if (!firstLine) throw new Error('no log line');
    const r = JSON.parse(firstLine) as Record<string, unknown>;
    expect(r['app']).toBe('override');
    expect(r['run_id']).toBe('r1');
    expect(r['dataset_id']).toBe('d1');
  });

  it('defaults level to info', () => {
    const c = captured();
    const log = createLogger({ sink: c.sink });
    expect(log.level).toBe('info');
    log.debug('skipped');
    expect(c.lines).toHaveLength(0);
  });

  it('writes to stderr when no sink is provided', () => {
    const log = createLogger({});
    const original = process.stderr.write.bind(process.stderr);
    let captured = '';
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
      return true;
    }) as typeof process.stderr.write;
    try {
      log.info('e');
    } finally {
      process.stderr.write = original;
    }
    expect(captured).toContain('"event":"e"');
  });
});

describe('logger.getLogger / withContext', () => {
  beforeEach(() => {
    _resetLogger();
  });
  afterEach(() => {
    _resetLogger();
    delete process.env['DANNI_LOG_LEVEL'];
  });

  it('returns a memoized root logger', () => {
    expect(getLogger()).toBe(getLogger());
  });

  it('honors DANNI_LOG_LEVEL', () => {
    process.env['DANNI_LOG_LEVEL'] = 'debug' satisfies LogLevel;
    _resetLogger();
    expect(getLogger().level).toBe('debug');
  });

  it('falls back to info when DANNI_LOG_LEVEL is invalid', () => {
    process.env['DANNI_LOG_LEVEL'] = 'nonsense';
    _resetLogger();
    expect(getLogger().level).toBe('info');
  });

  it('withContext returns a child logger', () => {
    const child = withContext({ run_id: 'r1' });
    expect(child).not.toBe(getLogger());
  });
});
