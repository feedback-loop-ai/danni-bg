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
    if (/^\/api\/datasets\/[^/]+\/resources\/[^/]+\/rows$/.test(path)) {
      return json({
        datasetId: 'd1',
        resourceId: 'r1',
        kind: 'tabular',
        rows: [
          { станция: 'Дружба', pm10: 42 },
          { станция: 'Надежда', pm10: 31 },
        ],
        total: 2,
        limit: 50,
        offset: 0,
        truncated: false,
      });
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

// --- Auth stubs (spec 019) ----------------------------------------------------------------------
// Hermetic: stub Kratos `whoami` + the backend `/api/auth/callback` to simulate auth states, instead
// of running a live Ory stack. Register AFTER stubApi so the specific routes win (Playwright: the
// last-added matching handler is used).

export interface E2EUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

export async function stubAuth(page: Page, user?: E2EUser): Promise<void> {
  await page.route('**/kratos/sessions/whoami', (route) =>
    user
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'sess-1',
            active: true,
            identity: { id: user.id, traits: { email: user.email } },
          }),
        })
      : route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { id: 'session_inactive' } }),
        }),
  );
  await page.route('**/api/auth/callback', (route) =>
    user
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            user: { id: user.id, email: user.email, displayName: null, role: user.role },
            isAdmin: user.role === 'admin',
          }),
        })
      : route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
}

const LOGIN_FLOW = {
  id: 'login-flow-1',
  type: 'browser',
  ui: {
    action: 'http://localhost:5173/kratos/self-service/login?flow=login-flow-1',
    method: 'POST',
    nodes: [
      {
        type: 'input',
        group: 'default',
        attributes: { name: 'csrf_token', type: 'hidden', value: 'csrf', disabled: false },
        messages: [],
        meta: {},
      },
      {
        type: 'input',
        group: 'password',
        attributes: {
          name: 'identifier',
          type: 'email',
          value: '',
          required: true,
          disabled: false,
        },
        messages: [],
        meta: { label: { id: 1, text: 'Имейл', type: 'info' } },
      },
      {
        type: 'input',
        group: 'password',
        attributes: { name: 'password', type: 'password', required: true, disabled: false },
        messages: [],
        meta: { label: { id: 2, text: 'Парола', type: 'info' } },
      },
      {
        type: 'input',
        group: 'password',
        attributes: { name: 'method', type: 'submit', value: 'password', disabled: false },
        messages: [],
        meta: { label: { id: 3, text: 'Вход', type: 'info' } },
      },
    ],
  },
};

/** Stub the Kratos login self-service flow (create/get → flow JSON; POST update → success). */
export async function stubLoginFlow(page: Page): Promise<void> {
  await page.route('**/kratos/self-service/login**', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session: { id: 'sess-1', active: true } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(LOGIN_FLOW),
    });
  });
}

/** Stub the admin settings API. Returns a handle capturing PUT bodies. Register AFTER stubApi. */
export async function stubAdminSettings(page: Page): Promise<{ puts: string[] }> {
  const handle = { puts: [] as string[] };
  const current = {
    llm: {
      kind: 'openai-compatible',
      model: 'deepseek-v4-pro',
      baseUrl: 'https://api.deepseek.com',
      apiKeyMasked: true,
      apiKeyHint: '••••c7f',
    },
    toggles: { chatEnabled: true },
    source: 'settings',
  };
  await page.route('**/api/admin/settings', (route) => {
    if (route.request().method() === 'PUT') handle.puts.push(route.request().postData() ?? '');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(current),
    });
  });
  return handle;
}

function recoveryNode(name: string, type: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'input',
    group: 'code',
    attributes: { name, type, disabled: false, ...extra },
    messages: [],
    meta: {},
  };
}

/** Stub the Kratos recovery flow: create (email step) → submit returns the code-entry step. */
export async function stubRecovery(page: Page): Promise<void> {
  const emailStep = {
    id: 'rec-1',
    type: 'browser',
    ui: {
      action: 'http://localhost:5173/kratos/self-service/recovery?flow=rec-1',
      method: 'POST',
      nodes: [
        recoveryNode('csrf_token', 'hidden', { value: 'csrf' }),
        recoveryNode('email', 'email', { required: true }),
        recoveryNode('method', 'submit', { value: 'code' }),
      ],
    },
  };
  const codeStep = {
    ...emailStep,
    ui: {
      ...emailStep.ui,
      messages: [{ id: 1, text: 'A recovery code has been sent', type: 'info' }],
      nodes: [
        recoveryNode('csrf_token', 'hidden', { value: 'csrf' }),
        recoveryNode('code', 'text', { required: true }),
        recoveryNode('method', 'submit', { value: 'code' }),
      ],
    },
  };
  await page.route('**/kratos/self-service/recovery/browser', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(emailStep),
    }),
  );
  await page.route(/\/kratos\/self-service\/recovery\?/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(codeStep) }),
  );
}

/** Stub the Kratos logout flow (create → token; submit → 204). */
export async function stubLogout(page: Page): Promise<void> {
  await page.route('**/kratos/self-service/logout/browser', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        logout_url: 'http://localhost:5173/kratos/self-service/logout?token=tok',
        logout_token: 'tok',
      }),
    }),
  );
  // The token submit (GET /self-service/logout?token=...) → cleared.
  await page.route(/\/kratos\/self-service\/logout\?/, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
}
