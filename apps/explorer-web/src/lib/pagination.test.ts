import { describe, expect, it } from 'bun:test';
import { hasMore, mergePage } from './pagination.ts';

describe('hasMore', () => {
  it('is true only while fewer than total are loaded', () => {
    expect(hasMore(50, 120)).toBe(true);
    expect(hasMore(120, 120)).toBe(false);
    expect(hasMore(0, 0)).toBe(false);
  });
});

describe('mergePage', () => {
  it('appends new rows and drops duplicates by datasetId', () => {
    const a = [{ datasetId: 'd1' }, { datasetId: 'd2' }];
    const b = [{ datasetId: 'd2' }, { datasetId: 'd3' }];
    expect(mergePage(a, b).map((d) => d.datasetId)).toEqual(['d1', 'd2', 'd3']);
  });

  it('returns the existing list when the page is empty', () => {
    const a = [{ datasetId: 'd1' }];
    expect(mergePage(a, [])).toEqual(a);
  });
});
