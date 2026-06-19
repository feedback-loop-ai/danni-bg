// US5 — linked map ↔ chat: active filters scope the chat request (FR-025), and clicking a cited
// dataset opens its detail (FR-027).

import { expect, test } from '@playwright/test';
import { stubApi, stubAuth } from './fixtures.ts';

test('active filters are sent as chat scope and citations open dataset detail', async ({
  page,
}) => {
  const stub = await stubApi(page);
  await stubAuth(page, { id: 'u1', email: 'user@example.com', role: 'user' }); // chat is gated (spec 019)
  await page.goto('/');

  // Apply a filter from the tag facet, then ask a question.
  await page.getByRole('checkbox', { name: /въздух/ }).check();
  await page.getByLabel('Въпрос').fill('Какво има за въздуха?');
  await page.getByRole('button', { name: 'Изпрати' }).click();

  await expect(page.getByText(/се публикува от Столична община/)).toBeVisible();

  // The chat request carried the active filter scope (FR-025).
  expect(stub.chatRequests).toHaveLength(1);
  const body = JSON.parse(stub.chatRequests[0] ?? '{}') as { scope?: { tags?: string[] } };
  expect(body.scope?.tags).toEqual(['въздух']);

  // Clicking the cited dataset (in the chat citation list) opens its detail (FR-027).
  await page.locator('.citation').getByRole('button', { name: 'Качество на въздуха' }).click();
  await expect(page.getByText('Данни за качеството на атмосферния въздух.')).toBeVisible();
});
