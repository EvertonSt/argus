# CONTRIBUTING

## The loop
PLAN (3-6 lines) -> CHANGE (minimal) -> PROVE (run the gates, paste the
verdicts) -> COMMIT -> HANDOFF (append to LEDGER.md).

## The gates that bind
Every one of these must pass before a commit lands:

1. typecheck
2. lint, zero warnings
3. unit tests
4. build
5. e2e tests

Continuing past a red gate is not permitted. Fix it or revert it first.
"All jobs green" on CI is the licence to continue, not a formality.

## Authorship
Every commit is authored by the owner alone. No co-author trailers, no tool
stamps, no attribution of any kind. A commit-msg hook enforces this, and it is
verified rather than assumed.

## Secrets
No credential is ever committed, printed, or read into context. Secrets live
in environment variables; .env is ignored; .env.example lists names only.

## Isolation
One project never touches another project's files, ports, or infrastructure.
