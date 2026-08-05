/**
 * Bug filer — duplicate detection.
 *
 * PORTED from the Bug Report Generator (`src/duplicateCheck.js`), preserving
 * its Dice-coefficient comparison and the 0.55 threshold that tool was tuned
 * to. Same algorithm, same threshold, so Argus dedupes exactly as the
 * standalone tool did.
 *
 * Adaptations:
 *   1. The original owned its storage (read/write bug-log.json itself). Here
 *      persistence lives in the caller, so these functions are pure and take
 *      the existing bug list as an argument — which also makes them testable.
 *   2. Matches now carry the matched bug's id, since Argus records
 *      `isDuplicateOf` as an id rather than a title.
 *
 * Deterministic: no LLM involvement in dedupe, by design.
 */
import type { FiledBug } from '../shared/types.js';

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

export interface DuplicateMatch {
  id: string;
  title: string;
  score: number;
}

/**
 * Find previously filed bugs whose titles are similar enough to be duplicates,
 * best match first. Same Dice-coefficient comparison the original used.
 */
export function checkDuplicate(
  title: string,
  existing: FiledBug[],
  threshold = SIMILARITY_THRESHOLD,
): DuplicateMatch[] {
  if (existing.length === 0) return [];

  return existing
    .map((bug) => ({
      id: bug.id,
      title: bug.title,
      score: compareTwoStrings(title, bug.title),
    }))
    .filter((match) => match.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/** The single best duplicate match, or null when nothing crosses the threshold. */
export function findDuplicate(
  title: string,
  existing: FiledBug[],
  threshold = SIMILARITY_THRESHOLD,
): DuplicateMatch | null {
  return checkDuplicate(title, existing, threshold)[0] ?? null;
}
