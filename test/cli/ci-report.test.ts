import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bugsBySeverity, renderPrComment, renderStepSummary, type CiReportInput } from '../../src/cli/ci-report.js';
import { meetsThreshold } from '../../src/shared/config.js';
import type { FiledBug } from '../../src/shared/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const base: CiReportInput = {
  runId: 'run-1',
  timestamp: '2026-08-05T18:00:00.000Z',
  mode: 'live',
  target: 'http://localhost:4317',
  threshold: 'high',
  aiCalls: 5,
  inventory: { source: 'crawl', features: [{ id: 'f', name: 'F', description: 'd', routes: ['/'] }] },
  testCases: [
    {
      id: 'delete-wrong-task',
      featureId: 'f',
      title: 'Deleting a task removes the clicked task',
      priority: 'critical',
      gherkin: { given: 'g', when: 'w', then: 't' },
      targetRoute: '/',
    },
  ],
  summary: {
    runId: 'run-1',
    timestamp: '2026-08-05T18:00:00.000Z',
    total: 8,
    passed: 5,
    failed: 3,
    failures: [],
  },
  triage: [
    { testCaseId: 'delete-wrong-task', verdict: 'real_bug', confidence: 0.94, reasoning: 'wrong row deleted' },
    { testCaseId: 'stats', verdict: 'flaky', confidence: 0.6, reasoning: 'ordering noise' },
    {
      testCaseId: 'add-btn',
      verdict: 'selector_drift',
      confidence: 0.8,
      reasoning: 'button renamed',
      suggestedFix: "use getByRole('button', { name: 'Create task' })",
    },
  ],
  filedBugs: [
    {
      id: 'BUG-1',
      testCaseId: 'delete-wrong-task',
      title: 'Deleting a task removes the clicked task',
      severity: 'critical',
      environment: 'ubuntu',
      reproSteps: ['Navigate to /'],
      filedAt: '2026-08-05T18:00:00.000Z',
      runId: 'run-1',
    },
  ],
  gateFailed: true,
  gateReason: '1 new bug(s) at or above "high" severity',
};

describe('renderPrComment', () => {
  it('leads with a blocked headline when the gate failed', () => {
    expect(renderPrComment(base)).toContain('merge blocked');
  });

  it('leads with an all-clear headline when nothing failed', () => {
    const clean: CiReportInput = {
      ...base,
      summary: { ...base.summary, failed: 0, passed: 8 },
      triage: [],
      filedBugs: [],
      gateFailed: false,
      gateReason: 'no new bugs',
    };
    expect(renderPrComment(clean)).toContain('all clear');
  });

  it('distinguishes "failures found" from "merge blocked"', () => {
    // The central design point: failures that are not real bugs report, but
    // do not block.
    const notBlocking: CiReportInput = { ...base, gateFailed: false, filedBugs: [] };
    const comment = renderPrComment(notBlocking);
    expect(comment).toContain('merge not blocked');
    expect(comment).not.toContain('merge blocked');
  });

  it('reports the pass count', () => {
    expect(renderPrComment(base)).toContain('**5/8 tests passed**');
  });

  it('breaks triage down in a table', () => {
    const comment = renderPrComment(base);
    expect(comment).toContain('| Triage verdict | Count | Blocks merge? |');
    expect(comment).toContain('Real bug');
  });

  it('marks only real bugs as merge-blocking in the table', () => {
    const comment = renderPrComment(base);
    const flakyRow = comment.split('\n').find((line) => line.includes('Flaky'));
    expect(flakyRow).toContain('| no |');
  });

  it('lists newly filed bugs with severity', () => {
    expect(renderPrComment(base)).toContain('**critical** — Deleting a task removes the clicked task');
  });

  it('notes duplicates without listing them as new', () => {
    const withDup: CiReportInput = {
      ...base,
      filedBugs: [...base.filedBugs, { ...base.filedBugs[0]!, id: 'BUG-2', isDuplicateOf: 'BUG-1' }],
    };
    expect(renderPrComment(withDup)).toContain('1 further failure(s) matched an already-filed bug');
  });

  it('includes self-heal suggestions in a collapsed section', () => {
    const comment = renderPrComment(base);
    expect(comment).toContain('Self-heal suggestions (human review required)');
    expect(comment).toContain('Create task');
  });

  it('includes the triage reasoning', () => {
    expect(renderPrComment(base)).toContain('wrong row deleted');
  });

  it('states the gate reason and threshold', () => {
    const comment = renderPrComment(base);
    expect(comment).toContain('**Gate:**');
    expect(comment).toContain('`high`');
  });

  it('explains that flaky and drift never block', () => {
    expect(renderPrComment(base)).toContain('never block a merge');
  });

  it('omits the bug section entirely when nothing was filed', () => {
    const none: CiReportInput = { ...base, filedBugs: [] };
    expect(renderPrComment(none)).not.toContain('Newly filed bugs');
  });
});

describe('renderStepSummary', () => {
  it('summarises the run in one line', () => {
    expect(renderStepSummary(base)).toBe('Argus: 5/8 passed, 1 new bug(s), gate FAILED');
  });
});

describe('bugsBySeverity', () => {
  it('counts bugs per severity level', () => {
    const bugs = [{ severity: 'critical' }, { severity: 'high' }, { severity: 'high' }] as FiledBug[];
    expect(bugsBySeverity(bugs)).toEqual({ critical: 1, high: 2, medium: 0, low: 0 });
  });
});

describe('meetsThreshold (the CI gate rule)', () => {
  it('blocks a critical bug at a high threshold', () => {
    expect(meetsThreshold('critical', 'high')).toBe(true);
  });

  it('blocks a high bug at a high threshold', () => {
    expect(meetsThreshold('high', 'high')).toBe(true);
  });

  it('does not block a medium bug at a high threshold', () => {
    expect(meetsThreshold('medium', 'high')).toBe(false);
  });

  it('blocks everything at a low threshold', () => {
    expect(meetsThreshold('low', 'low')).toBe(true);
  });

  it('blocks only critical at a critical threshold', () => {
    expect(meetsThreshold('high', 'critical')).toBe(false);
    expect(meetsThreshold('critical', 'critical')).toBe(true);
  });
});

describe('GitHub Actions workflow', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'argus.yml'), 'utf-8');

  it('triggers on pull requests', () => {
    expect(workflow).toContain('pull_request:');
  });

  it('grants the permission needed to comment on a PR', () => {
    expect(workflow).toContain('pull-requests: write');
  });

  it('runs the unit suite before spending anything on AI', () => {
    expect(workflow.indexOf('npm test')).toBeLessThan(workflow.indexOf('Run Argus'));
  });

  it('installs the Playwright browser', () => {
    expect(workflow).toContain('npx playwright install');
  });

  it('starts the demo app and waits for it', () => {
    expect(workflow).toContain('npm run demo');
    expect(workflow).toContain('wait-on');
  });

  it('falls back to mock mode when no API key is present', () => {
    // Forks and Dependabot cannot read secrets; without this they would get a
    // red X they have no way to fix.
    expect(workflow).toContain('--mock');
    expect(workflow).toContain('if [ -n "$ANTHROPIC_API_KEY" ]');
  });

  it('posts the comment before enforcing the gate', () => {
    expect(workflow.indexOf('Post the PR comment')).toBeLessThan(
      workflow.indexOf('Enforce the severity gate'),
    );
  });

  it('updates its existing comment rather than stacking new ones', () => {
    expect(workflow).toContain('updateComment');
    expect(workflow).toContain('argus-report');
  });

  it('uploads run artifacts for inspection', () => {
    expect(workflow).toContain('upload-artifact');
  });

  it('makes the severity threshold configurable', () => {
    expect(workflow).toContain('ARGUS_SEVERITY_FAIL_THRESHOLD');
  });
});
