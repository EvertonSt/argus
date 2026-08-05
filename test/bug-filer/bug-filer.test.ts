import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSeverityInput,
  resolveSeverity,
  suggestSeverity,
} from '../../src/bug-filer/severity.js';
import { checkDuplicate, findDuplicate } from '../../src/bug-filer/duplicate-check.js';
import { formatEnvironment, getEnvironmentInfo } from '../../src/bug-filer/environment.js';
import { buildBugTitle, buildReproSteps, fileBugs, newBugs } from '../../src/bug-filer/index.js';
import type { FiledBug, RunSummary, TestCase, TriageResult } from '../../src/shared/types.js';

describe('suggestSeverity (ported keyword heuristic)', () => {
  it('scores a crash as critical', () => {
    expect(suggestSeverity('The app crash happens on save')).toBe('critical');
  });

  it('scores data loss as critical', () => {
    expect(suggestSeverity('Possible data loss when deleting')).toBe('critical');
  });

  it('scores an exception as high', () => {
    expect(suggestSeverity('Uncaught exception in handler')).toBe('high');
  });

  it('scores "not working" as high', () => {
    expect(suggestSeverity('The toggle is not working')).toBe('high');
  });

  it('scores an incorrect value as medium', () => {
    expect(suggestSeverity('The count is incorrect')).toBe('medium');
  });

  it('scores a typo as low', () => {
    expect(suggestSeverity('Small typo in the header')).toBe('low');
  });

  it('defaults to medium when nothing matches', () => {
    expect(suggestSeverity('something entirely unremarkable')).toBe('medium');
  });

  it('is case insensitive', () => {
    expect(suggestSeverity('CRASH on startup')).toBe('critical');
  });

  it('defaults to medium for empty input', () => {
    expect(suggestSeverity('')).toBe('medium');
  });

  it('applies rules in priority order, critical beating high', () => {
    expect(suggestSeverity('an error causing a crash')).toBe('critical');
  });
});

describe('buildSeverityInput', () => {
  it('combines title, error, and triage reasoning', () => {
    const text = buildSeverityInput('Title here', 'Error text', {
      testCaseId: 'x',
      verdict: 'real_bug',
      confidence: 1,
      reasoning: 'Reason text',
    });
    expect(text).toContain('Title here');
    expect(text).toContain('Error text');
    expect(text).toContain('Reason text');
  });
});

describe('resolveSeverity', () => {
  it('keeps the keyword verdict when the test priority is lower', () => {
    expect(resolveSeverity('a crash occurred', 'low')).toBe('critical');
  });

  it('raises severity to match a critical test priority', () => {
    expect(resolveSeverity('the value is incorrect', 'critical')).toBe('critical');
  });

  it('leaves severity alone when no priority is supplied', () => {
    expect(resolveSeverity('a typo', undefined)).toBe('low');
  });

  it('does not lower severity for a low-priority test', () => {
    expect(resolveSeverity('data loss detected', 'low')).toBe('critical');
  });
});

describe('checkDuplicate (ported string-similarity matching)', () => {
  const existing: FiledBug[] = [
    {
      id: 'BUG-1',
      testCaseId: 'tc-1',
      title: 'Deleting a task removes the wrong task',
      severity: 'high',
      environment: 'test',
      reproSteps: [],
      filedAt: '2026-01-01T00:00:00.000Z',
      runId: 'r1',
    },
    {
      id: 'BUG-2',
      testCaseId: 'tc-2',
      title: 'Stats page shows an incorrect completion percentage',
      severity: 'medium',
      environment: 'test',
      reproSteps: [],
      filedAt: '2026-01-01T00:00:00.000Z',
      runId: 'r1',
    },
  ];

  it('returns nothing when there are no existing bugs', () => {
    expect(checkDuplicate('anything', [])).toEqual([]);
  });

  it('matches a near-identical title', () => {
    const matches = checkDuplicate('Deleting a task removes the wrong task', existing);
    expect(matches[0]?.id).toBe('BUG-1');
  });

  it('scores an exact match at 1', () => {
    const matches = checkDuplicate('Deleting a task removes the wrong task', existing);
    expect(matches[0]?.score).toBe(1);
  });

  it('does not match an unrelated title', () => {
    expect(checkDuplicate('Login button is misaligned on mobile', existing)).toEqual([]);
  });

  it('sorts matches best-first', () => {
    const matches = checkDuplicate('Deleting a task removes the wrong task from the list', existing);
    if (matches.length > 1) {
      expect(matches[0]!.score).toBeGreaterThanOrEqual(matches[1]!.score);
    }
    expect(matches[0]?.id).toBe('BUG-1');
  });

  it('respects a custom threshold', () => {
    const strict = checkDuplicate('Deleting a task removes wrong item', existing, 0.99);
    expect(strict).toEqual([]);
  });

  it('findDuplicate returns the single best match', () => {
    expect(findDuplicate('Deleting a task removes the wrong task', existing)?.id).toBe('BUG-1');
  });

  it('findDuplicate returns null when nothing is similar enough', () => {
    expect(findDuplicate('Totally unrelated heading colour', existing)).toBeNull();
  });
});

describe('environment detection', () => {
  it('reports an OS, CPU, RAM, browser, and Node version', async () => {
    const info = await getEnvironmentInfo();
    expect(info.os.length).toBeGreaterThan(0);
    expect(info.cpu.length).toBeGreaterThan(0);
    expect(info.browser.length).toBeGreaterThan(0);
    expect(info.node).toMatch(/^v\d+/);
  });

  it('formats a one-line environment string', () => {
    const text = formatEnvironment({
      os: 'Windows 10',
      cpu: 'Intel',
      ramGB: 16,
      browser: 'Chromium',
      node: 'v22.0.0',
    });
    expect(text).toBe('Windows 10 · Intel · 16GB RAM · Chromium · Node v22.0.0');
  });
});

describe('report building', () => {
  const testCase: TestCase = {
    id: 'tc-1',
    featureId: 'f',
    title: 'Deleting a task removes the clicked task',
    priority: 'critical',
    gherkin: { given: 'two tasks', when: 'I click delete', then: 'one remains' },
    targetRoute: '/',
  };

  it('builds a descriptive bug title from the test case', () => {
    expect(buildBugTitle(testCase, 'tc-1')).toContain('Deleting a task removes the clicked task');
  });

  it('adds no boilerplate suffix that would inflate dedupe similarity', () => {
    // Regression: a shared "— fails against the application" suffix once made
    // three unrelated bugs score 0.61 against each other, so two real defects
    // were silently discarded as duplicates.
    expect(buildBugTitle(testCase, 'tc-1')).toBe(testCase.title);
  });

  it('keeps distinct test cases distinct enough to survive dedupe', () => {
    const a = buildBugTitle(testCase, 'tc-1');
    const b = buildBugTitle(
      { ...testCase, id: 'tc-2', title: 'Submitting an empty task is rejected' },
      'tc-2',
    );
    expect(findDuplicate(b, [
      {
        id: 'BUG-A',
        testCaseId: 'tc-1',
        title: a,
        severity: 'high',
        environment: 'e',
        reproSteps: [],
        filedAt: 'now',
        runId: 'r',
      },
    ])).toBeNull();
  });

  it('falls back to the id when the test case is unknown', () => {
    expect(buildBugTitle(undefined, 'tc-9')).toBe('Failure in tc-9');
  });

  it('derives repro steps from the Gherkin clauses', () => {
    const steps = buildReproSteps(testCase, '/');
    expect(steps[0]).toBe('Navigate to /');
    expect(steps[1]).toContain('two tasks');
    expect(steps[3]).toContain('one remains');
  });

  it('produces generic repro steps without a test case', () => {
    expect(buildReproSteps(undefined, '/x')).toHaveLength(2);
  });
});

describe('fileBugs', () => {
  const testCases: TestCase[] = [
    {
      id: 'delete-wrong-task',
      featureId: 'f1',
      title: 'Deleting a task removes the task that was clicked',
      priority: 'critical',
      gherkin: { given: 'two identical tasks', when: 'I click delete', then: 'count is 2' },
      targetRoute: '/',
    },
    {
      id: 'empty-task',
      featureId: 'f2',
      title: 'Submitting an empty task is rejected',
      priority: 'medium',
      gherkin: { given: 'empty input', when: 'I submit', then: 'no task is created' },
      targetRoute: '/',
    },
  ];

  const summary: RunSummary = {
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    total: 2,
    passed: 0,
    failed: 2,
    failures: [
      { testCaseId: 'delete-wrong-task', errorMessage: 'expect(locator).toHaveCount failed' },
      { testCaseId: 'empty-task', errorMessage: 'expect(locator).toHaveCount failed' },
    ],
  };

  const triage: TriageResult[] = [
    { testCaseId: 'delete-wrong-task', verdict: 'real_bug', confidence: 0.9, reasoning: 'wrong row removed' },
    { testCaseId: 'empty-task', verdict: 'real_bug', confidence: 0.8, reasoning: 'validation missing' },
    { testCaseId: 'other', verdict: 'flaky', confidence: 0.6, reasoning: 'timing' },
  ];

  const tmpBugsPath = (): string =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'argus-bugs-')), 'bugs.json');

  it('files one bug per real_bug verdict only', async () => {
    const bugs = await fileBugs(triage, {
      runId: 'run-1',
      summary,
      testCases,
      bugsPath: tmpBugsPath(),
    });
    expect(bugs).toHaveLength(2);
  });

  it('never files a bug for a flaky verdict', async () => {
    const bugs = await fileBugs(triage, {
      runId: 'run-1',
      summary,
      testCases,
      bugsPath: tmpBugsPath(),
    });
    expect(bugs.some((b) => b.testCaseId === 'other')).toBe(false);
  });

  it('files nothing when triage found no real bugs', async () => {
    const bugs = await fileBugs([triage[2]!], {
      runId: 'run-1',
      summary,
      testCases,
      bugsPath: tmpBugsPath(),
    });
    expect(bugs).toEqual([]);
  });

  it('raises severity to critical for a critical-priority test case', async () => {
    const bugs = await fileBugs(triage, {
      runId: 'run-1',
      summary,
      testCases,
      bugsPath: tmpBugsPath(),
    });
    const bug = bugs.find((b) => b.testCaseId === 'delete-wrong-task');
    expect(bug?.severity).toBe('critical');
  });

  it('persists filed bugs to disk as readable JSON', async () => {
    const bugsPath = tmpBugsPath();
    await fileBugs(triage, { runId: 'run-1', summary, testCases, bugsPath });
    const stored = JSON.parse(fs.readFileSync(bugsPath, 'utf-8')) as FiledBug[];
    expect(stored).toHaveLength(2);
    expect(stored[0]).toHaveProperty('reproSteps');
  });

  it('appends to existing bugs rather than overwriting them', async () => {
    const bugsPath = tmpBugsPath();
    await fileBugs(triage, { runId: 'run-1', summary, testCases, bugsPath });
    await fileBugs(triage, { runId: 'run-2', summary, testCases, bugsPath });
    const stored = JSON.parse(fs.readFileSync(bugsPath, 'utf-8')) as FiledBug[];
    expect(stored).toHaveLength(4);
  });

  it('flags a re-filed bug as a duplicate of the original', async () => {
    const bugsPath = tmpBugsPath();
    await fileBugs(triage, { runId: 'run-1', summary, testCases, bugsPath });
    const second = await fileBugs(triage, { runId: 'run-2', summary, testCases, bugsPath });
    expect(second[0]?.isDuplicateOf).toBeTruthy();
    expect(second[0]?.duplicateScore).toBe(1);
  });

  it('does not flag the first occurrence as a duplicate', async () => {
    const bugs = await fileBugs(triage, {
      runId: 'run-1',
      summary,
      testCases,
      bugsPath: tmpBugsPath(),
    });
    expect(bugs[0]?.isDuplicateOf).toBeUndefined();
  });

  it('records the environment on every filed bug', async () => {
    const bugs = await fileBugs(triage, {
      runId: 'run-1',
      summary,
      testCases,
      bugsPath: tmpBugsPath(),
    });
    expect(bugs[0]?.environment).toContain('Node');
  });

  it('links each bug back to the run that produced it', async () => {
    const bugs = await fileBugs(triage, {
      runId: 'run-xyz',
      summary,
      testCases,
      bugsPath: tmpBugsPath(),
    });
    expect(bugs.every((b) => b.runId === 'run-xyz')).toBe(true);
  });
});

describe('newBugs', () => {
  it('excludes duplicates', () => {
    const bugs = [{ id: 'a' }, { id: 'b', isDuplicateOf: 'a' }] as FiledBug[];
    expect(newBugs(bugs)).toHaveLength(1);
  });
});
