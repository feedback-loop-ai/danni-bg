import { describe, expect, it } from 'bun:test';
import type { CuratedDatasetView } from '../../../src/read/dataset-view.ts';
import { buildAnchors, buildCitations } from '../src/chat/grounding.ts';
import { inScope, scopeToFilterState } from '../src/chat/scope.ts';
import { SessionStore } from '../src/chat/session.ts';

const freshness = {
  lastSyncedAt: '2026-06-01T00:00:00Z',
  sourceLastModified: null,
  sourceEtagOrHash: null,
  isStale: false,
  freshnessSloSeconds: 86400,
};

function view(id: string, over: Partial<CuratedDatasetView> = {}): CuratedDatasetView {
  return {
    datasetId: id,
    slug: id,
    sourceUrl: `https://data.egov.bg/${id}`,
    publisher: { id: 'p1', slug: 'p1', title: { bg: 'Изд' } },
    title: { bg: `Т-${id}`, en: null, translator: null, translationConfidence: null },
    description: { bg: '', en: null, translator: null, translationConfidence: null },
    tags: ['въздух'],
    groups: [],
    license: null,
    lifecycleState: 'active',
    withdrawnReason: null,
    freshness,
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

describe('chat scope', () => {
  it('empty descriptor = full scope', () => {
    expect(inScope(view('d1'), {})).toBe(true);
    expect(scopeToFilterState({}).freshness).toBe('any');
  });

  it('enforces hard filters but ignores the soft query', () => {
    expect(inScope(view('d1'), { geoUnitIds: ['geo:bg-oblast-ruse'] })).toBe(true);
    expect(inScope(view('d1'), { geoUnitIds: ['geo:bg-oblast-varna'] })).toBe(false);
    expect(inScope(view('d1'), { tags: ['въздух'], query: 'anything' })).toBe(true);
    expect(inScope(view('d1'), { publisherIds: ['other'] })).toBe(false);
  });
});

describe('buildCitations', () => {
  const store: Record<string, CuratedDatasetView> = { d1: view('d1'), d2: view('d2') };
  const resolve = (id: string) => store[id] ?? null;
  const within = () => true;

  it('keeps existing in-scope datasets, deduped', () => {
    const out = buildCitations(['d1', 'd1', 'd2'], resolve, within);
    expect(out.map((c) => c.datasetId)).toEqual(['d1', 'd2']);
    expect(out[0]).toEqual({
      datasetId: 'd1',
      titleBg: 'Т-d1',
      sourceUrl: 'https://data.egov.bg/d1',
      freshness,
    });
  });

  it('drops hallucinated (unresolvable) ids — SC-005', () => {
    expect(buildCitations(['ghost'], resolve, within)).toEqual([]);
  });

  it('drops out-of-scope ids — SC-008', () => {
    expect(buildCitations(['d1'], resolve, () => false)).toEqual([]);
  });
});

describe('buildAnchors', () => {
  it('aggregates cited datasets geo entities + ids', () => {
    const store: Record<string, CuratedDatasetView> = {
      d1: view('d1'),
      d2: view('d2', {
        entities: [
          {
            entityId: 'geo:bg-oblast-varna',
            kind: 'geographic_unit',
            label: { bg: 'Варна', en: null },
            extractor: 'g',
            confidence: 0.5,
          },
        ],
      }),
    };
    const resolve = (id: string) => store[id] ?? null;
    const cites = buildCitations(['d1', 'd2'], resolve, () => true);
    const anchors = buildAnchors(cites, resolve);
    expect(anchors.datasetIds).toEqual(['d1', 'd2']);
    expect(anchors.geoEntityIds.sort()).toEqual(['geo:bg-oblast-ruse', 'geo:bg-oblast-varna']);
  });

  it('skips anchors for an unresolvable citation', () => {
    const anchors = buildAnchors(
      [{ datasetId: 'gone', titleBg: '', sourceUrl: '', freshness }],
      () => null,
    );
    expect(anchors).toEqual({ geoEntityIds: [], datasetIds: ['gone'] });
  });
});

describe('SessionStore', () => {
  it('creates a session with a generated id and appends messages', () => {
    const store = new SessionStore(() => 'fixed-id');
    const conv = store.getOrCreate(null);
    expect(conv.sessionId).toBe('fixed-id');
    store.append('fixed-id', { role: 'user', content: 'hi' });
    expect(store.get('fixed-id')?.messages).toHaveLength(1);
  });

  it('returns the same conversation for a known id, new for unknown', () => {
    const store = new SessionStore(() => 'gen');
    const a = store.getOrCreate(null);
    expect(store.getOrCreate(a.sessionId)).toBe(a);
    const b = store.getOrCreate('unknown-id');
    expect(b.sessionId).toBe('unknown-id');
    expect(b.messages).toEqual([]);
  });

  it('append on a missing session is a no-op', () => {
    const store = new SessionStore(() => 'x');
    store.append('nope', { role: 'user', content: 'hi' });
    expect(store.get('nope')).toBeUndefined();
  });

  it('defaults to crypto.randomUUID when no id generator is given', () => {
    const conv = new SessionStore().getOrCreate(null);
    expect(conv.sessionId).toMatch(/[0-9a-f-]{36}/);
  });
});
