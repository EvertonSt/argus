/**
 * Three tiers, because one config cannot be right for a QA engine, its tests,
 * and a Next.js dashboard at the same time - and a config that is permissive
 * enough for all three is permissive enough to catch nothing.
 *
 *   src/    the product. Errors are errors.
 *   test/   the suite. A few rules off, each with a written reason below.
 *   config  flat config files, linted under their own settings.
 */
import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'data/**',
      'generated-tests/**',
      '.next/**',
      'dashboard/**',
      'demo-app/**',
    ],
  },

  // ── Product ──────────────────────────────────────────────────────────────
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...ts.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Argus is a CLI. Printing its verdicts is the product, not a smell.
      'no-console': 'off',

      // An `any` here usually means a JSON body or a browser value that has
      // not been narrowed yet. The suite exists to keep this count honest.
      '@typescript-eslint/no-explicit-any': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // A non-null assertion is a claim the compiler cannot check. In a tool
      // whose output is a merge gate, an unchecked claim is the expensive kind.
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },

  // ── Tests ────────────────────────────────────────────────────────────────
  {
    files: ['test/**/*.ts'],
    extends: [js.configs.recommended, ...ts.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.vitest },
    },
    rules: {
      'no-console': 'off',

      // Reason: a test that asserts on an intentionally malformed model
      // response or a truncated Playwright report has to build that malformed
      // value literally. Narrowing it to a real type would be asserting that
      // the broken input is well-formed, which is the opposite of the test.
      '@typescript-eslint/no-explicit-any': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Reason: OFF, deliberately. The suite mocks `AiClient.complete`, whose
      // signature returns `Promise<string>`. A mock that returns the fixture
      // string synchronously still has to be declared `async` to satisfy the
      // interface, and `require-await` cannot tell that apart from a genuinely
      // pointless `async`. It flagged four correct mocks and no real defect.
      //
      // The class of bug this rule usually catches - a setup helper that
      // forgets to await, so the test races its own fixture - is caught here
      // by the suite failing intermittently instead, which is a better signal
      // than a lint rule with a false positive rate that high.
      'require-await': 'off',

      // Reason: an `async` mock that returns a promise-chained value would be
      // returning `any`, and these feed assertions directly.
      '@typescript-eslint/no-unsafe-return': 'off',

      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // ── Config files ─────────────────────────────────────────────────────────
  {
    // A flat config file is not product code. Linting it under the product's
    // type-aware rules produces noise about `defineConfig` shapes that say
    // nothing about whether the config is right.
    files: ['*.config.ts', 'scripts/**/*.ts'],
    extends: [js.configs.recommended, ...ts.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.vitest },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
