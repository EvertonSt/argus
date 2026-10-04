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

---

## 2026-10-03 — First push, and the two things it found

### PROOF

```
https://github.com/EvertonSt/argus/actions/runs/37168724270
conclusion: success

  success  format, lint, types, builds
  success  unit tests (+ coverage floor)
  success  links, secrets, authorship
  success  security audit
```

Full gate green on Windows and on Ubuntu 24.04 under WSL2 (Node 22.23.3,
pnpm 11.20.0), and `pnpm audit --prod` clean on both.

### DID NOT PROVE

- **The first CI run failed all four jobs before executing a line of Argus.**
  `pnpm/action-setup` refuses to run without a version, and package.json had no
  `packageManager` field. Fixed and re-run green. Recorded because the lesson is
  general: a workflow that has never executed is a document, not a check.
- **The QA workflow is red on every pull request, and that is a real design
  defect, not bad luck.** `argus.yml` runs Argus against the demo app, and the
  demo app has three seeded bugs. The severity gate therefore fires on every
  PR, including one that changed nothing, because "new bug" is measured against
  an empty baseline on a fresh checkout. Every seeded bug counts as new.

  This is precisely the failure the tool's own README argues against — a gate
  that is always red teaches reviewers to ignore it — and the fix is to seed a
  baseline of the demo app's known bugs so only genuinely new ones count. That
  is the first thing to do, and it was not done here.

- **The product did work.** Argus ran end to end on a GitHub runner, found the
  demo app's seeded bugs, emitted PR annotations and commented the report. The
  pipeline works; the baseline it compares against does not.
- **The gate's error message named an unset variable** and printed "at or above
  the '' severity threshold" on the first real finding. Fixed by defining
  `ARGUS_SEVERITY_FAIL_THRESHOLD` in the workflow, which it already read.
- **The dashboard has no unit tests**, and the browser-driven path is covered by
  the QA workflow rather than by a test suite. Both carry over from the entry
  above.
- **Nothing is deployed.** The dashboard is deploy-ready as a static export;
  no deployment exists.

### NEXT

1. Seed a baseline for the demo app's known bugs so the severity gate is only
   red when something new appears. Highest value; the QA workflow is currently
   a check that cannot pass.
2. An end-to-end test that boots the demo app and runs the loop in `--mock`,
   so `runPipeline` and `src/execution` have a suite of their own.
3. Decide whether the five moderate vite/esbuild advisories under vitest are
   worth the next vitest major.

---

## 2026-10-04 — The gate that could never pass

### DID

- Replaced the empty-baseline gate with a committed known-defect baseline at
  `baseline/known-bugs.json`, outside gitignored `data/`. A failure matching an
  entry is recorded as `baselinedAs`, reported as known, and excluded from
  `newBugs`.
- Baseline matching is its own explicit rule — verdict, then `featureId`, then
  title similarity as a fallback — rather than `scoreSignatures`. Reasons in
  `src/bug-filer/baseline.ts` and ADR 0007.
- Added `argus baseline [--write]` to inspect and extend the file from a run.
- The PR comment now renders known defects in a collapsible section naming each
  baseline id, so a green build does not look identical to a build with nothing
  to report.
- Found and fixed product output still telling users to run `npm run …` in a
  pnpm-only repository: `pipeline.ts`, `demo-server.ts`, `drift-demo.ts`,
  `index.ts`, `dashboard/app/page.tsx`, `.env.example`, and the committed docs.
  `dashboard/vercel.json` ran `npm install`, which would have produced a second
  lockfile on deploy. `scripts/capture-run.ts` spawned `npx`.
- Tests 355 → 388 across 20 files. Coverage 76.92 → **77.18** statements,
  87.26 → **87.38** branches, 84.32 → **85.21** functions.

### PROOF

Both directions, from a clean `data/` — the state CI starts in.

Baseline intact:

```
3 bug(s) filed — 0 new, 3 known, 0 duplicate(s)
CI gate            PASS
```

One entry deleted from `baseline/known-bugs.json`:

```
3 bug(s) filed — 1 new, 2 known, 0 duplicate(s)
CI gate            FAIL
  1 new bug(s) at or above "high" severity
[ELIFECYCLE] Command failed with exit code 1.
```

The negative case is the one that matters: the gate still bites, and it names
exactly the defect whose entry was removed while the other two stayed known.

### DID NOT PROVE

- **Two defects on the same feature collapse into one.** Matching is on
  `(featureId, verdict)`, so a second, genuinely different bug in an
  already-broken feature is reported as known. Deliberate, and the sharpest
  edge here: it trades a missed regression for a gate people do not ignore.
- **The injected fourth defect was not exercised through the gate.** A real bug
  was injected into the demo app's stats page, and triage classified it
  `flaky` — because `fixtures/triage-stats-page-shows-totals.json` hardcodes
  that verdict. Mock triage reads fixtures, so it cannot classify a defect no
  fixture anticipated. The negative test therefore used baseline removal rather
  than an injected defect. Same conclusion, different mechanism; stated so the
  two are not confused later.
- **Live mode has not been run against this baseline.** Triage fixtures supply
  the verdicts in mock mode. A live run's planner words its test cases
  differently, so the baseline's title strings will differ — which the matching
  rule is built to survive, but that has not been observed on a real endpoint.
- The browser-driven path still has no unit test; the dashboard still has none.

### NEXT

1. Run the QA workflow live against a baseline generated from a live triage, so
   the featureId-anchored match is exercised by a real planner rather than
   fixtures.
2. An end-to-end test that boots the demo app and runs the loop in `--mock`, so
   `runPipeline` and `src/execution` have a suite of their own.
3. Decide whether the five moderate vite/esbuild advisories under vitest are
   worth the next vitest major.

---

## 2026-10-04 — Correction: the QA workflow never ran the product

The entry above credits the QA workflow with having run Argus end to end on a
GitHub runner. That was wrong, and checking it changed what this project knows.

### WHAT WAS WRONG

The 2026-10-03 entry says:

> **The product did work.** Argus ran end to end on a GitHub runner, found the
> demo app's seeded bugs, emitted PR annotations and commented the report.

Every one of the seven Argus QA runs — `4f6723d`, `ea57993`, `e3a53f5`,
`cb0ad99`, `6ac6bb4`, `7b4f88c`, `9c19a66` — failed the same way:

```
$ tsx src/cli/index.ts -- run --mock
✗ ANTHROPIC_API_KEY is not set, and --mock was not passed.
[ELIFOCYCLE] Command failed with exit code 2.
```

The pipeline never executed once. The `data/` upload step reported "No files
were found with the provided path: data/", and the comment step printed "No
runs found. Run `argus run` first."

### WHY

pnpm 11 forwards the `--` separator to the script verbatim:

```
$ pnpm run argus -- run --mock
$ tsx src/cli/index.ts "--" "run" "--mock"     # separator reaches the CLI
$ pnpm run argus run --mock
$ tsx src/cli/index.ts "run" "--mock"           # works
```

Commander never saw the subcommand, `mock` stayed false, and `assertRunnable`
correctly refused. The error message blamed the missing API key, which is the
wrong culprit and is what made this read as a secrets problem rather than an
invocation problem.

### WHY IT SURVIVED THE FIRST ENTRY

`continue-on-error: true` on the Run Argus step reports `conclusion: success`
even when the command exits non-zero. The GitHub UI therefore showed a green
step, and the failure only surfaced in the final gate step, whose message said
"found a new real bug" — implying Argus had run and found something. It had
found nothing. A green step and a plausible red message, both pointing away
from the actual cause.

### DID

- The workflow selects a **script** (`run` or `run:mock`) instead of passing a
  flag through `pnpm run argus --`. No argument forwarding, nothing to break.
- The same fix applied to the comment step, which used the same broken form.
- Rehearsed both invocations locally before pushing, not after.

### DID NOT PROVE

- **The live path is still unproven.** Every QA run has been mock mode with no
  key available. `run` (live) has never executed in CI, and the planner and
  triage calls it makes are the part of the system no test covers.
- This is the second time the same workflow failed for a reason unrelated to
  its stated purpose. The lesson is not "add a test"; it is that a step marked
  `continue-on-error` cannot be used as evidence that anything ran. The run
  artifact, not the step's green tick, is the proof.
