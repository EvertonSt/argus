# Baseline known defects in a committed file, match them on identity

## Context

`argus.yml` was red on every pull request. Not intermittently — every one,
including Dependabot's. The demo app ships three deliberate defects
(`demo-app/KNOWN_BUGS.md`), and the severity gate compared them against
`data/bugs.json`.

`data/` is gitignored, on purpose: it is run output, not source. So on a fresh
checkout that file does not exist, the dedupe list is empty, every defect reads
as new, and the gate fails on defects that were present before the pull request
was opened.

A gate that can never be green is not a safety net. It is a red X on every
branch, and a red X that is always red stops being information.

## Decision

Commit the known defects at `baseline/known-bugs.json`, outside `data/`, and
match failures against it explicitly:

1. The triage verdict must match.
2. If the entry pins a `featureId`, the failure's `featureId` must equal it.
3. If the entry pins no `featureId`, fall back to title similarity at the
   existing runtime-dedupe threshold.

A match is recorded as `baselinedAs` and excluded from `newBugs`, so it does
not block a merge. `argus baseline --write` extends the file from a run.

## Rationale

**Why not reuse `scoreSignatures`.** It keys on `errorClass`, and a Playwright
error is not a stable string. A measured run produced an `errorClass` containing
`14 ×`, a `call log:`, and a serialised DOM node. Worse, under `scoreSignatures`
a differing `errorClass` is not a weaker match but a **−0.5 penalty** that
forces the bug back to "new". A baseline keyed on volatile text would have
looked correct on the run that created it and re-broken on the next CI run.

`featureId` comes from the ingested inventory, not from the model, so it is
stable across runs and independent of how the planner worded its test case. The
`(featureId, verdict)` pair is the stable identity of a known defect: one
control, one known failure mode. Title similarity is still computed and
reported so a human can audit a match, but it does not decide.

**Why it lives outside `data/`.** A baseline is a human decision. It belongs in
a diff, reviewed like source, where adding an entry is a deliberate act and
removing one is equally visible.

**The tradeoff, stated plainly.** Two different bugs against the same feature
and verdict are treated as the known defect. Erring toward "known" is the
correct direction: a gate that blocks on a defect the author already knows
about trains people to ignore the gate, while a gate that misses a second
defect in an already-broken feature costs one review comment.

**Known defects stay visible.** The PR comment renders them in a collapsible
section naming each baseline id. Suppressing them would make a green build
look identical to a build that had nothing to report, and the reviewer would
lose the ability to check that the three failures Argus reports really are the
three the demo app ships deliberately.

## How this was verified

Both directions, end to end, from a clean `data/`:

- Baseline intact → `3 bug(s) filed — 0 new, 3 known`, gate **PASS**, exit 0.
- One baseline entry deleted → `1 new`, gate **FAIL**, exit 1, naming exactly the
  defect whose entry was removed while the other two stayed known.

A gate that cannot fail is worse than one that always fails, so the negative
case is the one that matters, and it was run rather than assumed.
