import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the real stack: the API (port 4000, against a seeded database) and the web app.
// Locally they reuse servers that are already running; in CI they start the production build.
const WEB = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Locally, use the installed Edge; CI installs Playwright's Chromium.
    ...(ci ? {} : { channel: 'msedge' }),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...(ci ? {} : { channel: 'msedge' }) } },
    { name: 'mobile', use: { ...devices['Pixel 7'], ...(ci ? {} : { channel: 'msedge' }) } },
  ],
  webServer: ci
    ? [
        {
          command: 'npm run start -w @halden/api',
          url: 'http://127.0.0.1:4000/api/v1/health',
          cwd: '../..',
          // CI starts the API before the web build (pages prerender from it), so reuse that one.
          reuseExistingServer: true,
          env: { NODE_ENV: 'production' },
        },
        { command: 'npm run start', url: WEB, reuseExistingServer: false, env: { NODE_ENV: 'production' } },
      ]
    : undefined,
});
