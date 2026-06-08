// Data drilldown: opening a dataset and clicking a resource previews its curated rows as a table
// (FR-005) — you can actually read the data, not just its metadata.

import { expect, test } from '@playwright/test';
import { stubApi } from './fixtures.ts';

test('previews resource rows as a table', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');

  await page.getByRole('button', { name: /Качество на въздуха/ }).click();
  await page.getByRole('button', { name: /измервания/ }).click();

  // Column header + cell values from the stubbed rows.
  await expect(page.getByRole('columnheader', { name: 'станция' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Дружба' })).toBeVisible();
  await expect(page.getByText('2 от 2 реда')).toBeVisible();

  // Switch to the chart view: a bar chart over the numeric column.
  await page.getByRole('button', { name: 'Графика' }).click();
  const chart = page.getByLabel('Графика');
  await expect(chart).toBeVisible();
  await expect(chart.getByText('Дружба')).toBeVisible();
  await expect(chart.getByText('42')).toBeVisible();
});
