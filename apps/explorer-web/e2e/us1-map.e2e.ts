// US1 — explore public data: the three-panel shell renders, the region/dataset data loads, and a
// dataset row opens its detail with a one-hop source link (FR-004/FR-005). Map paint is WebGL
// render-glue (validated only as "container present" headless).

import { expect, test } from '@playwright/test';
import { stubApi } from './fixtures.ts';

test('renders the shell, dataset list, and dataset detail with a source link', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Филтри' })).toBeVisible();
  // Chat panel rendered (gated for the anonymous visitor behind the sign-in prompt).
  await expect(page.getByText(/използвате чата/)).toBeVisible();
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

test('national grouping surfaces non-georeferenced datasets (FR-006)', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Национални набори (без регион)' }).click();
  await expect(page.getByRole('button', { name: /Национален регистър/ })).toBeVisible();
});

test('clicking an oblast drills into it (municipality view + back)', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await page
    .locator('svg[aria-label="Карта на отворените данни по области"] path[role="button"]')
    .first()
    .click();
  // Drilling into an oblast zooms in and offers a way back to the country view.
  await expect(page.getByRole('button', { name: /Назад към областите/ })).toBeVisible();
  await page.getByRole('button', { name: /Назад към областите/ }).click();
  await expect(page.getByRole('button', { name: /Назад към областите/ })).toHaveCount(0);
});
