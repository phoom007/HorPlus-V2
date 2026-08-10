import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/tests/e2e/**/*.spec.ts',
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests — E2E specs share FakeLineServer on port 5456 */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: 'http://127.0.0.1:5174',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local backend API and frontend dev servers before starting the tests */
  webServer: [
    {
      command: 'npm run dev',
      cwd: './server',
      url: 'http://127.0.0.1:3101/health/liveness',
      reuseExistingServer: false,
      timeout: 60000,
      stdout: 'pipe',
      env: {
        ...process.env,
        PORT: '3101',
        ALLOW_OPERATIONAL_ACTIVATION: 'true',
        HORPLUS_E2E: 'true',
        LINE_API_BASE_URL: 'http://127.0.0.1:5456',
        LINE_PLATFORM_URL: 'http://127.0.0.1:5456',
        PUBLIC_APP_URL: 'http://127.0.0.1:5174',
        PUBLIC_WEBHOOK_ORIGIN: 'https://webhook.horplus.test',
        CORS_ORIGINS: 'http://127.0.0.1:5174,http://localhost:5174',
      },
    },
    {
      command: 'npx vite --port 5174 --host 127.0.0.1',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        ...process.env,
        VITE_API_TARGET: 'http://127.0.0.1:3101',
      },
    },
  ],
});
