import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'postgresql://horplus_test:testpass@localhost:5432/horplus_test?schema=public',
      REDIS_URL: 'redis://localhost:6379',
      LOG_LEVEL: 'fatal',
      CORS_ORIGINS: 'http://localhost:5173',
    },
  },
});
