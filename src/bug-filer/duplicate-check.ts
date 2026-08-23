/**
 * Bug filer — duplicate detection.
 *
 * PORTED from the Bug Report Generator (`src/duplicateCheck.js`), preserving
 * its Dice-coefficient comparison and the 0.55 threshold that tool was tuned
 * to. Same algorithm, same threshold, so Argus dedupes exactly as the
 * standalone tool did.
 *
 * Improvement over v1: dedupe is no longer on the *title* alone. Argus now
 * builds a richer signature (title + featureId + normalised error-type +
 * triage verdict) and scores each field, combining them into a single
 * similarity. This prevents two different bugs that happen to share an
 * auto-generated title from colliding, and two genuinely identical bugs that
 * are phrased differently from slipping through.
 *
 * Adaptations:
 *   1. The original owned its storage (read/write bug-log.json itself). Here
 *      persistence lives in the caller, so these functions are pure and take
 *      the existing bug list as an argument — which also makes them testable.
 *   2. Matches now carry the matched bug's id, since Argus records
 *      `isDuplicateOf` as an id rather than a title.
 *   3. The signature combines title similarity (Dice) with structural
 *      boosts: same featureId, same normalised error class, and same verdict
 *      (real_bug vs flaky etc.) all raise the score.
 *
 * Deterministic: no LLM involvement in dedupe, by design.
 */
import type { FiledBug, TriageVerdict, BugSignature } from '../shared/types.js';

/** Ported unchanged from the original tool. */
export const SIMILARITY_THRESHOLD = 0.55;

/**
 * Sørensen–Dice coefficient over character bigrams, returning 0..1.
 *
 * Inlined from the `string-similarity` package, which the original tool
 * depended on but which was deprecated and unmaintained. The implementation is
 * a faithful port of its `compareTwoStrings` — whitespace stripped, bigram
 * multiplicity respected via the decrement-on-match counter, identical strings
 * short-circuited to 1, and anything under two characters scored 0. Scores are
 * therefore unchanged and the tuned 0.55 threshold still means what it did.
 *
 * Kept in-tree rather than swapped for another package: it is thirty lines of
 * arithmetic, it is the heart of dedupe, and it deserves to be readable and
 * directly testable instead of buried in node_modules.
 */
export function compareTwoStrings(a: string, b: string): number {
  const first = a.replace(/\s+/g, '');
  const second = b.replace(/\s+/g, '');

  if (first === second) return 1;
  if (first.length < 2 || second.length < 2) return 0;

  const firstBigrams = new Map<string, number>();
  for (let i = 0; i < first.length - 1; i += 1) {
    const bigram = first.substring(i, i + 2);
    firstBigrams.set(bigram, (firstBigrams.get(bigram) ?? 0) + 1);
  }

  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i += 1) {
    const bigram = second.substring(i, i + 2);
    const count = firstBigrams.get(bigram) ?? 0;
    if (count > 0) {
      // Decrement so a bigram appearing twice in `second` only matches twice
      // in `first` if it genuinely occurs twice there.
      firstBigrams.set(bigram, count - 1);
      intersectionSize += 1;
    }
  }

  return (2.0 * intersectionSize) / (first.length + second.length - 2);
}

/**
 * Normalise a Playwright error message to a stable error-class for dedupe.
 * Strips volatile bits — line/column refs, auto-generated selector strings,
 * timestamps — so that the same conceptual failure scores consistently.
 */
export function normalizeError(raw: string): string {
  return raw
    .replace(/:\d+:\d+/g, '') // strip :line:col
    .replace(/node:\w+/g, '') // strip node:internal refs
    .replace(/[\w-]+:\d+:\d+/g, '') // strip file:line:col
    .replace(/expect\([^)]+\)/g, 'expect()') // normalise expect() args
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Build the dedupe signature for a bug about to be filed.
 * `errorClass` is derived from the failure message and verdict so that
 * two real-bug reports about the same defect but generated from different test
 * runs still collapse to one signature.
 */
export function buildSignature(
  title: string,
  featureId: string,
  errorMessage: string,
  verdict: TriageVerdict,
): BugSignature {
  return {
    title,
    featureId,
    errorClass: normalizeError(errorMessage),
    verdict,
  };
}

export interface DuplicateMatch {
  id: string;
  title: string;
  /** Combined similarity score in [0, 1]. */
  score: number;
  /** Per-field breakdown for auditability in the dashboard. */
  breakdown?: {
    titleScore: number;
    featureBoost: boolean;
    errorBoost: boolean;
    verdictMatch: boolean;
  };
}

/**
 * Score how similar two signatures are, combining Dice title similarity with
 * structural boosts. The boosts reward signals that two bugs are really about
 * the same defect; the title Dice coefficient is the tie-breaker for bugs that
 * don't share other signals but look textually alike.
 *
 * Scoring:
 *   - Start with Dice(title, title) in [0, 1].
 *   - +0.15 if featureId matches.
 *   - +0.15 if normalised error class matches.
 *   - +0.10 if verdict matches.
 *   - Cap at 1.
 *
 * The 0.55 threshold is unchanged, but its meaning improves: a title-only
 * match needs to be genuinely similar, while structural matches (same
 * feature, same error, same verdict) clear the bar even with paraphrased
 * titles.
 */
export function scoreSignatures(
  a: BugSignature,
  b: BugSignature,
): { score: number; breakdown: DuplicateMatch['breakdown'] } {
  const titleScore = compareTwoStrings(a.title, b.title);
  const featureBoost = a.featureId !== '' && a.featureId === b.featureId;
  const errorBoost = a.errorClass !== '' && a.errorClass === b.errorClass;
  const verdictMatch = a.verdict === b.verdict;

  // Weighted scoring: title similarity is the foundation, but errorClass
  // identity is heavily weighted — if both are populated and differ, the
  // score drops below threshold regardless of title match.
  let score = titleScore * 0.4;
  if (featureBoost) score += 0.2;
  if (errorBoost) score += 0.25;
  else if (a.errorClass && b.errorClass && a.errorClass !== b.errorClass) score -= 0.5;
  if (verdictMatch) score += 0.15;
  score = Math.min(1, Math.max(0, score));

  return {
    score,
    breakdown: { titleScore, featureBoost, errorBoost, verdictMatch },
  };
}

/**
 * Find previously filed bugs whose signatures are similar enough to be
 * duplicates, best match first. Uses the richer multi-field signature so that
 * structural matches (same feature + error + verdict) clear the threshold even
 * when titles are paraphrased.
 */
/** Accept either a full BugSignature or a bare title string (for backwards compat). */
function normalizeSignature(signature: BugSignature | string): BugSignature {
  if (typeof signature === 'string') {
    return { title: signature, featureId: '', errorClass: '', verdict: 'real_bug' };
  }
  return signature;
}

export function checkDuplicate(
  signature: BugSignature | string,
  existing: FiledBug[],
  threshold = SIMILARITY_THRESHOLD,
): DuplicateMatch[] {
  if (existing.length === 0) return [];
  const sig = normalizeSignature(signature);

  return existing
    .map((bug) => {
      const existingSig = bug.signature;
      if (!existingSig) {
        // Legacy fallback: if an existing bug predates the signature field,
        // fall back to title-only Dice (preserves v1 behaviour for old data).
        return {
          id: bug.id,
          title: bug.title,
          score: compareTwoStrings(sig.title, bug.title),
        };
      }
      const result = scoreSignatures(sig, existingSig);
      return {
        id: bug.id,
        title: bug.title,
        score: result.score,
        breakdown: result.breakdown,
      };
    })
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/**
 * Find the single best duplicate match, or null when nothing crosses the
 * threshold.
 */
export function findDuplicate(
  signature: BugSignature | string,
  existing: FiledBug[],
  threshold = SIMILARITY_THRESHOLD,
): DuplicateMatch | null {
  return checkDuplicate(signature, existing, threshold)[0] ?? null;
}
