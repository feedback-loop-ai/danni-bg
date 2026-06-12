import { describe, expect, it } from 'bun:test';
import type { ResourceContent } from '../../../../src/read/resource-rows.ts';
import type { DatasetDetailView } from '../schemas.ts';
import {
  MAX_DETAIL_ENTITIES,
  MAX_DETAIL_LINKS,
  capDatasetDetail,
  capResourceContent,
} from './cap.ts';

const base: ResourceContent = {
  datasetId: 'd1',
  resourceId: 'r1',
  kind: 'tabular',
  curatedPath: 'd1/r1/data.ndjson',
  rows: [],
  total: 0,
  limit: 100,
  offset: 0,
  truncated: false,
};

describe('capResourceContent', () => {
  it('leaves small content untouched', () => {
    const c = { ...base, rows: [{ a: 1 }, { a: 2 }], total: 2 };
    expect(capResourceContent(c)).toEqual(c);
  });

  it('truncates an over-long text blob and flags it', () => {
    const c = { ...base, kind: 'text' as const, text: 'я'.repeat(100), total: 0 };
    const out = capResourceContent(c, 10);
    expect(out.text).toHaveLength(10);
    expect(out.truncated).toBe(true);
  });

  it('replaces an over-large document with a truncated preview', () => {
    const c = { ...base, kind: 'json' as const, document: { blob: 'x'.repeat(100) }, total: 1 };
    const out = capResourceContent(c, 20);
    expect(out.truncated).toBe(true);
    const doc = out.document as { truncated: boolean; preview: string };
    expect(doc.truncated).toBe(true);
    expect(doc.preview.length).toBeLessThanOrEqual(20);
  });

  it('caps rows by cumulative serialized size, keeping at least one', () => {
    const c = {
      ...base,
      rows: [{ v: 'a'.repeat(30) }, { v: 'b'.repeat(30) }, { v: 'c'.repeat(30) }],
      total: 3,
    };
    const out = capResourceContent(c, 40);
    expect(out.rows.length).toBeGreaterThanOrEqual(1);
    expect(out.rows.length).toBeLessThan(3);
    expect(out.truncated).toBe(true);
  });

  it('never drops the only row even if it exceeds the budget', () => {
    const c = { ...base, rows: [{ v: 'z'.repeat(500) }], total: 1 };
    const out = capResourceContent(c, 20);
    expect(out.rows).toHaveLength(1);
  });
});

const detail = (links: number, entities: number): DatasetDetailView => ({
  datasetId: 'd1',
  titleBg: 'Заглавие',
  titleEn: null,
  descriptionBg: 'Описание',
  descriptionEn: null,
  translationConfidence: null,
  publisher: null,
  tags: [],
  lifecycleState: 'active',
  withdrawnReason: null,
  freshness: {
    lastSyncedAt: '2026-06-01T00:00:00Z',
    sourceLastModified: null,
    sourceEtagOrHash: null,
    isStale: false,
    freshnessSloSeconds: 86400,
  },
  geoEntityIds: [],
  resources: [],
  entities: Array.from({ length: entities }, (_, i) => ({
    entityId: `e${i}`,
    kind: 'tag',
    labelBg: `етикет ${i}`,
    labelEn: null,
    confidence: i / Math.max(1, entities),
  })),
  links: Array.from({ length: links }, (_, i) => ({
    otherDatasetId: `o${i}`,
    viaEntityId: `e${i}`,
    confidence: i / Math.max(1, links),
  })),
  sourceUrl: 'https://data.egov.bg/d1',
});

describe('capDatasetDetail', () => {
  it('keeps small detail records intact', () => {
    const d = detail(3, 4);
    expect(capDatasetDetail(d)).toEqual(d);
  });

  it('caps links/entities to the highest-confidence head', () => {
    const out = capDatasetDetail(detail(14629, 200));
    expect(out.links).toHaveLength(MAX_DETAIL_LINKS);
    expect(out.entities).toHaveLength(MAX_DETAIL_ENTITIES);
    // Highest-confidence retained (the last-generated link has confidence closest to 1).
    expect(out.links[0]?.otherDatasetId).toBe('o14628');
    expect(out.links.every((l) => l.confidence >= (out.links.at(-1)?.confidence ?? 0))).toBe(true);
  });
});
