/**
 * Bug baselining — the committed list of defects that are already known.
 *
 * WHY THIS EXISTS
 *
 * Argus stores filed bugs in `data/bugs.json`, and `data/` is gitignored on
 * purpose: it is run output, not source. That is correct, and it has a sharp
 * consequence. On a fresh CI checkout `data/bugs.json` does not exist, so the
 * dedupe list is empty, so *every* bug Argus finds is new — including the three
 * defects the demo app ships deliberately. The severity gate then fails on
 * every pull request for defects that were present before the PR was opened.
 *
 * That is not a flaky gate; it is a gate that cannot ever be green, and a gate
 * that can never be green is one reviewers learn to ignore. It is precisely
 * the failure mode this project's own README argues against.
 *
 * The fix is the one every serious regression gate uses: a committed baseline
 * of known defects. It lives at `baseline/known-bugs.json`, is reviewed like
 * source, and is the input Argus dedupes against before it decides what is
 * "new". Adding an entry is an explicit, human decision in a diff. Removing one
 * is equally explicit.
 *
 * WHY MATCHING IS NOT FUZZY
 *
 * The obvious implementation reuses `scoreSignatures`, but that scorer keys on
 * `errorClass`, and a Playwright error message is not a stable string. A
 * measured run produced an errorClass containing `14 ×`, a `call log:`, and a
 * serialised DOM node — none of which survive the next run unchanged. Under
 * `scoreSignatures` a changed errorClass is not merely a weaker match, it is a
 * **-0.5 penalty** that forces the bug back to "new". A baseline keyed on
 * volatile text would therefore re-break on the next CI run, and would look
 * like it worked in the meantime.
 *
 * So baseline matching is its own explicit rule, stated here in full:
 *
 *   1. The verdict must match. A flaky failure never matches a real-bug entry.
 *   2. If the entry pins a `featureId`, the failure's `featureId` must equal it.
 *      Feature ids come from the ingested inventory, not from the model, so
 *      they are stable across runs and independent of how the planner worded
 *      its test case.
 *   3. If the entry pins no `featureId`, fall back to title similarity at the
 *      same threshold the runtime dedupe uses.
 *
 * The (featureId, verdict) pair is the stable identity of a known defect: one
 * control, one known failure mode. Title similarity is still computed and
 * reported, so a human can audit any match, but it does not decide.
 *
 * The tradeoff is deliberate and worth stating: two *different* bugs against
 * the same feature and verdict would be treated as the known defect. Erring
 * toward "known" is the correct direction here. A gate that blocks on a defect
 * the author already knows about trains people to ignore the gate; a gate that
 * misses a second defect in an already-broken feature costs one review comment.
 *
 * Deterministic: no LLM involvement in baseline matching, by design.
 */
import type { BugSignature, Severity, TriageVerdict } from '../shared/types.js';
import { PRIORITIES, TRIAGE_VERDICTS } from '../shared/types.js';
import { readJson } from '../shared/storage.js';
import { compareTwoStrings, SIMILARITY_THRESHOLD } from './duplicate-check.js';

/** A defect that is already known and committed. */
export interface BaselineBug {
  /** Stable id, `BASE-001` style. Referenced by reports and PR comments. */
  id: string;
  title: string;
  /**
   * Ingested feature id this defect belongs to. The load-bearing part of the
   * match. Empty only for hand-written legacy entries, which fall back to
   * title similarity.
   */
  featureId: string;
  verdict: TriageVerdict;
  severity: Severity;
  /** Why this defect is here. Reviewed in the diff, so it has to be readable. */
  note: string;
  /** ISO date the entry was recorded. */
  recordedAt: string;
}

export interface BaselineMatch {
  entry: BaselineBug;
  /** Title similarity, for audit. Decided by the rule above, not by this number. */
  titleScore: number;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isSeverity(value: unknown): value is Severity {
  return isString(value) && (PRIORITIES as readonly string[]).includes(value);
}

function isVerdict(value: unknown): value is TriageVerdict {
  return isString(value) && (TRIAGE_VERDICTS as readonly string[]).includes(value);
}

/**
 * Validate one parsed value as a baseline entry.
 *
 * The baseline is a committed file that a human edits, so it will eventually
 * be malformed — a missing field, a typo'd severity, a trailing comma someone
 * fixed in the array but not the object. A bad entry must cost that one entry,
 * not the whole gate. Same lesson as the triage cache: validate at the
 * boundary, from `unknown`, and never let one bad record erase the rest.
 */
export function isBaselineBug(value: unknown): value is BaselineBug {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isString(candidate.id) &&
    candidate.id.length > 0 &&
    isString(candidate.title) &&
    candidate.title.length > 0 &&
    isString(candidate.featureId) &&
    isVerdict(candidate.verdict) &&
    isSeverity(candidate.severity) &&
    isString(candidate.note) &&
    isString(candidate.recordedAt)
  );
}

export interface ParsedBaseline {
  entries: BaselineBug[];
  /** How many records were dropped for failing validation. */
  rejected: number;
}

/**
 * Parse untrusted JSON into baseline entries, keeping the valid ones.
 * Pure, so the failure mode is unit-tested rather than discovered in CI.
 */
export function parseBaseline(raw: unknown): ParsedBaseline {
  if (!Array.isArray(raw)) return { entries: [], rejected: raw === undefined ? 0 : 1 };
  const entries: BaselineBug[] = [];
  let rejected = 0;
  for (const record of raw) {
    if (isBaselineBug(record)) entries.push(record);
    else rejected += 1;
  }
  return { entries, rejected };
}

/**
 * Read the committed baseline. A missing file is normal — a project with no
 * known defects has no baseline — so it yields an empty list rather than an
 * error. A malformed file warns and keeps its valid entries.
 */
export function loadBaseline(file: string): BaselineBug[] {
  const parsed = parseBaseline(readJson<unknown>(file, []));
  if (parsed.rejected > 0) {
    // Surfaced, not swallowed: a baseline silently losing entries re-opens the
    // exact false-failure this file exists to prevent.
    console.warn(
      `[argus] baseline: skipped ${parsed.rejected} malformed entr${
        parsed.rejected === 1 ? 'y' : 'ies'
      } in ${file}`,
    );
  }
  return parsed.entries;
}

/**
 * Find the baseline entry a failure matches, best match first.
 *
 * Implements the rule documented at the top of this file: verdict, then
 * featureId when the entry pins one, then title similarity as the tie-break.
 */
export function matchBaseline(
  signature: BugSignature,
  entries: readonly BaselineBug[],
): BaselineMatch | null {
  const candidates = entries
    .filter((entry) => {
      if (entry.verdict !== signature.verdict) return false;
      if (entry.featureId !== '') return entry.featureId === signature.featureId;
      // No feature pinned: fall back to the runtime dedupe's title threshold
      // rather than inventing a second, looser one.
      return compareTwoStrings(entry.title, signature.title) >= SIMILARITY_THRESHOLD;
    })
    .map((entry) => ({ entry, titleScore: compareTwoStrings(entry.title, signature.title) }))
    .sort((a, b) => b.titleScore - a.titleScore);

  return candidates[0] ?? null;
}

/** Next sequential `BASE-NNN` id given the entries already present. */
export function nextBaselineId(entries: readonly BaselineBug[]): string {
  const highest = entries.reduce((max, entry) => {
    const match = /^BASE-(\d+)$/.exec(entry.id);
    if (!match) return max;
    const parsed = Number.parseInt(match[1] ?? '', 10);
    return Number.isFinite(parsed) && parsed > max ? parsed : max;
  }, 0);
  return `BASE-${String(highest + 1).padStart(3, '0')}`;
}
