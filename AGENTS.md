# AGENTS.md — Contributing to Argus

> **Status**: Solo project by Everton S. Andrade. Contributions welcome via GitHub issues
> or PRs. This file documents conventions for maintainers and future contributors.

## Project overview

**Argus** is an autonomous AI QA agent: it crawls a web app, plans a test suite,
generates Playwright tests (deterministic, templates-first), runs them, classifies
failures (real bug vs flaky vs selector drift vs environment), files GitHub Issues,
and ships a static dashboard.

It is the **generation + triage** half of the autonomous QA loop. Its sibling project
**Cerberus CI** is the **regression gate** that locks in existing test suites.

## Key conventions

### Deterministic boundary (do not cross)

The AI boundary is **deliberately narrow**: only `planner` (1 call) and `triage` (1 call
per unique failure) may call a model. All other stages MUST be free of model calls:

- **codegen** — templates only, LLM as fallback
- **execution** — pure Playwright
- **bug-filer** — deterministic severity scoring + dedupe, environmentIssue
- **CI gate** — pass/fail decided by severity, never by AI confidence

If you add a code path that crosses this boundary, add a comment explaining why
and update the README's call-count table.

### Templates first, LLM second

`src/codegen/templates.ts` has 30+ deterministic rules. If a new Gherkin pattern
is missing, **add a template rule first**. Only fall back to the LLM if templating
is genuinely impossible for that pattern.

### Zero API keys for testing

`npm test` MUST run entirely on fixtures with `MockAiClient`. Never add a test that
requires a live API key. If you need to test provider behavior, add fixtures under
`test/fixtures/` and use the mock client.

### Human approves every change

Even high-confidence triage results (90%+) are **recommendations only**. Argus generates,
files bug, and posts annotations — but never auto-applies fixes to your codebase.

## Architecture decisions (ADRs)

1. **Severity gate over pass/fail** — flakiness never blocks merges; only new real
   bugs above threshold fail builds. (See `src/bug-filer/severity.ts`.)
2. **Dedupe on signature** — `title + featureId + errorClass + verdict` with weighted
   scoring. Threshold 0.55. (See `src/bug-filer/duplicate-check.ts`.)
3. **Provider abstraction** — `AIProvider` interface mirrors Cerberus's pluggable adapter
   design. Config-driven via `ARGUS_AI_PROVIDER`. (See `src/shared/provider.ts`.)
4. **Verdict cache** — SHA-256 signature + 30-day TTL. Skips AI calls on cache hit.
   (See `src/triage/cache.ts`.)

## Development workflow

```bash
npm install          # install deps
npm run typecheck    # tsc --noEmit
npm test             # 313 tests, no API key needed
npm run run:mock     # full pipeline demo (mocked AI)
npm run build        # compile to dist/
```

## Directory layout

- `src/cli/` — CLI entry, pipeline orchestration, CI reporting
- `src/shared/` — types, config, AI provider abstraction
- `src/ingestion/` — crawl app, build feature inventory
- `src/planner/` — AI step (1 call)
- `src/codegen/` — deterministic template library (0 AI calls)
- `src/execution/` — Playwright runner
- `src/triage/` — AI classification (N calls) + verdict cache
- `src/bug-filer/` — GitHub Issues filing + dedupe
- `dashboard/` — Next.js 15 + Tailwind dashboard
- `demo-app/` — demo app with known bugs for testing
- `test/` — 313 tests (all fixture-based)

## Testing

All tests use fixtures and `MockAiClient` — no API key needed. The mock client is
keyed per test case, loading expected responses from inline JSON or fixture files.

Run: `npm test`  (or `npx vitest run`  for a specific file)
