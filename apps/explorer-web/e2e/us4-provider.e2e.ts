// US4 — configure the provider: choosing a custom provider/model persists client-side across a
// reload (FR-024 — kept in localStorage, never server-side).

import { expect, test } from '@playwright/test';
import { stubApi, stubAuth } from './fixtures.ts';

test('provider config persists across a reload', async ({ page }) => {
  await stubApi(page);
  await stubAuth(page, { id: 'u1', email: 'user@example.com', role: 'user' }); // chat panel is gated (spec 019)
  await page.goto('/');

  await page.getByRole('button', { name: 'Настройки на доставчика' }).click();
  await page.getByLabel('Използвай сървърния доставчик по подразбиране').uncheck();
  await page.getByLabel('Модел').fill('gpt-4o');
  await page.getByLabel('API ключ').fill('sk-test');

  await page.reload();
  await page.getByRole('button', { name: 'Настройки на доставчика' }).click();
  await expect(page.getByLabel('Модел')).toHaveValue('gpt-4o');
});
