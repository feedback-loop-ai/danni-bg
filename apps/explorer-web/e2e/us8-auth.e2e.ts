// US8 — identity (spec 019): public browse stays open, the chat is gated behind sign-in, and the
// Kratos login form renders. Auth is stubbed (whoami + callback); no live Ory stack.

import { expect, test } from '@playwright/test';
import { stubApi, stubAuth, stubLoginFlow } from './fixtures.ts';

test('anonymous visitor can browse but the chat input is replaced by a sign-in prompt', async ({
  page,
}) => {
  await stubApi(page);
  await stubAuth(page); // no session
  await page.goto('/');

  // Public browse works.
  await expect(page.getByRole('button', { name: /Качество на въздуха/ })).toBeVisible();
  // Chat is gated: no input, a sign-in prompt + a header login link instead.
  await expect(page.getByLabel('Въпрос')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Влезте' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Вход' })).toBeVisible();
});

test('the login page renders the Kratos email + password form', async ({ page }) => {
  await stubApi(page);
  await stubAuth(page);
  await stubLoginFlow(page);
  await page.goto('/auth/login');

  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
  await expect(page.locator('input[name="identifier"]')).toBeVisible();
  await expect(page.locator('input[name="password"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Създай профил' })).toBeVisible();
});

test('a signed-in user sees the chat input and their email in the header', async ({ page }) => {
  await stubApi(page);
  await stubAuth(page, { id: 'u1', email: 'user@example.com', role: 'user' });
  await page.goto('/');

  await expect(page.getByLabel('Въпрос')).toBeVisible();
  await expect(page.getByText('user@example.com')).toBeVisible();
  // A normal user has no admin settings link.
  await expect(page.getByRole('link', { name: 'Настройки' })).toHaveCount(0);
});
