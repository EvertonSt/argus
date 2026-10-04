import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractJsonObject,
  pendingSelfHeals,
  summarizeVerdicts,
  validateTriageResponse,
} from '../../src/triage/validate.js';
import { buildTriagePrompt, TRIAGE_SYSTEM_PROMPT } from '../../src/triage/prompt.js';
import { triageFailures } from '../../src/triage/index.js';
import { MockAiClient } from '../../src/shared/ai-client.js';
import type { RunSummary, TestCase, TriageResult } from '../../src/shared/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'fixtures');

const testCases: TestCase[] = [
  {
    id: 'delete-removes-clicked-task',
    featureId: 'home-button-delete',
    title: 'Deleting a task removes the task that was clicked',
    priority: 'critical',
    gherkin: { given: 'two identical tasks', when: 'I click delete', then: 'count is 2' },
    targetRoute: '/',
  },
  {
    id: 'stats-page-shows-totals',
    featureId: 'stats-page',
    title: 'The stats page reports a total task count',
    priority: 'medium',
    gherkin: { given: 'on stats', when: 'loaded', then: 'total is 3' },
    targetRoute: '/stats',
  },
];

const summary: RunSummary = {
  runId: 'run-test',
  timestamp: new Date().toISOString(),
  total: 8,
  passed: 6,
  failed: 2,
  failures: [
    {
      testCaseId: 'delete-removes-clicked-task',
      errorMessage: 'Error: expect(locator).toHaveCount(expected) failed. Expected 2, received 3.',
      screenshotPath: 'data/runs/x/shot.png',
    },
    {
      testCaseId: 'stats-page-shows-totals',
      errorMessage:
        'Error: expect(locator).toHaveText(expected) failed. Expected "3", received "4".',
    },
  ],
};

describe('extractJsonObject', () => {
  it('passes through a bare object', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('strips ```json fences', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('recovers an object embedded in prose', () => {
    expect(extractJsonObject('Sure:\n{"a":1}\nDone.')).toBe('{"a":1}');
  });
});

describe('validateTriageResponse', () => {
  const good = JSON.stringify({
    verdict: 'real_bug',
    confidence: 0.9,
    reasoning: 'The app deleted the wrong row.',
  });

  it('accepts a well-formed verdict', () => {
    const result = validateTriageResponse(good, 'tc-1');
    expect(result.ok).toBe(true);
  });

  it('attaches the test case id supplied by the caller', () => {
    const result = validateTriageResponse(good, 'tc-1');
    if (!result.ok) throw new Error('expected ok');
    expect(result.result.testCaseId).toBe('tc-1');
  });

  it('rejects an unknown verdict', () => {
    const result = validateTriageResponse(
      JSON.stringify({ verdict: 'maybe', confidence: 0.5, reasoning: 'x' }),
      'tc',
    );
    expect(result.ok).toBe(false);
  });

  it('rejects confidence above 1', () => {
    const result = validateTriageResponse(
      JSON.stringify({ verdict: 'flaky', confidence: 5, reasoning: 'x' }),
      'tc',
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a missing reasoning', () => {
    const result = validateTriageResponse(
      JSON.stringify({ verdict: 'flaky', confidence: 0.5 }),
      'tc',
    );
    expect(result.ok).toBe(false);
  });

  it('rejects malformed JSON', () => {
    expect(validateTriageResponse('not json', 'tc').ok).toBe(false);
  });

  it('rejects an array', () => {
    expect(validateTriageResponse('[{"verdict":"flaky"}]', 'tc').ok).toBe(false);
  });

  it('coerces a numeric-string confidence', () => {
    const result = validateTriageResponse(
      JSON.stringify({ verdict: 'flaky', confidence: '0.4', reasoning: 'x' }),
      'tc',
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.result.confidence).toBe(0.4);
  });

  it('keeps suggestedFix for a selector_drift verdict', () => {
    const result = validateTriageResponse(
      JSON.stringify({
        verdict: 'selector_drift',
        confidence: 0.8,
        reasoning: 'stale locator',
        suggestedFix: "use getByRole('button', { name: 'Create task' })",
      }),
      'tc',
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.result.suggestedFix).toContain('Create task');
  });

  it('drops suggestedFix on a real_bug verdict, where it is meaningless', () => {
    const result = validateTriageResponse(
      JSON.stringify({
        verdict: 'real_bug',
        confidence: 0.8,
        reasoning: 'app is wrong',
        suggestedFix: 'change the selector',
      }),
      'tc',
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.result.suggestedFix).toBeUndefined();
  });
});

describe('summarizeVerdicts', () => {
  it('counts each verdict category', () => {
    const results = [
      { verdict: 'real_bug' },
      { verdict: 'real_bug' },
      { verdict: 'flaky' },
    ] as TriageResult[];
    expect(summarizeVerdicts(results)).toEqual({
      real_bug: 2,
      flaky: 1,
      selector_drift: 0,
      environment_issue: 0,
    });
  });

  it('returns all-zero counts for an empty list', () => {
    expect(summarizeVerdicts([])).toEqual({
      real_bug: 0,
      flaky: 0,
      selector_drift: 0,
      environment_issue: 0,
    });
  });
});

describe('pendingSelfHeals', () => {
  it('returns only selector_drift results carrying a fix', () => {
    const results = [
      { verdict: 'selector_drift', suggestedFix: 'do this' },
      { verdict: 'selector_drift' },
      { verdict: 'real_bug', suggestedFix: 'ignored' },
    ] as TriageResult[];
    expect(pendingSelfHeals(results)).toHaveLength(1);
  });
});

describe('buildTriagePrompt', () => {
  const failure = summary.failures[0]!;

  it('includes the original test intent', () => {
    const prompt = buildTriagePrompt(failure, testCases[0]);
    expect(prompt).toContain('Deleting a task removes the task that was clicked');
    expect(prompt).toContain('Given two identical tasks');
  });

  it('includes the Playwright error text', () => {
    expect(buildTriagePrompt(failure, testCases[0])).toContain('toHaveCount');
  });

  it('lists captured artifacts', () => {
    expect(buildTriagePrompt(failure, testCases[0])).toContain('screenshot: data/runs/x/shot.png');
  });

  it('notes when no DOM snapshot was captured', () => {
    expect(buildTriagePrompt(failure, testCases[0])).toContain('No DOM snapshot');
  });

  it('includes the DOM snapshot when present', () => {
    const withDom = { ...failure, domSnapshot: '<ul><li>Task</li></ul>' };
    expect(buildTriagePrompt(withDom, testCases[0])).toContain('<li>Task</li>');
  });

  it('degrades gracefully when the test case is unknown', () => {
    expect(buildTriagePrompt(failure, undefined)).toContain('original intent unavailable');
  });
});

describe('TRIAGE_SYSTEM_PROMPT', () => {
  it('defines all four categories explicitly', () => {
    for (const verdict of ['real_bug', 'selector_drift', 'flaky', 'environment_issue']) {
      expect(TRIAGE_SYSTEM_PROMPT).toContain(verdict);
    }
  });

  it('states the wrong-value vs missing-element distinction', () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain('WRONG VALUE');
  });
});

describe('triageFailures (fixture-backed — no live API calls)', () => {
  it('returns one verdict per failure', async () => {
    const ai = new MockAiClient(FIXTURES);
    const results = await triageFailures(summary, { ai, testCases, fixturesDir: FIXTURES });
    expect(results).toHaveLength(2);
  });

  it('classifies the wrong-item deletion as a real bug', async () => {
    const ai = new MockAiClient(FIXTURES);
    const results = await triageFailures(summary, { ai, testCases, fixturesDir: FIXTURES });
    const deleteVerdict = results.find((r) => r.testCaseId === 'delete-removes-clicked-task');
    expect(deleteVerdict?.verdict).toBe('real_bug');
  });

  it('distinguishes a non-bug failure from a real bug in the same run', async () => {
    const ai = new MockAiClient(FIXTURES);
    const results = await triageFailures(summary, { ai, testCases, fixturesDir: FIXTURES });
    const stats = results.find((r) => r.testCaseId === 'stats-page-shows-totals');
    expect(stats?.verdict).not.toBe('real_bug');
  });

  it('returns nothing when there were no failures', async () => {
    const clean: RunSummary = { ...summary, failed: 0, failures: [] };
    const results = await triageFailures(clean, { ai: new MockAiClient(FIXTURES), testCases });
    expect(results).toEqual([]);
  });

  it('writes a triage log when a path is given', async () => {
    const logPath = path.join(ROOT, 'data', 'test-triage-log.json');
    await triageFailures(summary, {
      ai: new MockAiClient(FIXTURES),
      testCases,
      fixturesDir: FIXTURES,
      logPath,
    });
    const entries = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveProperty('reasoning');
    fs.unlinkSync(logPath);
  });

  it('records an unparseable response instead of dropping the failure', async () => {
    const ai = {
      id: 'mock',
      mode: 'mock' as const,
      callCount: 0,
      async complete() {
        return 'the model rambled instead of answering';
      },
    };
    const results = await triageFailures(summary, { ai, testCases });
    expect(results).toHaveLength(2);
    expect(results[0]?.verdict).toBe('environment_issue');
    expect(results[0]?.confidence).toBe(0);
  });
});
