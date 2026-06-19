// US3 — grounded chat: asking a question streams an answer and renders cited datasets with a source
// link (FR-015/FR-017). The backend SSE stream is stubbed (grounding correctness is covered by the
// backend tests); this validates the SPA's streaming + citation rendering.

import { expect, test } from '@playwright/test';
import { stubApi, stubAuth } from './fixtures.ts';

test('streams a grounded answer with a clickable citation', async ({ page }) => {
  await stubApi(page);
  await stubAuth(page, { id: 'u1', email: 'user@example.com', role: 'user' }); // chat is gated (spec 019)
  await page.goto('/');

  await page.getByLabel('Въпрос').fill('Кои региони публикуват данни за въздуха?');
  await page.getByRole('button', { name: 'Изпрати' }).click();

  // Streamed answer text (assembled from token events).
  await expect(page.getByText(/се публикува от Столична община/)).toBeVisible();

  // Citation rendered inside the chat panel's citation list, with a source link.
  const citation = page.locator('.citation').getByRole('button', { name: 'Качество на въздуха' });
  await expect(citation).toBeVisible();
  await expect(page.locator('.citation').getByRole('link')).toHaveAttribute(
    'href',
    'https://data.egov.bg/d1',
  );
});
