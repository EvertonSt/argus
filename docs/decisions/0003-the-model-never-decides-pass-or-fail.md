# The model classifies; arithmetic decides

## Context

Argus triages failures with a model. The obvious design is to let the model
answer "should this block the merge?", because it is already in the loop and
already has the context.

## Decision

Two model call sites only — planning and triage. The gate is a severity rank
lookup. `meetsThreshold(severity, threshold)` is pure, has no key requirement,
and is unit tested across the whole ordering.

## Consequences

**The gate is testable offline.** `pnpm test` covers it without a network or a
key, and the QA workflow runs `--mock` and still produces a meaningful verdict.
A gate whose correctness depends on a model response cannot be regression
tested at all.

**The gate is reproducible.** The same run artifact always produces the same
verdict. A model-based gate produces a different answer on the same input
whenever the provider is retried, which is the property that makes people stop
trusting a gate.

**Triage quality still matters.** Being right about _which_ failures are real
is what makes the run useful. The decision only moves the boundary between
"Argus tells you" and "Argus blocks you".
