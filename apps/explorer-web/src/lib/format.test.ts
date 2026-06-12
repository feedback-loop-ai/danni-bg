import { describe, expect, it } from 'bun:test';
import type { FreshnessBlock } from '../types.ts';
import { bilingualLabel, freshnessDisplay, translationNote } from './format.ts';

describe('bilingualLabel', () => {
  it('returns bg verbatim and en with bg fallback', () => {
    expect(bilingualLabel('Бюджет', 'Budget', 'bg')).toBe('Бюджет');
    expect(bilingualLabel('Бюджет', 'Budget', 'en')).toBe('Budget');
    expect(bilingualLabel('Бюджет', null, 'en')).toBe('Бюджет');
  });
});

describe('translationNote', () => {
  it('flags only low-confidence English', () => {
    expect(translationNote(0.4, 'en')).toBe('машинен превод (ниска увереност)');
    expect(translationNote(0.9, 'en')).toBeNull();
    expect(translationNote(0.4, 'bg')).toBeNull();
    expect(translationNote(null, 'en')).toBeNull();
  });
});

describe('freshnessDisplay', () => {
  const base: FreshnessBlock = {
    lastSyncedAt: '2026-06-01T12:00:00Z',
    sourceLastModified: null,
    sourceEtagOrHash: null,
    isStale: false,
    freshnessSloSeconds: 86400,
  };
  it('renders fresh and stale variants with the date', () => {
    expect(freshnessDisplay(base)).toEqual({ label: 'актуално · 2026-06-01', isStale: false });
    expect(freshnessDisplay({ ...base, isStale: true })).toEqual({
      label: 'остаряло · последно 2026-06-01',
      isStale: true,
    });
  });
});
