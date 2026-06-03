import { describe, expect, it } from 'bun:test';
import { diffSeconds, formatSofia, nowIso, parseIso, toIso } from '../../../src/lib/time.ts';

describe('time.nowIso', () => {
  it('returns ISO-8601 UTC of the supplied clock', () => {
    const t = new Date('2026-05-08T10:11:12.345Z');
    expect(nowIso(() => t)).toBe('2026-05-08T10:11:12.345Z');
  });

  it('uses real clock by default', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('time.toIso', () => {
  it('accepts a Date', () => {
    expect(toIso(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
  });

  it('accepts an epoch ms number', () => {
    expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('rejects invalid dates', () => {
    expect(() => toIso(Number.NaN)).toThrow(/invalid date/);
    expect(() => toIso(new Date('not a date'))).toThrow(/invalid date/);
  });
});

describe('time.parseIso', () => {
  it('round-trips with toIso', () => {
    const s = '2026-05-08T10:11:12.345Z';
    expect(toIso(parseIso(s))).toBe(s);
  });

  it('rejects invalid strings', () => {
    expect(() => parseIso('nope')).toThrow(/invalid ISO-8601/);
  });
});

describe('time.diffSeconds', () => {
  it('returns the delta in seconds', () => {
    expect(diffSeconds('2026-05-08T10:00:10.000Z', '2026-05-08T10:00:00.000Z')).toBe(10);
  });
});

describe('time.formatSofia', () => {
  it('formats a UTC time in Europe/Sofia', () => {
    const out = formatSofia('2026-05-08T10:00:00.000Z');
    expect(out).toMatch(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}:\d{2}/);
  });

  it('accepts a Date or epoch ms', () => {
    expect(formatSofia(new Date('2026-01-01T00:00:00Z'))).toMatch(/2026/);
    expect(formatSofia(0)).toMatch(/1970/);
  });

  it('rejects invalid input', () => {
    expect(() => formatSofia(Number.NaN)).toThrow(/invalid date/);
  });
});
