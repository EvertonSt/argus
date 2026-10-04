# Parse untrusted input at the boundary, narrow with a guard

## Context

Four places in this codebase read JSON that Argus did not write in this
process: the Playwright report, the performance trace, the model response, and
the triage cache on disk. All four were `JSON.parse(...)` assigned into an
untyped variable.

## Decision

Every one of them parses as `unknown` and narrows through a type guard before
anything else sees the value.

## Rationale

A `JSON.parse` result is `any` and stays `any` until someone decides otherwise.
The result is that the first property access is unchecked, and if the shape is
not what was expected the failure surfaces three layers away as `undefined is
not a function` — with no mention of the file that was actually wrong.

The triage cache is the clearest case. It was `Map<string, any>`. A half-written
or hand-edited entry would reach `cachedToTriageResult` with `verdict`
undefined, and the triage verdict for that failure would _disappear_ rather
than fail: the run would report fewer bugs than it found, which is the one
failure mode a QA tool must not have.

A guard at the boundary converts that into "skip this entry", which is a
defensible outcome for a cache and an impossible one for a verdict.
