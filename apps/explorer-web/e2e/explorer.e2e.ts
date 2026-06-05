// Playwright E2E smoke (US1 render glue, covers the WebGL map behaviorally per the constitution's
// render-glue exception). Named *.e2e.ts so `bun test` never runs it. Requires browsers + servers:
//   bunx playwright install chromium
//   bun run explorer:api   # backend on :8790 (with a populated mirror)
//   bun run --cwd apps/explorer-web e2e

import { expect, test } from '@playwright/test';

test('renders the three-panel explorer shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Филтри' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Чат' })).toBeVisible();
  await expect(page.getByLabel('Карта на България')).toBeVisible();
});

test('applies a tag filter as a removable chip', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Добави таг').fill('въздух');
  await page.getByRole('button', { name: 'Добави таг' }).click();
  await expect(page.getByText('таг: въздух')).toBeVisible();
  await page.getByRole('button', { name: 'Изчисти всички' }).click();
  await expect(page.getByText('таг: въздух')).toHaveCount(0);
});
