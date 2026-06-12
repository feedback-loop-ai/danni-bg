import { describe, expect, it } from 'bun:test';
import {
  type DatasetLite,
  hasGeo,
  liteConfidenceFor,
  liteToPointer,
  matchesFiltersLite,
} from './dataset-lite.ts';
import type { FilterState } from './schemas.ts';

const lite = (over: Partial<DatasetLite> = {}): DatasetLite => ({
  datasetId: 'd1',
  titleBg: 'Заглавие',
  titleEn: 'Title',
  translationConfidence: 0.9,
  publisherId: 'p1',
  publisherTitleBg: 'Издател',
  tags: ['околна среда'],
  lifecycleState: 'active',
  sourceUrl: 'https://data.egov.bg/d1',
  freshness: {
    lastSyncedAt: '2026-06-01T00:00:00Z',
    sourceLastModified: null,
    sourceEtagOrHash: null,
    isStale: false,
    freshnessSloSeconds: 86400,
  },
  geoLinks: [{ entityId: 'geo:oblast:BG-23', confidence: 0.8 }],
  ...over,
});

const filter = (over: Partial<FilterState> = {}): FilterState => ({
  tags: [],
  publisherIds: [],
  geoUnitIds: [],
  freshness: 'any',
  query: '',
  includeWithdrawn: false,
  ...over,
});

describe('liteToPointer', () => {
  it('projects pointer fields and geo ids, defaulting score to null', () => {
    const p = liteToPointer(lite());
    expect(p).toEqual({
      datasetId: 'd1',
      titleBg: 'Заглавие',
      titleEn: 'Title',
      translationConfidence: 0.9,
      publisher: { id: 'p1', titleBg: 'Издател' },
      tags: ['околна среда'],
      freshness: lite().freshness,
      geoEntityIds: ['geo:oblast:BG-23'],
      sourceUrl: 'https://data.egov.bg/d1',
      score: null,
    });
  });

  it('emits null publisher when unpublished and carries a passed score', () => {
    const p = liteToPointer(lite({ publisherId: null, publisherTitleBg: null }), 0.42);
    expect(p.publisher).toBeNull();
    expect(p.score).toBe(0.42);
  });
});

describe('matchesFiltersLite', () => {
  it('passes an active fresh dataset under the empty filter', () => {
    expect(matchesFiltersLite(lite(), filter())).toBe(true);
  });

  it('excludes withdrawn unless includeWithdrawn', () => {
    const w = lite({ lifecycleState: 'withdrawn' });
    expect(matchesFiltersLite(w, filter())).toBe(false);
    expect(matchesFiltersLite(w, filter({ includeWithdrawn: true }))).toBe(true);
  });

  it('applies freshness, tag, publisher and geo filters', () => {
    expect(matchesFiltersLite(lite(), filter({ freshness: 'stale' }))).toBe(false);
    expect(matchesFiltersLite(lite(), filter({ tags: ['транспорт'] }))).toBe(false);
    expect(matchesFiltersLite(lite(), filter({ tags: ['околна среда'] }))).toBe(true);
    expect(matchesFiltersLite(lite(), filter({ publisherIds: ['other'] }))).toBe(false);
    expect(matchesFiltersLite(lite(), filter({ geoUnitIds: ['geo:oblast:BG-23'] }))).toBe(true);
    expect(matchesFiltersLite(lite(), filter({ geoUnitIds: ['geo:oblast:BG-01'] }))).toBe(false);
  });

  it('rejects a publisher filter when the dataset is unpublished', () => {
    const u = lite({ publisherId: null });
    expect(matchesFiltersLite(u, filter({ publisherIds: ['p1'] }))).toBe(false);
  });
});

describe('liteConfidenceFor / hasGeo', () => {
  it('returns the max confidence for the entity, 0 when absent', () => {
    const l = lite({
      geoLinks: [
        { entityId: 'geo:oblast:BG-23', confidence: 0.6 },
        { entityId: 'geo:oblast:BG-23', confidence: 0.9 },
      ],
    });
    expect(liteConfidenceFor(l, 'geo:oblast:BG-23')).toBe(0.9);
    expect(liteConfidenceFor(l, 'geo:oblast:BG-01')).toBe(0);
  });

  it('detects whether any geo link is present', () => {
    expect(hasGeo(lite())).toBe(true);
    expect(hasGeo(lite({ geoLinks: [] }))).toBe(false);
  });
});
