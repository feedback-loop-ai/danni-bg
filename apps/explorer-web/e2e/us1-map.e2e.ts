// US1 — explore public data: the three-panel shell renders, the region/dataset data loads, and a
// dataset row opens its detail with a one-hop source link (FR-004/FR-005). Map paint is WebGL
// render-glue (validated only as "container present" headless).

import { expect, test } from '@playwright/test';
import { stubApi } from './fixtures.ts';

test('renders the shell, dataset list, and dataset detail with a source link', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Филтри' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Чат' })).toBeVisible();
  await expect(page.getByLabel('Карта на България')).toBeAttached();

  // Dataset list loaded from the (stubbed) mirror.
  await expect(page.getByRole('button', { name: /Качество на въздуха/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Бюджет/ })).toBeVisible();

  // Open detail → description + one-hop source link.
  await page.getByRole('button', { name: /Качество на въздуха/ }).click();
  await expect(page.getByText('Данни за качеството на атмосферния въздух.')).toBeVisible();
  const source = page.getByRole('link', { name: /data.egov.bg/ });
  await expect(source).toHaveAttribute('href', 'https://data.egov.bg/d1');
});
