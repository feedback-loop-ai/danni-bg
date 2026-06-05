import { describe, expect, it } from 'bun:test';
import { EMPTY_FILTERS, type FilterState } from '../types.ts';
import { clearAll, removeChip, setFreshness, toChips, toggleValue } from './filters.ts';

const F = (over: Partial<FilterState> = {}): FilterState => ({ ...EMPTY_FILTERS, ...over });

describe('toChips', () => {
  it('produces one chip per active filter', () => {
    const chips = toChips(
      F({
        tags: ['въздух'],
        publisherIds: ['p1'],
        geoUnitIds: ['g1'],
        freshness: 'stale',
        query: 'q',
        includeWithdrawn: true,
      }),
    );
    expect(chips.map((c) => c.kind)).toEqual([
      'tag',
      'publisher',
      'geo',
      'freshness',
      'query',
      'withdrawn',
    ]);
  });

  it('no chips for the empty state', () => {
    expect(toChips(F())).toEqual([]);
  });
});

describe('removeChip', () => {
  it('removes each chip kind', () => {
    expect(
      removeChip(F({ tags: ['a', 'b'] }), { kind: 'tag', value: 'a', label: '' }).tags,
    ).toEqual(['b']);
    expect(
      removeChip(F({ publisherIds: ['p'] }), { kind: 'publisher', value: 'p', label: '' })
        .publisherIds,
    ).toEqual([]);
    expect(
      removeChip(F({ geoUnitIds: ['g'] }), { kind: 'geo', value: 'g', label: '' }).geoUnitIds,
    ).toEqual([]);
    expect(
      removeChip(F({ freshness: 'fresh' }), { kind: 'freshness', value: 'fresh', label: '' })
        .freshness,
    ).toBe('any');
    expect(removeChip(F({ query: 'q' }), { kind: 'query', value: 'q', label: '' }).query).toBe('');
    expect(
      removeChip(F({ includeWithdrawn: true }), { kind: 'withdrawn', value: 'true', label: '' })
        .includeWithdrawn,
    ).toBe(false);
  });
});

describe('toggleValue', () => {
  it('adds then removes a value', () => {
    const a = toggleValue(F(), 'tags', 'x');
    expect(a.tags).toEqual(['x']);
    expect(toggleValue(a, 'tags', 'x').tags).toEqual([]);
  });
});

describe('setFreshness / clearAll', () => {
  it('sets freshness and clears everything', () => {
    expect(setFreshness(F(), 'stale').freshness).toBe('stale');
    expect(clearAll()).toEqual(EMPTY_FILTERS);
  });
});
