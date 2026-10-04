# Roadmap

Deferred work, in the order it is worth doing. This exists so the next session
does not have to reconstruct intent by reading
[SESSION-LEDGER.md](SESSION-LEDGER.md) end to end — the ledger records what
happened, this records what to do about what is missing.

Each item names the gap it closes and what "done" means. Where a fix has a real
cost, the cost is stated rather than buried, because the interesting part of any
of these decisions is the tradeoff, not the code.

Nothing here is committed to. The list is a judgement about sequence, not a
promise.

---

## P0 — closes a gap the project currently admits

### 1. Prove the live path

**Gap.** Every QA run so far has been mock mode, because no `ANTHROPIC_API_KEY`
has been available on the runner. The planner and triage are the only two model
call sites in the product, and neither has ever been exercised against a real
endpoint. Both providers are tested against a stubbed transport; a real
endpoint may reject the request shape and nothing here would find out.

**Done when** `argus.yml` has completed at least one run in live mode on
GitHub, and `baseline/known-bugs.json` has been regenerated from a live triage
rather than from fixtures — which is the only way to confirm the
featureId-anchored match survives a planner that words its test cases
differently than the fixtures do.

**Watch for.** Live triage may produce different verdicts for the same three
deliberate defects. If a known defect stops matching the baseline, that is the
featureId rule failing in the wild, and it is the single most likely place this
design to break. Record what happened either way; a clean live run is evidence,
and a messy one is better evidence.

### 2. An end-to-end test that boots the demo app

**Gap.** `runPipeline`, `src/execution` and the injected browser script have no
unit test. They are covered only by the QA workflow — which, as
[SESSION-LEDGER.md](SESSION-LEDGER.md) records, failed to run them at all for
seven consecutive runs while reporting itself as having found a real bug. The
same gap has been named in three separate ledger entries.

**Done when** a test starts the demo app, runs the pipeline in `--mock`, and
asserts on the resulting artifact: three real bugs, zero new, gate passed. That
single test would have caught the `--mock` forwarding bug, the empty-baseline
bug and the masked-failure bug, all three of which shipped.

**Cost.** It needs Playwright and a port, so it cannot be a plain unit test and
will be slower than the rest of the suite. Consider a separate vitest project or
a `test:e2e` script excluded from the coverage floor, and say which in
[vitest.config.ts](vitest.config.ts) — do not let it quietly inflate the number.

### 3. Dashboard tests, or a recorded decision that it has none

**Gap.** The Next.js dashboard has zero unit tests, and the README says so
plainly. An explicit decision is worth almost as much as the tests.

**Done when** either the `bugs` and `trends` pages have tests, or
[docs/decisions/](docs/decisions/) holds a record explaining why they do not and
what would change that.

---

## P1 — hardens what already works

### 4. Stage progress markers, so an incomplete run says where it stopped

**Gap.** `argus verify-run` exits 2 with "the pipeline did not complete" and
names the missing piece, but not the stage that died. It cannot, because a
stage that crashes writes nothing.

**Done when** the pipeline appends to a progress file as each stage begins, and
`verify-run` reports the last stage that started. The half-written-artifact
cases this would expose are currently covered only by unit tests — no crash has
actually been induced on a runner.

### 5. Baseline expiry

**Gap.** A baseline entry that stops matching anything is indistinguishable from
an entry that is still doing its job. Both just sit in the file. Worse, an
entry for a defect that got _fixed_ keeps matching nothing and quietly
suppresses the next genuine regression in that feature until someone notices.

**Done when** an entry records a last-seen run, and an entry that has not matched
for N runs is surfaced in the PR comment rather than passed over in silence.

**Watch for.** Expiry that fires on a quiet week would be noise. Prefer surfacing
over expiring: report "BASE-002 has not matched in 12 runs, is it still real?"
and let a human delete it. That keeps the deletion an explicit, reviewed act,
which is the property the whole baseline design rests on.

### 6. Rebase the open Dependabot pull requests

**Gap.** Six open PRs (1–6) all test pre-fix commits, so they are permanently
red and permanently misleading in the PR list.

**Done when** they are rebased onto `main` and green. Dependabot will reopen
against the fix once it lands; this is cleanup, not engineering.

### 7. Decide on the five moderate vite/esbuild advisories

**Gap.** Open since the first audit. They need the next vitest major, which is
a real upgrade with real risk.

**Done when** someone takes the decision and records it — either upgrade and
re-measure coverage, or state that the risk is acceptable and why. `braces`
(the high) is already unfixable and documented; these five are a choice, not an
oversight.

---

## P2 — reach

### 8. Deploy the dashboard

`dashboard/` is a static export and deploy-ready; nothing is deployed and the
README says so. Vercel's `installCommand` was corrected to pnpm, so a deploy
would now work — but has not been attempted, so "deploy-ready" is an inference
from a successful static build, not an observation.

### 9. A test against a live Anthropic endpoint

Related to item 1 but narrower: a single marked test that calls the real API and
is skipped without a key. Cheap, and it converts "the request shape has never
been accepted by a real endpoint" from a known unknown into a known risk.

---

## Known sharp edge, not scheduled

**Two defects on the same feature collapse into one.** Baseline matching is on
`(featureId, verdict)`, so a second, genuinely different bug in an
already-broken feature is reported as known rather than new. This was a
deliberate trade — see
[ADR 0007](docs/decisions/0007-baseline-known-defects-in-source.md) — and it
remains the sharpest edge in the design.

Tightening it means requiring some title similarity on top of the featureId
match, which needs calibration against real runs rather than guesswork. Do not
pick a threshold without item 1 done first: without live titles there is nothing
to calibrate against, and a guessed threshold is how the baseline gets quietly
broken in a way that only shows up as a gate that stopped firing.
