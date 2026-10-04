import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countByPriority,
  describeIssues,
  extractJsonArray,
  sortByPriority,
  validateTestCases,
} from '../../src/planner/validate.js';
import { buildPlannerPrompt, buildRetryPrompt } from '../../src/planner/prompt.js';
import { planTestCases } from '../../src/planner/index.js';
import { MockAiClient, ArgusError } from '../../src/shared/ai-client.js';
import type { Feature, FeatureInventory, TestCase } from '../../src/shared/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'fixtures');

const inventory = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'feature-inventory.json'), 'utf-8'),
) as FeatureInventory;

const features: Feature[] = inventory.features;

describe('extractJsonArray', () => {
  it('passes through a bare JSON array', () => {
    expect(extractJsonArray('[{"a":1}]')).toBe('[{"a":1}]');
  });

  it('strips ```json fences', () => {
    expect(extractJsonArray('```json\n[{"a":1}]\n```')).toBe('[{"a":1}]');
  });

  it('strips bare ``` fences', () => {
    expect(extractJsonArray('```\n[1,2]\n```')).toBe('[1,2]');
  });

  it('recovers an array embedded in surrounding prose', () => {
    expect(extractJsonArray('Here you go:\n[{"a":1}]\nHope that helps!')).toBe('[{"a":1}]');
  });
});

describe('validateTestCases — accepting the shipped fixture', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'planner-response.json'), 'utf-8');

  it('accepts the bundled planner fixture', () => {
    const result = validateTestCases(raw, features);
    expect(result.ok).toBe(true);
  });

  it('returns every case in the fixture', () => {
    const result = validateTestCases(raw, features);
    if (!result.ok) throw new Error('expected fixture to validate');
    expect(result.testCases).toHaveLength(8);
  });

  it('preserves gherkin clauses verbatim', () => {
    const result = validateTestCases(raw, features);
    if (!result.ok) throw new Error('expected fixture to validate');
    const addCase = result.testCases.find((tc) => tc.id === 'add-task-happy-path');
    expect(addCase?.gherkin.then).toBe('I should see "Ship the release"');
  });

  it('only references feature ids that exist in the inventory', () => {
    const result = validateTestCases(raw, features);
    if (!result.ok) throw new Error('expected fixture to validate');
    const known = new Set(features.map((f) => f.id));
    for (const tc of result.testCases) expect(known.has(tc.featureId)).toBe(true);
  });
});

describe('validateTestCases — rejecting bad responses', () => {
  const valid = {
    id: 'x',
    featureId: 'home-page',
    title: 'A test',
    priority: 'high',
    gherkin: { given: 'g', when: 'w', then: 't' },
    targetRoute: '/',
  };

  const check = (entry: unknown) => validateTestCases(JSON.stringify([entry]), features);

  it('rejects non-JSON', () => {
    const result = validateTestCases('not json at all', features);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.problem).toContain('not valid JSON');
  });

  it('rejects a JSON object that is not an array', () => {
    const result = validateTestCases('{"a":1}', features);
    expect(result.ok).toBe(false);
  });

  it('rejects an empty array rather than returning zero tests', () => {
    const result = validateTestCases('[]', features);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.problem).toContain('empty array');
  });

  it('rejects an unknown featureId and lists the valid ids', () => {
    const result = check({ ...valid, featureId: 'no-such-feature' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.problem).toContain('not a known feature id');
  });

  it('rejects an invalid priority', () => {
    const result = check({ ...valid, priority: 'urgent' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.field).toBe('priority');
  });

  it('rejects a missing gherkin clause', () => {
    const result = check({ ...valid, gherkin: { given: 'g', when: 'w' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.field).toBe('gherkin.then');
  });

  it('rejects an empty title', () => {
    const result = check({ ...valid, title: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.field).toBe('title');
  });

  it('reports issues for every bad entry, not just the first', () => {
    const result = validateTestCases(
      JSON.stringify([
        { ...valid, priority: 'nope' },
        { ...valid, title: '' },
      ]),
      features,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new Set(result.issues.map((i) => i.index))).toEqual(new Set([0, 1]));
  });

  it('never silently drops an invalid entry while keeping valid ones', () => {
    const result = validateTestCases(
      JSON.stringify([valid, { ...valid, priority: 'nope' }]),
      features,
    );
    expect(result.ok).toBe(false);
  });

  it('de-duplicates ids so two cases cannot collide', () => {
    const result = validateTestCases(
      JSON.stringify([
        { ...valid, id: 'dup', title: 'First' },
        { ...valid, id: 'dup', title: 'Second' },
      ]),
      features,
    );
    if (!result.ok) throw new Error('expected valid');
    expect(result.testCases.map((tc) => tc.id)).toEqual(['dup', 'dup-2']);
  });
});

describe('describeIssues', () => {
  it('formats indexed issues for a retry prompt', () => {
    const text = describeIssues([{ index: 2, field: 'priority', problem: 'Bad value.' }]);
    expect(text).toBe('- item[2].priority: Bad value.');
  });

  it('formats response-level issues without an index', () => {
    const text = describeIssues([{ index: -1, field: 'response', problem: 'Empty.' }]);
    expect(text).toBe('- response: Empty.');
  });
});

describe('prioritisation helpers', () => {
  const cases = [
    { priority: 'low' },
    { priority: 'critical' },
    { priority: 'medium' },
    { priority: 'high' },
  ] as TestCase[];

  it('sorts critical first and low last', () => {
    expect(sortByPriority(cases).map((c) => c.priority)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ]);
  });

  it('does not mutate the input array', () => {
    const before = cases.map((c) => c.priority);
    sortByPriority(cases);
    expect(cases.map((c) => c.priority)).toEqual(before);
  });

  it('counts cases by priority', () => {
    expect(countByPriority(cases)).toEqual({ critical: 1, high: 1, medium: 1, low: 1 });
  });
});

describe('buildPlannerPrompt', () => {
  it('includes every feature id so the model can reference them', () => {
    const prompt = buildPlannerPrompt(inventory, 10);
    for (const feature of features) expect(prompt).toContain(feature.id);
  });

  it('states the requested case limit', () => {
    expect(buildPlannerPrompt(inventory, 7)).toContain('at most 7 test cases');
  });

  it('includes known selectors when the inventory has them', () => {
    expect(buildPlannerPrompt(inventory, 5)).toContain('known selectors');
  });
});

describe('buildRetryPrompt', () => {
  it('carries the original prompt plus the validation problems', () => {
    const retry = buildRetryPrompt('ORIGINAL', '- item[0].title: Missing.');
    expect(retry).toContain('ORIGINAL');
    expect(retry).toContain('- item[0].title: Missing.');
    expect(retry).toContain('rejected by schema validation');
  });
});

describe('planTestCases (against fixtures — no live API calls)', () => {
  it('plans a suite from the bundled fixture response', async () => {
    const ai = new MockAiClient(FIXTURES);
    const testCases = await planTestCases(inventory, ai);
    expect(testCases).toHaveLength(8);
    expect(ai.callCount).toBe(1);
  });

  it('returns cases sorted with critical first', async () => {
    const testCases = await planTestCases(inventory, new MockAiClient(FIXTURES));
    expect(testCases[0]?.priority).toBe('critical');
  });

  it('retries exactly once when the first response is invalid, then succeeds', async () => {
    const good = fs.readFileSync(path.join(FIXTURES, 'planner-response.json'), 'utf-8');
    let call = 0;
    const ai = {
      id: 'mock',
      mode: 'mock' as const,
      callCount: 0,
      async complete() {
        call += 1;
        return call === 1 ? '[{"title": "broken"}]' : good;
      },
    };
    const testCases = await planTestCases(inventory, ai);
    expect(call).toBe(2);
    expect(testCases).toHaveLength(8);
  });

  it('fails loudly when the retry is also invalid', async () => {
    const ai = {
      id: 'mock',
      mode: 'mock' as const,
      callCount: 0,
      async complete() {
        return '[{"title": "still broken"}]';
      },
    };
    await expect(planTestCases(inventory, ai)).rejects.toThrow(ArgusError);
  });

  it('refuses to plan against an empty inventory', async () => {
    const empty: FeatureInventory = { source: 'crawl', features: [] };
    await expect(planTestCases(empty, new MockAiClient(FIXTURES))).rejects.toThrow(
      /inventory is empty/,
    );
  });
});
