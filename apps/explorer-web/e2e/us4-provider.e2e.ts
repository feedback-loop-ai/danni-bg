// US4 — configure the provider: choosing a custom provider/model persists client-side across a
// reload (FR-024 — kept in localStorage, never server-side).

import { expect, test } from '@playwright/test';
import { stubApi } from './fixtures.ts';

test('provider config persists across a reload', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');

  await page.getByText('Настройки на доставчика').click();
  await page.getByLabel('Използвай сървърния доставчик по подразбиране').uncheck();
  await page.getByLabel('Модел').fill('gpt-4o');
  await page.getByLabel('API ключ').fill('sk-test');

  await page.reload();
  await page.getByText('Настройки на доставчика').click();
  await expect(page.getByLabel('Модел')).toHaveValue('gpt-4o');
});
