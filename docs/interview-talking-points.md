# Argus — Interview Talking Points

A portfolio project: **Argus**, an autonomous AI QA agent. Point it at a web
app; it explores the app, has Claude plan a Playwright test suite, runs the
suite, then has Claude triage *why* each failure happened — real bug, flaky
test, or stale selector — and only files the real bugs. Live at
github.com/EvertonSt/argus. 257 unit tests, no API key to run.

These points are written for behavioral questions ("tell me about a project /
a hard bug / a trade-off you made"). Each has a 20-second spoken version and the
detail behind it, so you can go deep if the interviewer pushes.

---

## 1. The one-line pitch (elevator)

> "Most 'AI writes your tests' demos stop at generation. The hard half is the
> morning after, when the suite is red and someone has to decide whether the
> app broke, the test is flaky, or a designer renamed a button. Argus closes
> that loop — it uses the LLM to triage its own failures, and only the genuine
> bugs get filed, and only those can block a merge."

Why it lands: it names a real pain (flaky suites get their gates switched off),
and the design choice *is* the insight.

---

## 2. The hardest bug — and the pattern behind it

Two shipped bugs were found by **checking signals most people dismiss**, not by
writing more tests. Both were invisible to a passing local suite.

### 2a. CI bound IPv6, clients spoke IPv4

- **Symptom:** the first GitHub Actions run failed — but the server logged
  "listening", then `wait-on` timed out for the full 60 seconds. A "listening"
  server that won't connect is *not* a slow boot; it's bound somewhere the
  client isn't looking.
- **Root cause:** Node's `server.listen(PORT)` with no host binds `::` (IPv6
  any). Ubuntu CI resolves `localhost` to `127.0.0.1` first, where nothing
  answered.
- **Fix:** bind `0.0.0.0` explicitly, and wait on `tcp:127.0.0.1` + a `curl`
  probe (wait-on proves the port accepts a connection, not that the app serves).
- **Why it's a good story:** the bug was *platform divergence* — dev was Windows,
  CI was Ubuntu. A green local suite said nothing about CI. Budget a fix cycle
  for first-run CI; verify the artifact it produces, not just the exit code.

### 2b. The orphaned demo server (EADDRINUSE on run two)

- **Symptom:** running the pipeline a second time died with `EADDRINUSE` — even
  though "nothing" was running. I'd actually hit this mid-build and worked
  around it by killing PIDs by hand and moving on. That workaround *was* the bug
  report.
- **Root cause:** on Windows the CLI spawns through a shell wrapper
  (`cmd.exe → npx → tsx → node`). `child.kill()` killed the shell and left the
  node process holding the port. A second, independent bug: `process.exit()`
  fired after an *un-awaited* `stop()`, killing the CLI mid-cleanup.
- **Fix:** ask the app to exit via its own `/__shutdown` endpoint (reliable no
  matter how deeply it's wrapped), then fall back to `taskkill /T /F` on the
  tree; and `await` the shutdown before exiting.
- **General rule to state:** *if you work around the same failure twice by hand,
  stop and fix it — the workaround is the reproduction.* And: verify
  idempotence. A tool that only works once is broken for the second reviewer. I
  ran the entry point three times with no cleanup and asserted zero orphaned
  processes survived.

This is the strongest story in the repo. It shows you debug *systems*, not just
code, and that you treat a workaround as a defect.

---

## 3. A judgment call — LLM only where it earns its place

> "The principle is: only steps 2 and 5 touch the model. Everything else —
> execution, severity scoring, duplicate detection, the CI gate — is
> deterministic and unit-tested to a fixed answer. That boundary is *enforced*,
> not just documented. It's why `npm test` needs no API key and costs nothing,
> and why the gate can't be blamed on a flaky model."

Follow-ups you can offer:

- **Why?** A QA gate that cries wolf gets turned off within a month. Severity
  and dedup must be reproducible, so they're pure code, not prompts.
- **Self-healing stays human-approved.** When triage says a selector went stale,
  Argus reports a suggested fix and *stops*. Auto-editing the test suite without
  review was an explicit out-of-scope decision for v1 — and the right one for a
  tool whose whole job is trust.
- **Failure handling is loud.** A malformed LLM response fails *noisily*
  (schema validation + one retry), it never silently drops a test or a bug.

---

## 4. A refactor done rigorously — dropping a deprecated dependency

> "The dedupe engine used `string-similarity`, which is deprecated and prints a
> warning on every install. I inlined its Dice coefficient — about 30 lines —
> but I proved equivalence first. I diffed my port against the real package
> across 5,441 comparisons: the actual bug titles, unicode, whitespace, repeated
> bigrams, and 5,000 random pairs. Zero mismatches. *Then* I uninstalled it and
> pinned the behavior with characterization tests."

The detail that impresses: the non-obvious case is **multiplicity vs. set
semantics** — `'aabaa'` vs `'aab'` scores 0.667 because bigrams repeat, and a
naive set-based rewrite gets it wrong. They may ask "how do you know you didn't
change behavior?" — answer: the differential harness, run *before* deletion.

---

## 5. A design trade-off — severity gate, not pass/fail

> "The CI gate fails on *severity*, not on red tests. A flaky test or a renamed
> button never blocks a merge; only a brand-new real bug at or above the
> configured threshold does. I made the threshold a config var so a team can
> tune it. That directly targets why teams abandon QA gates."

This pairs with the "cries wolf" point in #1 — it's the same thesis, shown at the
architecture level.

---

## 6. Verification discipline (the meta-story)

Three things I now do by default, all learned building this:

1. **A green local suite is not evidence CI passes.** First real CI run is a
   test of the *workflow*. Verify the artifact exists (the PR comment actually
   posted, artifacts actually uploaded), not just that steps exited 0.
2. **Derive counts, don't remember them.** I'd written test counts in the README
   from memory and three were wrong; I now query the runner's JSON output.
3. **Check the signal you'd dismiss.** Stale notifications, manual workarounds —
   those pointed at two real shipped bugs.

---

## 7. Demo to show (have it open)

- `npm run run:mock` — full loop, bundled fixtures, ~35s, zero cost. Files 3
  bugs, fails the gate by design on the first clean run; second run shows them
  as duplicates and passes.
- `npm run demo:drift` — renames a button, re-runs, and Argus classifies the
  failure as *selector drift* (a UI change) rather than a bug, with a suggested
  fix it never applies. This is the one-slide version of the whole thesis.
- The dashboard at `npm run dashboard` — coverage, pass/fail history, triage
  breakdown, filed bugs, all from JSON.

---

## Quick-QA (one-liners if they rapid-fire)

- *What's it built in?* TypeScript strict mode, Node 20+, Playwright + Vitest,
  Anthropic API for the two LLM steps. No database — everything is inspectable
  JSON.
- *Does it need an API key?* To run the demo, no — fixtures. For a live run, the
  two Claude calls need a key; everything else is deterministic.
- *How do you stop it from being flaky?* The LLM only plans and triages; the
  gate is severity-based and deterministic, so the suite can't block a merge
  over model noise.
- *What would you add?* Autonomous multi-page crawl and visual regression are
  explicit stretch goals I left out of v1 on purpose, so the core loop is solid
  first. The honest answer is "I scoped it."
