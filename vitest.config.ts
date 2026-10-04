import { defineConfig } from 'vitest/config';

/**
 * Vitest covers the tool itself. Two rules hold across the whole suite:
 *
 *   1. No test makes a live Anthropic call. The AI modules run against
 *      fixtures, so `pnpm test` is green on a fresh clone with no key.
 *   2. No test needs a network connection.
 *
 * Coverage is scoped to the engine and floored, but the scope is the point
 * rather than the percentage. `src/dashboard` is a static asset served by the
 * CLI and `src/cli/index.ts` is commander wiring whose behaviour is covered by
 * driving the binary itself; averaging them in would produce a flattering
 * number that says less about the parts that decide a merge.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      /*
       * Excluded, each for a reason rather than by convenience:
       *
       *   src/dashboard/**      a static HTML asset the CLI serves; there is no
       *                         logic in it to cover
       *   src/cli/index.ts      commander wiring. Its behaviour is covered by
       *                         running the binary, which is the only honest way
       *   src/cli/demo-server.ts  lifecycle glue for the bundled demo app
       *   src/cli/drift-demo.ts   a demo command; it exists to be run by a
       *                         person, not to be called by anything
       *
       * What is NOT excluded is `src/cli/pipeline.ts` and `src/execution`,
       * which drive a real browser. They are exercised end to end by the QA
       * workflow against the demo app, and their pure parts are unit tested.
       * Leaving them in the denominator is the point.
       */
      exclude: [
        'src/dashboard/**',
        'src/cli/index.ts',
        'src/cli/demo-server.ts',
        'src/cli/drift-demo.ts',
      ],
      /*
       * Set from what the suite actually measures today (76.9 / 87.3 / 84.3 /
       * 76.9), rounded down to a whole number. Deliberately not 80/80/80/80:
       * that number would only be reachable by excluding the browser-driven
       * path - `runPipeline`, `src/execution` and the injected browser script -
       * which is the code that decides whether a merge is blocked. Excluding
       * the part that matters to make the headline look better is the exact
       * trade this floor exists to prevent.
       *
       * Those three are covered by running the real loop against the bundled
       * demo app - see `.github/workflows/argus.yml` - not by this suite. The
       * gap is real and is recorded in SESSION-LEDGER.md rather than hidden
       * behind an exclusion.
       */
      thresholds: {
        statements: 75,
        branches: 80,
        functions: 80,
        lines: 75,
      },
    },
  },
});
