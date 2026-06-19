// US8 — identity (spec 019): public browse stays open, the chat is gated behind sign-in, and the
// Kratos login form renders. Auth is stubbed (whoami + callback); no live Ory stack.

import { expect, test } from '@playwright/test';
import { stubApi, stubAuth, stubLoginFlow, stubLogout, stubRecovery } from './fixtures.ts';

test('anonymous visitor can browse but the chat input is replaced by a sign-in prompt', async ({
  page,
}) => {
  await stubApi(page);
  await stubAuth(page); // no session
  await page.goto('/');

  // Public browse works.
  await expect(page.getByRole('button', { name: /Качество на въздуха/ })).toBeVisible();
  // Chat is gated: the panel is blurred behind a centered sign-in prompt + a header login link.
  await expect(page.getByText(/използвате чата/)).toBeVisible();
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
  // Signed in → no blur overlay prompt.
  await expect(page.getByText(/използвате чата/)).toHaveCount(0);
  // A normal user has no admin settings link.
  await expect(page.getByRole('link', { name: 'Настройки' })).toHaveCount(0);
});

test('recovery confirms a reset link was emailed after submitting an email', async ({ page }) => {
  await stubApi(page);
  await stubAuth(page); // anonymous
  await stubRecovery(page);
  await page.goto('/auth/recovery');
  await page.fill('input[name="email"]', 'forgot@example.com');
  await page.locator('button[name="method"][value="link"]').first().click();
  // Link mode re-renders the email form in place with a confirmation message (no in-app code step).
  await expect(page.getByText('A recovery link has been sent')).toBeVisible();
  await expect(page.locator('input[name="code"]')).toHaveCount(0);
});

test('logout runs the Kratos logout flow (same-origin)', async ({ page }) => {
  await stubApi(page);
  await stubAuth(page, { id: 'u1', email: 'user@example.com', role: 'user' });
  await stubLogout(page);
  await page.goto('/');
  await expect(page.getByLabel('Въпрос')).toBeVisible(); // signed in

  const logoutFlow = page.waitForRequest('**/kratos/self-service/logout/browser');
  await page.getByRole('button', { name: 'Изход' }).click();
  await logoutFlow; // the logout flow was initiated against the same-origin /kratos proxy
});
