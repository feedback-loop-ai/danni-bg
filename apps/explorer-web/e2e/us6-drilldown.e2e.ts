// Data drilldown: opening a dataset and clicking a resource previews its curated rows as a table
// (FR-005) — you can actually read the data, not just its metadata. Columns are sortable on click and
// each carries an Excel-style per-column filter.

import { expect, test } from '@playwright/test';
import { stubApi } from './fixtures.ts';

test('previews resource rows as a table with sortable, filterable columns', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');

  await page.getByRole('button', { name: /Качество на въздуха/ }).click();
  await page.getByRole('button', { name: /измервания/ }).click();

  // Column header + cell values from the stubbed rows.
  await expect(page.getByRole('columnheader', { name: 'станция' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Дружба' })).toBeVisible();
  await expect(page.getByText('2 от 2 реда')).toBeVisible();

  // Each column exposes a filter affordance (funnel) that opens a popover.
  await page.getByRole('button', { name: 'Филтрирай станция' }).click();
  await expect(page.getByLabel('Стойност за филтър станция')).toBeVisible();
});
