import { defineConfig } from 'vitest/config';

// Integration tests share one test database, so files run one at a time.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: loadEnvFile(),
  },
});

function loadEnvFile(): Record<string, string> {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* CI sets the environment directly */
  }
  return { TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? '' };
}
