/**
 * Triage — validation of the model's verdict.
 *
 * Pure and deterministic, so the classification contract can be tested without
 * any model involvement. The AI decides the verdict; this file only guarantees
 * the verdict is well-formed before anything downstream acts on it.
 */
import type { TriageResult, TriageVerdict } from '../shared/types.js';
import { TRIAGE_VERDICTS } from '../shared/types.js';

export type TriageValidation = { ok: true; result: TriageResult } | { ok: false; problem: string };

/** Strip fences / prose and isolate the JSON object. */
export function extractJsonObject(raw: string): string {
  let text = raw.trim();
  text = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (text.startsWith('{')) return text;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

export function validateTriageResponse(raw: string, testCaseId: string): TriageValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch (err) {
    return { ok: false, problem: `Response was not valid JSON: ${(err as Error).message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, problem: 'Expected a single JSON object.' };
  }
  const item = parsed as Record<string, unknown>;

  const verdict = item['verdict'];
  if (typeof verdict !== 'string' || !(TRIAGE_VERDICTS as readonly string[]).includes(verdict)) {
    return {
      ok: false,
      problem: `verdict must be one of ${TRIAGE_VERDICTS.join(' | ')} — got ${JSON.stringify(verdict)}.`,
    };
  }

  const rawConfidence = item['confidence'];
  const confidence = typeof rawConfidence === 'number' ? rawConfidence : Number(rawConfidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return {
      ok: false,
      problem: `confidence must be a number between 0 and 1 — got ${JSON.stringify(rawConfidence)}.`,
    };
  }

  const reasoning = item['reasoning'];
  if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
    return { ok: false, problem: 'reasoning must be a non-empty string.' };
  }

  const result: TriageResult = {
    testCaseId,
    verdict: verdict as TriageVerdict,
    confidence: Math.round(confidence * 100) / 100,
    reasoning: reasoning.trim(),
  };

  // suggestedFix is meaningful only for selector drift. Dropping it elsewhere
  // keeps the dashboard's "pending review" list honest.
  const suggestedFix = item['suggestedFix'];
  if (
    result.verdict === 'selector_drift' &&
    typeof suggestedFix === 'string' &&
    suggestedFix.trim()
  ) {
    result.suggestedFix = suggestedFix.trim();
  }

  return { ok: true, result };
}

/** Count verdicts for the dashboard's triage breakdown chart. */
export function summarizeVerdicts(results: TriageResult[]): Record<TriageVerdict, number> {
  const counts: Record<TriageVerdict, number> = {
    real_bug: 0,
    flaky: 0,
    selector_drift: 0,
    environment_issue: 0,
  };
  for (const result of results) counts[result.verdict] += 1;
  return counts;
}

/** Selector-drift results carrying a fix, for human review. Never auto-applied. */
export function pendingSelfHeals(results: TriageResult[]): TriageResult[] {
  return results.filter((r) => r.verdict === 'selector_drift' && r.suggestedFix);
}
