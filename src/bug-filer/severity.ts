/**
 * Bug filer — severity scoring.
 *
 * PORTED from the Bug Report Generator (`src/severity.js`). The keyword rules
 * and their ordering are carried over unchanged, because they are the tuned
 * heuristic that tool already shipped with; re-deriving them here would throw
 * away working behaviour.
 *
 * Two adaptations were required for Argus:
 *   1. The original returned capitalised labels ("Critical"). Argus's Severity
 *      type is lowercase, so the levels are lowercased at the boundary.
 *   2. The original scored a human's free-text bug description. Here the input
 *      is assembled from the failing test's title, the Playwright error, and
 *      the triage reasoning — see buildSeverityInput below.
 *
 * Deterministic: no LLM involvement in severity, by design.
 */
import type { Priority, Severity, TriageResult } from '../shared/types.js';

interface SeverityRule {
  level: Severity;
  keywords: string[];
}

/** Ported verbatim from bug-report-generator/src/severity.js, lowercased. */
export const SEVERITY_RULES: SeverityRule[] = [
  {
    level: 'critical',
    keywords: ['crash', 'data loss', 'security', 'cannot log in', 'payment fail'],
  },
  { level: 'high', keywords: ['error', 'exception', 'broken', 'not working', 'fails'] },
  { level: 'medium', keywords: ['incorrect', 'unexpected', 'mismatch', 'wrong'] },
  { level: 'low', keywords: ['typo', 'misaligned', 'cosmetic', 'spacing', 'color'] },
];

/**
 * The original heuristic, preserved: first matching rule wins, defaulting to
 * medium when nothing matches.
 */
export function suggestSeverity(text = ''): Severity {
  const lower = text.toLowerCase();
  for (const rule of SEVERITY_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) return rule.level;
  }
  return 'medium';
}

/**
 * Assemble the text the keyword rules score.
 *
 * Adaptation layer only — the scoring itself is untouched.
 */
export function buildSeverityInput(
  title: string,
  errorMessage: string,
  triage: TriageResult,
): string {
  return [title, errorMessage, triage.reasoning].filter(Boolean).join('\n');
}

/**
 * Final severity for a filed bug.
 *
 * The keyword heuristic supplies the base level; the test case's own priority
 * raises it when the planner considered the flow critical. A critical-path
 * failure should never be filed as low just because its error text happened to
 * lack a matching keyword.
 */
export function resolveSeverity(text: string, testPriority: Priority | undefined): Severity {
  const base = suggestSeverity(text);
  if (!testPriority) return base;

  const rank: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return rank[testPriority] > rank[base] ? testPriority : base;
}
