import { describe, expect, it } from 'bun:test';
import type { CuratedDatasetView } from '../../../src/read/dataset-view.ts';
import {
  geoEntityIdsOf,
  matchesFreshness,
  maxGeoConfidence,
  viewToDetail,
  viewToPointer,
} from '../src/read-bridge.ts';

const freshness = {
  lastSyncedAt: '2026-06-01T00:00:00Z',
  sourceLastModified: null,
  sourceEtagOrHash: null,
  isStale: false,
  freshnessSloSeconds: 86400,
};

function makeView(over: Partial<CuratedDatasetView> = {}): CuratedDatasetView {
  return {
    datasetId: 'd1',
    slug: 'd1',
    sourceUrl: 'https://data.egov.bg/d1',
    publisher: { id: 'p1', slug: 'p1', title: { bg: 'Столична община' } },
    title: { bg: 'Бюджет', en: 'Budget', translator: 'mt', translationConfidence: 0.4 },
    description: { bg: 'Описание', en: null, translator: null, translationConfidence: null },
    tags: ['бюджет'],
    groups: [],
    license: null,
    lifecycleState: 'active',
    withdrawnReason: null,
    freshness,
    resources: [
      {
        resourceId: 'r1',
        sourceUrl: 'https://data.egov.bg/d1/r1',
        name: 'rows',
        kind: 'tabular',
        rawPath: null,
        curatedPath: 'd1/r1',
        declaredFormat: null,
        detectedFormat: null,
        schema: { columns: [] },
        transformRules: [],
        freshness,
      },
    ],
    entities: [
      {
        entityId: 'geo:bg-oblast-sofia-grad',
        kind: 'geographic_unit',
        label: { bg: 'София', en: 'Sofia' },
        extractor: 'gaz',
        confidence: 0.9,
      },
      {
        entityId: 'geo:bg-municipality-sofia',
        kind: 'geographic_unit',
        label: { bg: 'Столична община', en: null },
        extractor: 'gaz',
        confidence: 0.7,
      },
      {
        entityId: 'tag:бюджет',
        kind: 'tag',
        label: { bg: 'бюджет', en: null },
        extractor: 'tag',
        confidence: 1,
      },
    ],
    links: [
      {
        otherDatasetId: 'd2',
        viaEntityId: 'geo:bg-oblast-sofia-grad',
        heuristic: 'geo',
        confidence: 0.5,
      },
    ],
    ...over,
  };
}

describe('geo helpers', () => {
  it('extracts only geo: entity ids', () => {
    expect(geoEntityIdsOf(makeView())).toEqual([
      'geo:bg-oblast-sofia-grad',
      'geo:bg-municipality-sofia',
    ]);
  });

  it('takes the max geo confidence, 0 when no geo entities', () => {
    expect(maxGeoConfidence(makeView())).toBe(0.9);
    expect(maxGeoConfidence(makeView({ entities: [] }))).toBe(0);
  });
});

describe('viewToPointer', () => {
  it('projects a dataset pointer with passthrough Cyrillic + score', () => {
    const p = viewToPointer(makeView(), 0.42);
    expect(p).toEqual({
      datasetId: 'd1',
      titleBg: 'Бюджет',
      titleEn: 'Budget',
      translationConfidence: 0.4,
      publisher: { id: 'p1', titleBg: 'Столична община' },
      tags: ['бюджет'],
      freshness,
      geoEntityIds: ['geo:bg-oblast-sofia-grad', 'geo:bg-municipality-sofia'],
      sourceUrl: 'https://data.egov.bg/d1',
      score: 0.42,
    });
  });

  it('defaults score to null and handles a missing publisher', () => {
    const p = viewToPointer(makeView({ publisher: null }));
    expect(p.score).toBeNull();
    expect(p.publisher).toBeNull();
  });
});

describe('viewToDetail', () => {
  it('reshapes resources, entities and links', () => {
    const d = viewToDetail(makeView());
    expect(d.resources).toEqual([
      { resourceId: 'r1', name: 'rows', kind: 'tabular', schema: { columns: [] }, freshness },
    ]);
    expect(d.entities).toHaveLength(3);
    expect(d.links).toEqual([
      { otherDatasetId: 'd2', viaEntityId: 'geo:bg-oblast-sofia-grad', confidence: 0.5 },
    ]);
    expect(d.descriptionBg).toBe('Описание');
    expect(d.lifecycleState).toBe('active');
  });
});

describe('matchesFreshness', () => {
  it('any matches everything; fresh/stale gate on isStale', () => {
    expect(matchesFreshness(true, 'any')).toBe(true);
    expect(matchesFreshness(false, 'any')).toBe(true);
    expect(matchesFreshness(false, 'fresh')).toBe(true);
    expect(matchesFreshness(true, 'fresh')).toBe(false);
    expect(matchesFreshness(true, 'stale')).toBe(true);
    expect(matchesFreshness(false, 'stale')).toBe(false);
  });
});
