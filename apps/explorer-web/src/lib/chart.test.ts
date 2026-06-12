import { describe, expect, it } from 'bun:test';
import {
  dateColumns,
  isDateLike,
  isNumeric,
  numericColumns,
  orderByDate,
  polylinePoints,
  toSeries,
} from './chart.ts';

describe('isNumeric', () => {
  it('accepts finite numbers and numeric strings, rejects the rest', () => {
    expect(isNumeric(42)).toBe(true);
    expect(isNumeric('3.14')).toBe(true);
    expect(isNumeric('')).toBe(false);
    expect(isNumeric('abc')).toBe(false);
    expect(isNumeric(null)).toBe(false);
    expect(isNumeric(Number.NaN)).toBe(false);
  });
});

describe('numericColumns', () => {
  const rows = [
    { станция: 'Дружба', pm10: 42, note: 'ok' },
    { станция: 'Надежда', pm10: '31', note: '' },
    { станция: 'Павлово', pm10: 27, note: 'n/a' },
  ];
  it('detects mostly-numeric columns only', () => {
    expect(numericColumns(rows, ['станция', 'pm10', 'note'])).toEqual(['pm10']);
  });
  it('ignores columns with no present values', () => {
    expect(numericColumns([{ a: null }], ['a'])).toEqual([]);
  });
});

describe('toSeries', () => {
  const rows = [
    { станция: 'Дружба', pm10: 42 },
    { станция: 'Надежда', pm10: '31' },
    { станция: 'Павлово', pm10: 27 },
  ];
  it('projects label/value pairs and the max', () => {
    const s = toSeries(rows, 'станция', 'pm10');
    expect(s.points).toEqual([
      { label: 'Дружба', value: 42 },
      { label: 'Надежда', value: 31 },
      { label: 'Павлово', value: 27 },
    ]);
    expect(s.maxValue).toBe(42);
  });
  it('uses the row index as label when no label column, and caps length', () => {
    const s = toSeries(rows, null, 'pm10', 2);
    expect(s.points.map((p) => p.label)).toEqual(['1', '2']);
  });
  it('skips rows whose value is non-numeric (label is the included-point ordinal)', () => {
    expect(toSeries([{ v: 'x' }, { v: 5 }], null, 'v').points).toEqual([{ label: '1', value: 5 }]);
  });
});

describe('isDateLike / dateColumns', () => {
  it('recognises dates with separators, not plain numbers or words', () => {
    expect(isDateLike('2020-01-15')).toBe(true);
    expect(isDateLike('2020-03')).toBe(true);
    expect(isDateLike('2021-06-08T10:00:00Z')).toBe(true);
    expect(isDateLike('2020')).toBe(false);
    expect(isDateLike('42')).toBe(false);
    expect(isDateLike('София')).toBe(false);
  });
  it('finds date columns', () => {
    const rows = [
      { месец: '2020-01', брой: 5 },
      { месец: '2020-02', брой: 8 },
    ];
    expect(dateColumns(rows, ['месец', 'брой'])).toEqual(['месец']);
  });
});

describe('orderByDate', () => {
  it('sorts points chronologically by label', () => {
    const pts = [
      { label: '2020-03', value: 3 },
      { label: '2020-01', value: 1 },
      { label: '2020-02', value: 2 },
    ];
    expect(orderByDate(pts).map((p) => p.value)).toEqual([1, 2, 3]);
  });
});

describe('polylinePoints', () => {
  it('maps values to coordinates (0 at bottom)', () => {
    expect(polylinePoints([0, 5, 10], 100, 100, 10)).toBe('0.0,100.0 50.0,50.0 100.0,0.0');
  });
  it('centres a single point and handles empty/zero-max', () => {
    expect(polylinePoints([7], 100, 100, 10)).toBe('50.0,30.0');
    expect(polylinePoints([], 100, 100, 10)).toBe('');
    expect(polylinePoints([1, 2], 100, 100, 0)).toBe('');
  });
});
