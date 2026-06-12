import { describe, expect, it } from 'bun:test';
import { cycleSort, hasActiveFilters } from './grid.ts';

describe('cycleSort', () => {
  it('cycles unsorted → asc → desc → unsorted, resetting on a new column', () => {
    expect(cycleSort(null, 'pm10')).toEqual({ col: 'pm10', dir: 'asc' });
    expect(cycleSort({ col: 'pm10', dir: 'asc' }, 'pm10')).toEqual({ col: 'pm10', dir: 'desc' });
    expect(cycleSort({ col: 'pm10', dir: 'desc' }, 'pm10')).toBeNull();
    expect(cycleSort({ col: 'pm10', dir: 'desc' }, 'станция')).toEqual({
      col: 'станция',
      dir: 'asc',
    });
  });
});

describe('hasActiveFilters', () => {
  it('detects any non-blank filter', () => {
    expect(hasActiveFilters({ a: '', b: '  ' })).toBe(false);
    expect(hasActiveFilters({ a: 'x' })).toBe(true);
    expect(hasActiveFilters({})).toBe(false);
  });
});
