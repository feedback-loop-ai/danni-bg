import { describe, expect, it } from 'bun:test';
import {
  compareCells,
  cycleSort,
  filterRows,
  gridRows,
  hasActiveFilters,
  sortRows,
} from './grid.ts';

const rows = [
  { станция: 'Дружба', pm10: 42, note: 'ok' },
  { станция: 'Надежда', pm10: 31, note: '' },
  { станция: 'Павлово', pm10: 27, note: 'n/a' },
];

describe('compareCells', () => {
  it('compares numbers numerically, not lexically', () => {
    expect(compareCells(9, 100)).toBeLessThan(0);
    expect(compareCells('42', '7')).toBeGreaterThan(0);
  });
  it('orders text by Bulgarian locale and sends blanks last', () => {
    expect(compareCells('Дружба', 'Надежда')).toBeLessThan(0);
    expect(compareCells('', 'Дружба')).toBeGreaterThan(0);
    expect(compareCells('х', '')).toBeLessThan(0);
  });
});

describe('sortRows', () => {
  it('returns the input untouched when no sort', () => {
    expect(sortRows(rows, null)).toBe(rows);
  });
  it('sorts numeric ascending/descending', () => {
    expect(
      sortRows(rows, { col: 'pm10', dir: 'asc' }).map((r) => (r as { pm10: number }).pm10),
    ).toEqual([27, 31, 42]);
    expect(
      sortRows(rows, { col: 'pm10', dir: 'desc' }).map((r) => (r as { pm10: number }).pm10),
    ).toEqual([42, 31, 27]);
  });
  it('is stable for equal keys', () => {
    const eq = [
      { a: 1, id: 'x' },
      { a: 1, id: 'y' },
      { a: 1, id: 'z' },
    ];
    expect(sortRows(eq, { col: 'a', dir: 'asc' }).map((r) => (r as { id: string }).id)).toEqual([
      'x',
      'y',
      'z',
    ]);
  });
});

describe('filterRows', () => {
  it('substring-matches case-insensitively across active columns', () => {
    expect(filterRows(rows, { станция: 'дру' })).toHaveLength(1);
    expect(filterRows(rows, { note: 'a' }).map((r) => (r as { станция: string }).станция)).toEqual([
      'Павлово',
    ]);
  });
  it('ANDs multiple column filters and ignores blank ones', () => {
    // 'д' matches Дружба + Надежда; note 'n' narrows to none of those → AND empties it.
    expect(filterRows(rows, { станция: 'д', note: '' })).toHaveLength(2); // Дружба, Надежда
    expect(filterRows(rows, { станция: 'д', note: 'n' })).toHaveLength(0);
    expect(filterRows(rows, {})).toBe(rows);
  });
});

describe('gridRows', () => {
  it('filters then sorts', () => {
    // 'д' → Дружба(42) + Надежда(31); sorted pm10 desc.
    const out = gridRows(rows, { col: 'pm10', dir: 'desc' }, { станция: 'д' });
    expect(out.map((r) => (r as { станция: string }).станция)).toEqual(['Дружба', 'Надежда']);
  });
});

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
  });
});
