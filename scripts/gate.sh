#!/usr/bin/env bash
# gate.sh - the one command that proves this repository is shippable.
#
# Every step reports ITS OWN exit code. Nothing is chained through a pipe:
# `tsc -b | tail -5` exits with `tail`'s status, so a failing typecheck reports
# as a passing gate. That single mistake is the reason a repository can look
# green on a build machine and be broken everywhere else.
#
# Usage:  bash scripts/gate.sh          # everything
#         bash scripts/gate.sh --fast   # skip the two builds
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

FAILED=()
RESULTS=()

run_step() {
  local name="$1"; shift
  printf '\n\033[1m── %s\033[0m\n' "$name"
  local start=$SECONDS
  # Capture the status IMMEDIATELY, on its own line.
  #
  # `if "$@"; then ... fi` reads `$?` as the if-COMPOUND status, which is 0
  # when the condition fails and there is no else branch. An early version of
  # this script did exactly that and reported a genuinely failing typecheck as
  # "FAIL typecheck (exit 0)".
  "$@"
  local code=$?
  if [ "$code" -eq 0 ]; then
    RESULTS+=("PASS  $name ($(( SECONDS - start ))s)")
  else
    RESULTS+=("FAIL  $name (exit $code, $(( SECONDS - start ))s)")
    FAILED+=("$name")
  fi
  return $code
}

tree_snapshot() {
  # Tracked files only. A build creates plenty of untracked output (dist,
  # data/, generated-tests/, .next) and none of that is a finding.
  #
  # `--porcelain` rather than `git diff --name-only` on purpose: Git
  # normalises line endings away when diffing, so a tool that rewrites a
  # tracked file with CRLF endings shows an empty diff and a clean-looking
  # tree. The porcelain status still flags it, which is what catches it.
  git status --porcelain --untracked-files=no 2>/dev/null | LC_ALL=C sort
}

check_tree_unchanged() {
  local before="$1" after
  after="$(tree_snapshot)"
  if [ "$before" = "$after" ]; then
    return 0
  fi
  printf '\nA step above modified tracked files.\n\n'
  printf 'before:\n%s\n\nafter:\n%s\n\n' "$before" "$after"
  printf 'A build tool is rewriting a file this repository owns. The result is\n'
  printf 'a gate that fails with a clean tree and no diff to revert.\n'
  return 1
}

run_step "format:check" pnpm format:check
run_step "lint"          pnpm lint
run_step "typecheck"     pnpm typecheck
run_step "unit tests"    pnpm test
run_step "verify:secrets"  pnpm verify:secrets
run_step "verify:links"    pnpm verify:links
run_step "verify:attribution" pnpm verify:attribution

# Only meaningful where there is a repository to compare against.
TRACK_TREE=0
if git rev-parse --git-dir >/dev/null 2>&1; then
  TRACK_TREE=1
  TREE_BEFORE="$(tree_snapshot)"
fi

if [ "$FAST" -eq 0 ]; then
  run_step "coverage floor" pnpm test:coverage
  run_step "build (cli)"    pnpm build
  run_step "build (dashboard)" pnpm dashboard:build
fi

if [ "$TRACK_TREE" -eq 1 ]; then
  run_step "tree unchanged by build" check_tree_unchanged "$TREE_BEFORE"
fi

printf '\n\033[1m══ GATE SUMMARY ══\033[0m\n'
for line in "${RESULTS[@]}"; do
  printf '  %s\n' "$line"
done

if [ "${#FAILED[@]}" -ne 0 ]; then
  printf '\n\033[31mGATE FAILED — %d step(s): %s\033[0m\n' \
    "${#FAILED[@]}" "${FAILED[*]}"
  exit 1
fi

printf '\n\033[32mGATE PASSED — %d steps, all green\033[0m\n' "${#RESULTS[@]}"
exit 0