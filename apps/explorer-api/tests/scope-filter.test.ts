import { describe, expect, it } from 'bun:test';
import type { CuratedDatasetView } from '../../../src/read/dataset-view.ts';
import { filterStateSchema } from '../src/schemas.ts';
import { filterViews, matchesFilters } from '../src/scope-filter.ts';

const fresh = {
  lastSyncedAt: '2026-06-01T00:00:00Z',
  sourceLastModified: null,
  sourceEtagOrHash: null,
  isStale: false,
  freshnessSloSeconds: 86400,
};

function view(over: Partial<CuratedDatasetView>): CuratedDatasetView {
  return {
    datasetId: 'd',
    slug: 'd',
    sourceUrl: 'u',
    publisher: { id: 'p1', slug: 'p1', title: { bg: 'Изд' } },
    title: { bg: 'Т', en: null, translator: null, translationConfidence: null },
    description: { bg: '', en: null, translator: null, translationConfidence: null },
    tags: ['въздух'],
    groups: [],
    license: null,
    lifecycleState: 'active',
    withdrawnReason: null,
    freshness: fresh,
    resources: [],
    entities: [
      {
        entityId: 'geo:bg-oblast-ruse',
        kind: 'geographic_unit',
        label: { bg: 'Русе', en: null },
        extractor: 'g',
        confidence: 0.8,
      },
    ],
    links: [],
    ...over,
  };
}

const F = (over: Partial<Parameters<typeof filterStateSchema.parse>[0]> = {}) =>
  filterStateSchema.parse(over);

describe('matchesFilters', () => {
  it('passes an unfiltered dataset', () => {
    expect(matchesFilters(view({}), F())).toBe(true);
  });

  it('excludes withdrawn unless includeWithdrawn', () => {
    const w = view({ lifecycleState: 'withdrawn' });
    expect(matchesFilters(w, F())).toBe(false);
    expect(matchesFilters(w, F({ includeWithdrawn: true }))).toBe(true);
  });

  it('gates on freshness', () => {
    const stale = view({ freshness: { ...fresh, isStale: true } });
    expect(matchesFilters(stale, F({ freshness: 'fresh' }))).toBe(false);
    expect(matchesFilters(stale, F({ freshness: 'stale' }))).toBe(true);
  });

  it('ANDs tags, publisher and geo filters', () => {
    expect(matchesFilters(view({}), F({ tags: ['въздух'] }))).toBe(true);
    expect(matchesFilters(view({}), F({ tags: ['вода'] }))).toBe(false);
    expect(matchesFilters(view({}), F({ publisherIds: ['p1'] }))).toBe(true);
    expect(matchesFilters(view({}), F({ publisherIds: ['p2'] }))).toBe(false);
    expect(matchesFilters(view({ publisher: null }), F({ publisherIds: ['p1'] }))).toBe(false);
    expect(matchesFilters(view({}), F({ geoUnitIds: ['geo:bg-oblast-ruse'] }))).toBe(true);
    expect(matchesFilters(view({}), F({ geoUnitIds: ['geo:bg-oblast-varna'] }))).toBe(false);
  });
});

describe('filterViews', () => {
  it('returns only matching views', () => {
    const out = filterViews(
      [view({ datasetId: 'a' }), view({ datasetId: 'b', tags: [] })],
      F({ tags: ['въздух'] }),
    );
    expect(out.map((v) => v.datasetId)).toEqual(['a']);
  });
});
