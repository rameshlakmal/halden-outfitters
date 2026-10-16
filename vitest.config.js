import { defineConfig } from 'vitest/config';

// v1 tests only (npm run v1:test). Integration tests share one test database, so files run one at a time.
export default defineConfig({
  test: { include: ['test/**/*.test.js'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000 },
});
