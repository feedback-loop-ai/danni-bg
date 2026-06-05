import { defineConfig } from '@playwright/test';

// E2E specs use the `.e2e.ts` suffix so `bun test` (which matches *.test.ts / *.spec.ts) never runs
// them; only Playwright does. Requires browsers: `bunx playwright install chromium`.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'bunx vite --port 5173',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
