# The coverage floor is 75, and the gap it protects is named

## Context

The engine's measured coverage is 76.92% statements, 87.26% branches, 84.32%
functions. The obvious response was to set the floor at 80 and go looking for
the missing lines.

## Decision

Set the floor at 75/80/80/75 — below what the suite measures — and say plainly
in `vitest.config.ts` which code is missing and why.

## Rationale

The uncovered code is not incidental. It is `runPipeline`,
`src/execution/index.ts` and the injected browser script: the part that drives
a real browser and decides whether a merge is blocked.

Those three are reachable only with a running browser against a running app.
There are two honest ways to reach 80%:

1. exclude the browser-driven path, or
2. boot the demo app in the test suite and run the loop.

Option 1 produces a better-looking number and a weaker guarantee. It is the
exact trade a coverage floor exists to prevent: the number stops describing the
thing you care about and starts describing the thing that was convenient to
measure.

Option 2 is the right answer and is listed as the next thing to do in the
ledger. Until then, the floor is set where the suite genuinely is, the
exclusions are enumerated with reasons, and the README says which stage of the
pipeline has no unit test.

A floor set above what you measure is not a standard. It is a number chosen to
be passed.
