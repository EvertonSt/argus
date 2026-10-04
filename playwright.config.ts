import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the tests Argus *generates*.
 *
 * Note the reporter: a JSON report is what the execution engine parses back
 * into a typed RunSummary, so it is not optional. Traces and screenshots are
 * retained on failure because the triage stage reads them.
 */
export default defineConfig({
  testDir: './generated-tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: process.env.ARGUS_PW_JSON ?? 'data/last-playwright-report.json' }],
  ],
  outputDir: process.env.ARGUS_PW_ARTIFACTS ?? 'data/pw-artifacts',
  use: {
    baseURL: process.env.ARGUS_TARGET_URL ?? 'http://localhost:4317',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 5_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
