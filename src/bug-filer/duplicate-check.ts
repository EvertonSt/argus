/**
 * Bug filer — duplicate detection.
 *
 * PORTED from the Bug Report Generator (`src/duplicateCheck.js`), including
 * the `string-similarity` dependency and the 0.55 threshold that tool was
 * tuned to. Keeping the same algorithm and threshold means Argus dedupes
 * exactly as the standalone tool did.
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
import stringSimilarity from 'string-similarity';
import type { FiledBug } from '../shared/types.js';

/** Ported unchanged from the original tool. */
export const SIMILARITY_THRESHOLD = 0.55;

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

  const titles = existing.map((bug) => bug.title);
  const { ratings } = stringSimilarity.findBestMatch(title, titles);

  return ratings
    .map((rating, index) => ({
      id: existing[index]?.id ?? '',
      title: rating.target,
      score: rating.rating,
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
