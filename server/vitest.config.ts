import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
    // Database isolation: Checkpoint 1G & 1H integration tests execute live migrations
    // and runtime-role bootstrap scripts against the PostgreSQL test instance. Running test
    // files sequentially avoids database role and migration lock race conditions.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
