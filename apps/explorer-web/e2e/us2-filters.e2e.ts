// US2 — advanced filters: adding a tag narrows the dataset list (logical AND over the mirror), shows
// a removable chip, and "clear all" restores the full view (FR-007/FR-012/FR-013).

import { expect, test } from '@playwright/test';
import { stubApi } from './fixtures.ts';

test('tag filter narrows results, shows a chip, and clears', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');

  // Both datasets visible initially.
  await expect(page.getByRole('button', { name: /Бюджет/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Качество на въздуха/ })).toBeVisible();

  // Apply a tag filter → only the air-quality dataset remains.
  await page.getByLabel('Добави таг').fill('въздух');
  await page.getByRole('button', { name: 'Добави таг' }).click();

  await expect(page.getByText('таг: въздух')).toBeVisible();
  await expect(page.getByRole('button', { name: /Качество на въздуха/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Бюджет/ })).toHaveCount(0);

  // Clear all → full list restored.
  await page.getByRole('button', { name: 'Изчисти всички' }).click();
  await expect(page.getByText('таг: въздух')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Бюджет/ })).toBeVisible();
});
