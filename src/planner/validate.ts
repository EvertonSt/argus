/**
 * Planner — schema validation.
 *
 * Ported and hardened from the AI Test Case Generator's `parseTestCases`,
 * which did `JSON.parse` after stripping fences and only checked that the
 * result was an array. That was fine for a tool whose output a human read
 * next; here the output feeds a code generator, so every field is validated
 * and violations are reported precisely enough to feed back into a retry
 * prompt.
 *
 * Pure and deterministic — no LLM calls in this file.
 */
import type { Feature, Priority, TestCase } from '../shared/types.js';
import { PRIORITIES } from '../shared/types.js';
import { slugify } from '../shared/storage.js';

export interface ValidationIssue {
  index: number;
  field: string;
  problem: string;
}

export type ValidationResult =
  | { ok: true; testCases: TestCase[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Strip markdown fences and any prose the model wrapped around the JSON.
 * Ported from the original `parseTestCases`, extended to recover a JSON array
 * embedded in surrounding text rather than giving up on it.
 */
export function extractJsonArray(raw: string): string {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  text = text.trim();
  if (text.startsWith('[')) return text;

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate a raw model response into TestCase[].
 *
 * Never silently drops an invalid entry — every problem is collected and
 * returned so the caller can either retry with specifics or fail loudly.
 */
export function validateTestCases(raw: string, knownFeatures: Feature[]): ValidationResult {
  const featureIds = new Set(knownFeatures.map((f) => f.id));
  const issues: ValidationIssue[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonArray(raw));
  } catch (err) {
    return {
      ok: false,
      issues: [
        {
          index: -1,
          field: 'response',
          problem: `Response was not valid JSON: ${(err as Error).message}`,
        },
      ],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      issues: [{ index: -1, field: 'response', problem: 'Expected a JSON array of test cases.' }],
    };
  }
  if (parsed.length === 0) {
    return {
      ok: false,
      issues: [{ index: -1, field: 'response', problem: 'Returned an empty array.' }],
    };
  }

  const testCases: TestCase[] = [];
  const seenIds = new Set<string>();

  parsed.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      issues.push({ index, field: 'entry', problem: 'Not an object.' });
      return;
    }
    const item = entry as Record<string, unknown>;

    if (!isNonEmptyString(item['title'])) {
      issues.push({ index, field: 'title', problem: 'Missing or empty.' });
    }
    if (!isNonEmptyString(item['featureId'])) {
      issues.push({ index, field: 'featureId', problem: 'Missing or empty.' });
    } else if (!featureIds.has(item['featureId'])) {
      issues.push({
        index,
        field: 'featureId',
        problem:
          `"${item['featureId']}" is not a known feature id. ` +
          `Valid ids: ${[...featureIds].join(', ')}.`,
      });
    }

    const priority = item['priority'];
    if (!isNonEmptyString(priority) || !(PRIORITIES as readonly string[]).includes(priority)) {
      issues.push({
        index,
        field: 'priority',
        problem: `Must be one of ${PRIORITIES.join(' | ')} — got ${JSON.stringify(priority)}.`,
      });
    }

    const gherkin = item['gherkin'];
    if (typeof gherkin !== 'object' || gherkin === null) {
      issues.push({ index, field: 'gherkin', problem: 'Missing object with given/when/then.' });
    } else {
      const g = gherkin as Record<string, unknown>;
      for (const key of ['given', 'when', 'then'] as const) {
        if (!isNonEmptyString(g[key])) {
          issues.push({ index, field: `gherkin.${key}`, problem: 'Missing or empty.' });
        }
      }
    }

    if (!isNonEmptyString(item['targetRoute'])) {
      issues.push({ index, field: 'targetRoute', problem: 'Missing or empty.' });
    }

    if (issues.some((issue) => issue.index === index)) return;

    const g = gherkin as Record<string, string>;
    const title = (item['title'] as string).trim();
    const baseId = isNonEmptyString(item['id']) ? slugify(item['id']) : slugify(title);
    let id = baseId;
    let n = 2;
    while (seenIds.has(id)) id = `${baseId}-${n++}`;
    seenIds.add(id);

    testCases.push({
      id,
      featureId: (item['featureId'] as string).trim(),
      title,
      priority: priority as Priority,
      gherkin: {
        given: g['given']?.trim() as string,
        when: g['when']?.trim() as string,
        then: g['then']?.trim() as string,
      },
      targetRoute: (item['targetRoute'] as string).trim(),
    });
  });

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, testCases };
}

/** Render issues into a correction message appended to the retry prompt. */
export function describeIssues(issues: ValidationIssue[]): string {
  return issues
    .map((issue) =>
      issue.index === -1
        ? `- ${issue.field}: ${issue.problem}`
        : `- item[${issue.index}].${issue.field}: ${issue.problem}`,
    )
    .join('\n');
}

/** Sort so the highest-priority cases run (and are read) first. */
export function sortByPriority(testCases: TestCase[]): TestCase[] {
  const rank: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...testCases].sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export function countByPriority(testCases: TestCase[]): Record<Priority, number> {
  const counts: Record<Priority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const tc of testCases) counts[tc.priority] += 1;
  return counts;
}
