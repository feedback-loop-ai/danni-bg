// Time-series resource → the drilldown auto-renders a line chart (date x-axis), and the user can
// switch bar/line.

import { expect, test } from '@playwright/test';

const FRESH = {
  lastSyncedAt: '2026-06-01T00:00:00Z',
  sourceLastModified: null,
  sourceEtagOrHash: null,
  isStale: false,
  freshnessSloSeconds: 86400,
};

test('renders a line chart for a date column', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (b: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
    if (path === '/api/regions') return json({ regions: [] });
    if (path === '/api/datasets')
      return json({
        datasets: [
          {
            datasetId: 'd1',
            titleBg: 'Месечни измервания',
            titleEn: null,
            translationConfidence: null,
            publisher: { id: 'p1', titleBg: 'ИАОС' },
            tags: [],
            freshness: FRESH,
            geoEntityIds: [],
            sourceUrl: 'https://data.egov.bg/d1',
            score: null,
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      });
    if (/\/resources\/[^/]+\/rows$/.test(path))
      return json({
        datasetId: 'd1',
        resourceId: 'r1',
        kind: 'tabular',
        rows: [
          { месец: '2020-01', брой: 12 },
          { месец: '2020-02', брой: 19 },
          { месец: '2020-03', брой: 7 },
        ],
        total: 3,
        limit: 50,
        offset: 0,
        truncated: false,
      });
    if (/^\/api\/datasets\/[^/]+$/.test(path))
      return json({
        datasetId: 'd1',
        titleBg: 'Месечни измервания',
        titleEn: null,
        descriptionBg: 'По месеци.',
        descriptionEn: null,
        translationConfidence: null,
        publisher: { id: 'p1', titleBg: 'ИАОС' },
        tags: [],
        lifecycleState: 'active',
        withdrawnReason: null,
        freshness: FRESH,
        geoEntityIds: [],
        resources: [
          { resourceId: 'r1', name: 'по месеци', kind: 'tabular', schema: {}, freshness: FRESH },
        ],
        entities: [],
        links: [],
        sourceUrl: 'https://data.egov.bg/d1',
      });
    return route.fulfill({ status: 404, body: '{}' });
  });

  await page.goto('/');
  await page.getByRole('button', { name: /Месечни измервания/ }).click();
  await page.getByRole('button', { name: /по месеци/ }).click();
  await page.getByRole('button', { name: 'Графика' }).click();

  // A date x-axis defaults to the line chart.
  await expect(page.getByLabel('Линейна графика')).toBeVisible();
  await expect(page.getByText('макс: 19')).toBeVisible();

  // Can switch to bars.
  await page.getByRole('button', { name: 'Стълбове' }).click();
  await expect(page.getByLabel('Графика').getByText('2020-02')).toBeVisible();
});
