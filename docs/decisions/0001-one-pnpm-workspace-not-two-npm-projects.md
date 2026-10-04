# One pnpm workspace, not a root project plus a nested one

## Context

The repository arrived with a root npm project and a `dashboard/` directory that
had its own `package.json` **and its own `package-lock.json`**. Two lockfiles,
two `npm ci` invocations, and no mechanism that could make them agree.

## Decision

`dashboard/` becomes a pnpm workspace package. One install, one lockfile, one
audit.

## Consequences

**Good.** A transitive package can no longer resolve to two different versions
in two places, because there is only one resolver. `pnpm audit` sees the whole
graph instead of the root's half of it — which is how six advisories inside
`dashboard > next` were visible in one run rather than hidden behind a nested
`npm --prefix dashboard ci`.

**Also good.** Dependabot gets one npm entry. Two would have produced two pull
requests resolving the same package differently.

**Cost.** The dashboard's Vercel deployment is now a workspace member, so the
project root to import into Vercel is `dashboard/`, not the repository root.
That is one line of documentation rather than a structural change, and it was
already the instruction for a nested project.

**Cost.** Anyone who knew `npm ci` at the root has to learn `pnpm install`. The
lockfile format changed, so the first command after cloning is different. This
is the one real downside and it is paid once.
