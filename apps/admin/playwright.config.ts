import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the real stack: the API (port 4000, against a seeded database, with this app's origin in
// ALLOWED_ORIGINS) and the admin. Locally they reuse servers that are already running; in CI they start the build.
const ADMIN = process.env.E2E_ADMIN_URL ?? 'http://localhost:3002';
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  // One worker, files in name order: a11y and the read-only specs first, then the ones that change demo data.
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: ADMIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Locally, use the installed Chrome; CI installs Playwright's Chromium.
    ...(ci ? {} : { channel: 'chrome' }),
  },
  projects: [{ name: 'admin', use: { ...devices['Desktop Chrome'], ...(ci ? {} : { channel: 'chrome' }) } }],
  webServer: ci
    ? [
        {
          command: 'npm run start',
          url: `${ADMIN}/sign-in`,
          reuseExistingServer: false,
          env: { NODE_ENV: 'production' },
        },
      ]
    : undefined,
});
