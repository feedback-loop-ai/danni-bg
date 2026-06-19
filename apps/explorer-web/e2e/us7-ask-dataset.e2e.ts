// "Ask about this dataset": from a dataset's detail, focus the chat on it — a context chip appears,
// the question is prefilled, and the chat request scope carries datasetIds = [that dataset] (FR-025).

import { expect, test } from '@playwright/test';
import { stubApi, stubAuth } from './fixtures.ts';

test('focuses the chat on a dataset and sends it as datasetIds scope', async ({ page }) => {
  const stub = await stubApi(page);
  await stubAuth(page, { id: 'u1', email: 'user@example.com', role: 'user' }); // chat is gated (spec 019)
  await page.goto('/');

  await page.getByRole('button', { name: /Качество на въздуха/ }).click();
  await page.getByRole('button', { name: 'Питай чата за този набор' }).click();

  // Context chip + prefilled question.
  await expect(page.getByText('Контекст: Качество на въздуха')).toBeVisible();
  await expect(page.getByLabel('Въпрос')).toHaveValue(/Качество на въздуха/);

  await page.getByRole('button', { name: 'Изпрати' }).click();
  await expect(page.getByText(/се публикува от Столична община/)).toBeVisible();

  const body = JSON.parse(stub.chatRequests[0] ?? '{}') as { scope?: { datasetIds?: string[] } };
  expect(body.scope?.datasetIds).toEqual(['d1']);
});
