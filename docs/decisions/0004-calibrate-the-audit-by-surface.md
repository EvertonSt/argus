# Calibrate the audit by surface, not by threshold

## Context

`pnpm audit` initially reported 2 critical and 4 high — every one of them
through the dashboard's Next.js, against a project whose CLI is what users
install.

## Decision

The security job runs two audits at two levels:

- production dependencies at `high`, blocking
- development dependencies at `critical`, `continue-on-error`

A third step fails if the workspace ever declares ignored CVEs without a reason.

## Rationale

A single threshold has to be set somewhere on the line between "noisy" and
"blind". Set it at `low` and the dev tree — ESLint's transitive graph included
— reddens weekly and gets muted within a month. Set it at `critical` and a
high-severity advisory in shipped code passes.

Those are different surfaces with different consequences. The production tree is
what runs inside a user's CI job; a high there is a real risk. The dev tree never
ships; a high there costs a developer's afternoon, not a user's build. One
threshold for both is wrong in both directions.

Splitting by surface lets each one be set to the level that still means
something to the person who has to act on it.

## What this forced

The first `pnpm audit` run was not clean, and this is the reason to run it:

```
next     15.5.23  ->  15.5.27   cleared both criticals
postcss  8.4.31   ->  8.5.28    override: Next pins this below its fix
sharp    0.34.5   ->  0.35.5    override: Next pins this below its fix
```

The two overrides exist because no Next release ships a fixed pair. The
reasoning is written next to them in `pnpm-workspace.yaml`, and a CI step
surfaces any override on every run so it cannot accumulate quietly.
