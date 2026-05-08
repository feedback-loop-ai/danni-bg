import { describe, expect, it } from 'bun:test';
import {
  hasCyrillic,
  isCyrillic,
  normalizeNfc,
  slugifyCyrillic,
} from '../../../src/lib/cyrillic.ts';

describe('cyrillic.isCyrillic', () => {
  it('returns true for pure Bulgarian Cyrillic', () => {
    expect(isCyrillic('данни')).toBe(true);
    expect(isCyrillic('София')).toBe(true);
  });

  it('returns false for mixed Latin/Cyrillic or empty', () => {
    expect(isCyrillic('данни-bg')).toBe(false);
    expect(isCyrillic('')).toBe(false);
    expect(isCyrillic('hello')).toBe(false);
  });
});

describe('cyrillic.hasCyrillic', () => {
  it('detects any Bulgarian Cyrillic character', () => {
    expect(hasCyrillic('данни-bg')).toBe(true);
    expect(hasCyrillic('hello')).toBe(false);
    expect(hasCyrillic('')).toBe(false);
  });
});

describe('cyrillic.slugifyCyrillic', () => {
  it('keeps Cyrillic letters intact and lowercases the result', () => {
    expect(slugifyCyrillic('София Регион')).toBe('софия-регион');
  });

  it('strips punctuation and collapses dashes', () => {
    expect(slugifyCyrillic('  Бъл/гар!ия  ')).toBe('бъл-гар-ия');
    expect(slugifyCyrillic('a -- b')).toBe('a-b');
  });

  it('returns empty string for empty input', () => {
    expect(slugifyCyrillic('')).toBe('');
  });
});

describe('cyrillic.normalizeNfc', () => {
  it('returns the NFC-normalized form of a string', () => {
    const decomposed = 'е́'; // composed 'е' + combining acute
    expect(normalizeNfc(decomposed)).toBe(decomposed.normalize('NFC'));
  });
});
