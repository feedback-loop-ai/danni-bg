import { describe, expect, it } from 'bun:test';
import { buildScopePredicate, summarizeScope } from '../../../src/crawler/scope.ts';

describe('crawler.scope', () => {
  it('empty filter matches everything', () => {
    const pred = buildScopePredicate({});
    expect(pred({ id: 'd1' })).toBe(true);
    expect(summarizeScope({})).toBe('all');
  });

  it('matches by publisher', () => {
    const pred = buildScopePredicate({ publishers: ['org-a'] });
    expect(pred({ id: 'd1', publisherId: 'org-a' })).toBe(true);
    expect(pred({ id: 'd2', publisherId: 'org-b' })).toBe(false);
  });

  it('matches by category', () => {
    const pred = buildScopePredicate({ categories: ['cat-1'] });
    expect(pred({ id: 'd1', groups: ['cat-1', 'cat-2'] })).toBe(true);
    expect(pred({ id: 'd2', groups: ['cat-x'] })).toBe(false);
  });

  it('matches by tag', () => {
    const pred = buildScopePredicate({ tags: ['t1'] });
    expect(pred({ id: 'd1', tags: ['t1'] })).toBe(true);
    expect(pred({ id: 'd2', tags: ['other'] })).toBe(false);
  });

  it('matches by explicit dataset id or slug', () => {
    const pred = buildScopePredicate({ datasetIds: ['d1', 'slug-2'] });
    expect(pred({ id: 'd1' })).toBe(true);
    expect(pred({ id: 'd2', slug: 'slug-2' })).toBe(true);
    expect(pred({ id: 'd3' })).toBe(false);
  });

  it('summarizeScope reports filter sizes', () => {
    const out = summarizeScope({
      publishers: ['a'],
      categories: ['b'],
      tags: ['c'],
      datasetIds: ['d'],
    });
    expect(out).toContain('publishers=1');
    expect(out).toContain('categories=1');
    expect(out).toContain('tags=1');
    expect(out).toContain('datasetIds=1');
  });
});
