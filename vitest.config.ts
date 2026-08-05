import { defineConfig } from 'vitest/config';

/**
 * Vitest covers the tool itself. Two rules hold across the whole suite:
 *   1. No test makes a live Anthropic call — AI modules run against fixtures.
 *   2. No test needs an API key, so `npm test` is green on a fresh clone.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/dashboard/**', 'src/cli/index.ts'],
    },
  },
});
