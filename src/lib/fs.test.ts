import { describe, expect, it } from 'bun:test';
import { safePathSegment } from './fs.ts';
import { sha256Hex } from './hash.ts';

describe('safePathSegment', () => {
  it('passes through short, separator-free ids verbatim (the common UUID case)', () => {
    const uuid = '581d4e52-15eb-4c2f-8e26-dd24b47df561';
    expect(safePathSegment(uuid)).toBe(uuid);
  });

  it('collapses an over-long id to a stable 32-char sha256 prefix', () => {
    // The real crawl blocker: a Cyrillic dataset title well past the 255-byte component limit.
    const longTitle =
      'Списък с набори от данни по приоритетни области, които да се публикуват в отворен формат на Портала за отворени данни, Приложение № 1.1 към т. 1, 2, 5 и 6';
    const seg = safePathSegment(longTitle);
    expect(seg).toBe(sha256Hex(longTitle).slice(0, 32));
    expect(seg).toHaveLength(32);
    expect(Buffer.byteLength(seg, 'utf-8')).toBeLessThanOrEqual(200);
    // Deterministic — same id always maps to the same segment.
    expect(safePathSegment(longTitle)).toBe(seg);
  });

  it('hashes ids containing path separators or dot navigation', () => {
    expect(safePathSegment('a/b')).toBe(sha256Hex('a/b').slice(0, 32));
    expect(safePathSegment('a\\b')).toBe(sha256Hex('a\\b').slice(0, 32));
    expect(safePathSegment('.')).toBe(sha256Hex('.').slice(0, 32));
    expect(safePathSegment('..')).toBe(sha256Hex('..').slice(0, 32));
    expect(safePathSegment('')).toBe(sha256Hex('').slice(0, 32));
  });

  it('distinguishes distinct over-long ids', () => {
    const a = 'я'.repeat(150);
    const b = 'ю'.repeat(150);
    expect(safePathSegment(a)).not.toBe(safePathSegment(b));
  });
});
