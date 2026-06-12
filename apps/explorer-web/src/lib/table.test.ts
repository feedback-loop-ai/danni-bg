import { describe, expect, it } from 'bun:test';
import { cellText, tableColumns, toCsv } from './table.ts';

describe('tableColumns', () => {
  it('unions keys across rows in first-seen order', () => {
    expect(
      tableColumns([
        { a: 1, b: 2 },
        { b: 3, c: 4 },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });
  it('caps the column count', () => {
    expect(tableColumns([{ a: 1, b: 2, c: 3 }], 2)).toEqual(['a', 'b']);
  });
  it('ignores non-object rows', () => {
    expect(tableColumns([1, 'x', null, { a: 1 }])).toEqual(['a']);
  });
});

describe('cellText', () => {
  it('formats primitives, nullish and objects', () => {
    expect(cellText('гр. София')).toBe('гр. София');
    expect(cellText(42)).toBe('42');
    expect(cellText(null)).toBe('');
    expect(cellText(undefined)).toBe('');
    expect(cellText({ x: 1 })).toBe('{"x":1}');
  });
});

describe('toCsv', () => {
  it('writes a header + rows and quotes special chars', () => {
    const csv = toCsv(
      [
        { name: 'Иван, Петров', n: 3 },
        { name: 'line\nbreak', n: 1 },
      ],
      ['name', 'n'],
    );
    expect(csv).toBe('name,n\n"Иван, Петров",3\n"line\nbreak",1');
  });
  it('leaves missing cells empty', () => {
    expect(toCsv([{ a: 1 }], ['a', 'b'])).toBe('a,b\n1,');
  });
});
