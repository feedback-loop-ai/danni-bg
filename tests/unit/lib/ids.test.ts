import { describe, expect, it } from 'bun:test';
import { isUlid, ulid } from '../../../src/lib/ids.ts';

describe('ids.ulid', () => {
  it('produces a 26-char Crockford-base32 string', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it('is monotonic with respect to time', () => {
    const a = ulid({ now: 1_700_000_000_000, random: () => 0 });
    const b = ulid({ now: 1_700_000_000_001, random: () => 0 });
    expect(a < b).toBe(true);
  });

  it('uses provided random source for the random suffix', () => {
    const id = ulid({ now: 0, random: () => 0 });
    expect(id.endsWith('0000000000000000')).toBe(true);
    const id2 = ulid({ now: 0, random: () => 0.999999 });
    expect(id2.endsWith('ZZZZZZZZZZZZZZZZ')).toBe(true);
  });

  it('rejects negative or non-finite times', () => {
    expect(() => ulid({ now: -1 })).toThrow(/invalid time/);
    expect(() => ulid({ now: Number.NaN })).toThrow(/invalid time/);
    expect(() => ulid({ now: Number.POSITIVE_INFINITY })).toThrow(/invalid time/);
  });

  it('isUlid rejects malformed strings', () => {
    expect(isUlid('not-a-ulid')).toBe(false);
    expect(isUlid('')).toBe(false);
    expect(isUlid('0'.repeat(27))).toBe(false);
    expect(isUlid('I'.repeat(26))).toBe(false);
  });
});
