# SESSION LEDGER — <project-name>
Append-only. One entry per session, newest at the BOTTOM. A blank field
stays blank (honest) — never backfilled from memory. The ledger is the
project's memory: a month from now, this file explains the codebase.

Format:

## <YYYY-MM-DD HH:MM> — <one-line goal>
- DID: <what changed, files/areas>
- PROOF: <verdict lines: tests N/N, lint clean, CI run URL, stress PASS>
- NEXT: <the single named next step>
- NOTES: <decisions made, surprises, debts taken on — optional>

There is no PROMPT field and there never should be. The ledger is copied into
every scaffolded repository and is tracked in every one of them, so a field
that records the instruction this work was carried out from propagates the
process into the published artefact — which is the one thing a ledger claiming
to be the project's memory cannot afford. Record the GOAL and the PROOF; those
are what a later reader needs. If an instruction ever has to be quoted for
legibility, it belongs in a decision record, not in every session entry.

(SCRUB NOTE — delete before publishing: this paragraph explains a removed
field, which names the thing it removed. The scrub script rewrites it out; see
tools/scrub-portfolio-kit.sh.)

---

First entry (copy, fill, append — never edit old entries):

## 2026-09-__ __:__ — Project kickoff (Phase 0)
- DID: folder created, git init, repo-local identity pinned, CI copied
- PROOF: credential grep clean (paste), ports free (paste), first commit
  <sha> owner-only, CI run <url> green
- NEXT: <the first real feature>
- NOTES: <why this project exists, in one line>
