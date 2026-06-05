// Shared E2E helpers: deterministic stubs for the explorer API so the SPA flows are testable headless
// without a live mirror or LLM. Not a *.test.ts/*.spec.ts file, so `bun test` never runs it; only the
// Playwright specs import it. Map render uses WebGL which may be unavailable headless — specs assert
// DOM/data flows (filters, lists, chat, citations) rather than GPU paint (the render-glue exception).

import type { Page } from '@playwright/test';

const FRESH = {
  lastSyncedAt: '2026-06-01T00:00:00Z',
  sourceLastModified: null,
  sourceEtagOrHash: null,
  isStale: false,
  freshnessSloSeconds: 86400,
};

const D1 = {
  datasetId: 'd1',
  titleBg: 'Качество на въздуха',
  titleEn: 'Air quality',
  translationConfidence: 0.9,
  publisher: { id: 'p1', titleBg: 'Столична община' },
  tags: ['въздух'],
  freshness: FRESH,
  geoEntityIds: ['geo:bg-oblast-sofia-grad'],
  sourceUrl: 'https://data.egov.bg/d1',
  score: null,
};
const D2 = {
  datasetId: 'd2',
  titleBg: 'Бюджет',
  titleEn: 'Budget',
  translationConfidence: null,
  publisher: { id: 'p1', titleBg: 'Столична община' },
  tags: ['бюджет'],
  freshness: FRESH,
  geoEntityIds: ['geo:bg-oblast-sofia-grad'],
  sourceUrl: 'https://data.egov.bg/d2',
  score: null,
};

const REGIONS = {
  regions: [
    {
      entityId: 'geo:bg-oblast-sofia-grad',
      level: 'oblast',
      labelBg: 'София (град)',
      labelEn: 'Sofia (city)',
      boundaryFeatureId: 'BG-22',
      datasetCount: 2,
      hasData: true,
      maxConfidence: 0.9,
    },
    {
      entityId: 'geo:bg-oblast-ruse',
      level: 'oblast',
      labelBg: 'Русе',
      labelEn: 'Ruse',
      boundaryFeatureId: 'BG-18',
      datasetCount: 0,
      hasData: false,
      maxConfidence: 0,
    },
  ],
};

const DETAIL_D1 = {
  datasetId: 'd1',
  titleBg: 'Качество на въздуха',
  titleEn: 'Air quality',
  descriptionBg: 'Данни за качеството на атмосферния въздух.',
  descriptionEn: null,
  translationConfidence: 0.9,
  publisher: { id: 'p1', titleBg: 'Столична община' },
  tags: ['въздух'],
  lifecycleState: 'active',
  withdrawnReason: null,
  freshness: FRESH,
  geoEntityIds: ['geo:bg-oblast-sofia-grad'],
  resources: [
    { resourceId: 'r1', name: 'измервания', kind: 'tabular', schema: {}, freshness: FRESH },
  ],
  entities: [],
  links: [],
  sourceUrl: 'https://data.egov.bg/d1',
};

const CHAT_SSE = [
  ['session', { sessionId: 's1' }],
  ['tool', { name: 'mirrorSearch', status: 'start' }],
  ['tool', { name: 'mirrorSearch', status: 'done' }],
  ['token', { delta: 'Качеството на въздуха ' }],
  ['token', { delta: 'се публикува от Столична община.' }],
  [
    'citations',
    {
      citations: [
        {
          datasetId: 'd1',
          titleBg: 'Качество на въздуха',
          sourceUrl: 'https://data.egov.bg/d1',
          freshness: FRESH,
        },
      ],
    },
  ],
  ['anchors', { geoEntityIds: ['geo:bg-oblast-sofia-grad'], datasetIds: ['d1'] }],
  ['done', {}],
]
  .map(([event, data]) => `event: ${event as string}\ndata: ${JSON.stringify(data)}\n\n`)
  .join('');

export interface ApiStub {
  chatRequests: string[];
}

/** Install deterministic /api stubs on the page. Returns a handle capturing chat request bodies. */
export async function stubApi(page: Page): Promise<ApiStub> {
  const stub: ApiStub = { chatRequests: [] };

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/regions') return json(REGIONS);
    if (path === '/api/facets')
      return json({
        tags: [{ id: 'въздух', labelBg: 'въздух', count: 1 }],
        publishers: [],
        freshnessBuckets: [],
      });

    if (path === '/api/datasets') {
      const tags = url.searchParams.getAll('tags');
      const q = url.searchParams.get('q');
      let datasets = [D1, D2];
      if (tags.includes('въздух') || q?.includes('въздух')) datasets = [D1];
      return json({ datasets, total: datasets.length, limit: 50, offset: 0 });
    }
    if (path === '/api/national') {
      const dn = {
        ...D2,
        datasetId: 'dn1',
        titleBg: 'Национален регистър',
        tags: [],
        geoEntityIds: [],
      };
      return json({ datasets: [dn], total: 1, limit: 50, offset: 0 });
    }
    if (/^\/api\/datasets\/[^/]+$/.test(path)) return json(DETAIL_D1);

    if (path === '/api/chat') {
      stub.chatRequests.push(route.request().postData() ?? '');
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: CHAT_SSE });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });

  return stub;
}
