# SESSION LEDGER

Append-only. One entry per session, newest at the bottom. Never edited — a
corrected entry is a new entry that says what changed and why.

Each entry carries four things:

- **DID** — what changed
- **PROOF** — the command and its output, not a description of it
- **DID NOT PROVE** — the gap the checks leave, named rather than implied
- **NEXT** — what is left

The third heading is the one that compounds. A ledger without it becomes a list
of things that were verified, and a reader cannot tell the difference between
"verified" and "verified within the limits of what we checked".

---

## 2026-10-03 — The rebuild

### DID

Rebuilt Argus as a single pnpm workspace holding the engine, the CLI, the
bundled demo app and the dashboard — from a repository that had a root npm
project and a nested npm project with its own lockfile.

- **Workspace.** `dashboard/` is now a pnpm workspace package. One install
  command, one lockfile, one audit. Before: `npm ci` at the root and a separate
  `dashboard/package-lock.json` that could resolve the same transitive package
  to a different version than the root did.
- **Dependency audit, run for the first time.** `pnpm audit --prod` reported
  **2 critical and 4 high**, every one of them reachable through the
  dashboard's Next.js.
- **Typecheck: clean, and kept clean.** Two projects, `noUncheckedIndexedAccess`
  on for the product and deliberately off for the tests.
- **Lint: rewritten into three tiers.** The original config was permissive
  enough (`no-explicit-any: 'warn'`) that it caught nothing.
- **Real defects fixed, not suppressed:**
  - **`src/cli/pipeline.ts` and `src/shared/config.ts` had no tests at all.**
    The orchestrator that decides whether a merge is blocked, and the config
    loader that decides which provider gets called, were both at or near zero.
  - **The triage cache deserialised into `any`.** A malformed entry would reach
    `cachedToTriageResult` with `verdict` undefined and the triage verdict would
    _disappear_ rather than fail. Parsed as `unknown`, narrowed by a guard.
  - **HTTP 529 was not in the transient set.** That is Anthropic's
    `overloaded_error` — the most common transient failure against this API —
    so a momentary capacity blip failed an entire run on the first attempt.
  - **Both providers' failure messages claimed "after 4 attempts"** regardless
    of how many were made. An auth failure breaks out on the first try, and the
    message sent the reader hunting for a retry bug that was not there.
- **Coverage: 313 → 355 tests**, floor enforced at 75/80/80/75 over `src/`.

### PROOF

```
pnpm typecheck     exit 0    0 errors across both TypeScript projects
pnpm lint          exit 0    0 errors, 0 warnings
pnpm format:check  exit 0
pnpm test          exit 0    355 passed (19 files)
pnpm test:coverage exit 0    76.92% stmts · 87.26% branch · 84.32% funcs
                               (floor 75/80/80/75, over src/)
pnpm build         exit 0
pnpm dashboard:build exit 0
pnpm audit --prod  exit 0    No known vulnerabilities found
bash scripts/gate.sh        exit 0    11 steps, all green
```

The audit before the upgrades, for contrast:

```
critical  next     vuln >=13.4.0 <15.5.24   path dashboard>next
critical  next     vuln >=10.0.0 <15.5.24   path dashboard>next
high      sharp    vuln <0.35.0             path dashboard>next>sharp
high      sharp    vuln <0.35.4             path dashboard>next>sharp
high      postcss  vuln <=8.5.17            path dashboard>next>postcss
moderate  postcss  vuln <8.5.10             path dashboard>next>postcss
```

Next moved 15.5.23 → 15.5.27, which cleared both criticals. Six advisories
remained because Next _pins_ `postcss@8.4.31` and `sharp@0.34.5` — both below
their fixes, with no Next release that ships a fixed pair. Those are handled by
`overrides` in `pnpm-workspace.yaml`, with the reasoning written next to them.

Gates watched failing, not just passing:

```
attribution   exit 1   a trailer-shaped banner in a source file
links         exit 1   a markdown link to a file that does not exist
coverage      exit 1   72.01% statements, below the 75 floor
typecheck     exit 2   my own new tests imported ArgusError from the wrong
                         module and used `prompt` where the field is `user.
                         The unit suite passed them; tsc did not.
```

That last one is the argument for keeping typecheck in the gate: two tests were
green, passing, and wrong. They imported a symbol from a module that does not
export it, and spelled a field that does not exist. Vitest transpiles without
checking, so nothing would have caught it until the code was read.

### DID NOT PROVE

- **The browser-driven path has no unit test.** `runPipeline`,
  `src/execution/index.ts` and the injected browser script are at or near zero
  coverage. They are exercised end to end by `.github/workflows/argus.yml`
  against the demo app, which is a real run rather than a simulated one — but
  that is CI, not this suite, and the coverage floor is set at 75 rather than
  80 precisely so this gap stays visible instead of being excluded away.
- **The dashboard has no unit tests at all.** Coverage says nothing about it.
  It has a build, and it is type-checked, and that is all.
- **No test has called a live Anthropic endpoint.** Both providers are exercised
  against a stubbed transport. A real endpoint may reject the request shape.
- **Triage has only been seen against fixtures and the demo app.** Whether it
  separates a real regression from a flake on an unfamiliar codebase is the
  open question, and it is the reason the gate is severity-based.
- **`overrides` for `postcss` and `sharp` are unproven against a live Next
  server.** The dashboard builds and the build is green, which is evidence and
  not proof. A future Next release needing a different pair is where this
  surfaces.
- **CI had not run when this entry was written.** Everything above is
  Windows-local.

### NEXT

1. First push, and read the run.
2. An end-to-end test that boots the demo app and runs the whole loop in
   `--mock`, so `runPipeline` and `src/execution` have a suite of their own
   rather than relying on the QA workflow to notice a regression.
3. Component tests for the dashboard, or an explicit decision that it has none.
4. Decide whether the `--mock` fixtures are a fair proxy for live triage, and
   write down the answer either way.
