import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bugsBySeverity,
  renderPrComment,
  renderStepSummary,
  type CiReportInput,
} from '../../src/cli/ci-report.js';
import { meetsThreshold } from '../../src/shared/config.js';
import type { FiledBug } from '../../src/shared/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const base: CiReportInput = {
  runId: 'run-1',
  timestamp: '2026-08-05T18:00:00.000Z',
  mode: 'live',
  target: 'http://localhost:4317',
  provider: 'mock',
  threshold: 'high',
  aiCalls: 5,
  inventory: {
    source: 'crawl',
    features: [{ id: 'f', name: 'F', description: 'd', routes: ['/'] }],
  },
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
    {
      testCaseId: 'delete-wrong-task',
      verdict: 'real_bug',
      confidence: 0.94,
      reasoning: 'wrong row deleted',
    },
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
    expect(renderPrComment(base)).toContain(
      '**critical** — Deleting a task removes the clicked task',
    );
  });

  it('notes duplicates without listing them as new', () => {
    const withDup: CiReportInput = {
      ...base,
      filedBugs: [
        ...base.filedBugs,
        { ...base.filedBugs[0]!, id: 'BUG-2', isDuplicateOf: 'BUG-1' },
      ],
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

  it('shows baselined defects instead of hiding them', () => {
    // A green build that silently swallowed the three defects the demo app
    // ships would look identical to a build that had nothing to report. The
    // comment has to name them so a reviewer can tell the difference.
    const baselined: CiReportInput = {
      ...base,
      filedBugs: [{ ...base.filedBugs[0]!, baselinedAs: 'BASE-002' }],
      gateFailed: false,
      gateReason: 'no new bugs at or above "high" severity (1 matched the baseline)',
    };
    const comment = renderPrComment(baselined);
    expect(comment).toContain('Known defects, already baselined');
    expect(comment).toContain('BASE-002');
    expect(comment).not.toContain('Newly filed bugs');
  });

  it('does not block on a baselined defect at critical severity', () => {
    const baselined: CiReportInput = {
      ...base,
      filedBugs: [{ ...base.filedBugs[0]!, baselinedAs: 'BASE-002' }],
      gateFailed: false,
      gateReason: 'no new bugs at or above "high" severity (1 matched the baseline)',
    };
    const comment = renderPrComment(baselined);
    expect(comment).toContain('merge not blocked');
    expect(comment).not.toContain('merge blocked');
  });

  it('lists a new bug and a baselined one separately', () => {
    const mixed: CiReportInput = {
      ...base,
      filedBugs: [
        { ...base.filedBugs[0]! },
        {
          ...base.filedBugs[0]!,
          id: 'BUG-2',
          title: 'Stats page reports the wrong total',
          testCaseId: 'stats-total',
          baselinedAs: 'BASE-003',
        },
      ],
    };
    const comment = renderPrComment(mixed);
    expect(comment).toContain('Newly filed bugs (1)');
    expect(comment).toContain('Known defects, already baselined (1)');
    expect(comment).toContain('BASE-003');
  });
});

describe('renderStepSummary', () => {
  it('summarises the run in one line', () => {
    expect(renderStepSummary(base)).toBe('Argus: 5/8 passed, 1 new bug(s), 0 known, gate FAILED');
  });

  it('reports how many defects matched the baseline', () => {
    const baselined: CiReportInput = {
      ...base,
      filedBugs: [{ ...base.filedBugs[0]!, baselinedAs: 'BASE-002' }],
      gateFailed: false,
    };
    expect(renderStepSummary(baselined)).toBe(
      'Argus: 5/8 passed, 0 new bug(s), 1 known, gate passed',
    );
  });
});

describe('bugsBySeverity', () => {
  it('counts bugs per severity level', () => {
    const bugs = [
      { severity: 'critical' },
      { severity: 'high' },
      { severity: 'high' },
    ] as FiledBug[];
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

  /**
   * The workflow with comment-only lines stripped, so an assertion about
   * behaviour cannot be satisfied by a word that happens to appear inside an
   * explanatory comment. Two such assertions had already been quietly passing
   * this way: one keyed off `--mock`, which only survived inside a comment
   * about a removed invocation.
   */
  const workflowCode = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('triggers on pull requests', () => {
    expect(workflow).toContain('pull_request:');
  });

  it('grants the permission needed to comment on a PR', () => {
    expect(workflow).toContain('pull-requests: write');
  });

  it('runs the unit suite before spending anything on AI', () => {
    expect(workflow.indexOf('pnpm test')).toBeLessThan(workflow.indexOf('Run Argus'));
  });

  it('installs the Playwright browser', () => {
    expect(workflow).toContain('pnpm exec playwright install');
  });

  it('starts the demo app and waits for it', () => {
    expect(workflow).toContain('pnpm run demo');
    expect(workflow).toContain('wait-on');
  });

  it('falls back to mock mode when no API key is present', () => {
    // Forks and Dependabot cannot read secrets; without this they would get a
    // red X they have no way to fix.
    //
    // Asserts the mechanism, not a substring: the workflow selects the
    // `run:mock` script rather than passing `--mock` through pnpm, and the old
    // `--mock` assertion had started passing on a word inside a comment.
    expect(workflowCode).toContain('if [ -n "$ANTHROPIC_API_KEY" ]');
    expect(workflowCode).toContain('echo "script=run:mock" >> "$GITHUB_OUTPUT"');
    expect(workflowCode).toContain('pnpm run "${{ steps.mode.outputs.script }}"');
  });

  it('never keys the gate off a continue-on-error step outcome', () => {
    // `continue-on-error: true` reports `conclusion: success` even when the
    // command exits non-zero, so `steps.argus.outcome` cannot tell "found a
    // bug" from "never ran". Seven consecutive runs reported the first while
    // meaning the second. The gate reads the artifact instead.
    expect(workflowCode).not.toContain('steps.argus.outcome');
    expect(workflowCode).toContain('pnpm run --silent verify-run');
  });

  it('reports an incomplete run differently from a failing gate', () => {
    expect(workflowCode).toContain('the pipeline did not complete');
    expect(workflowCode).toContain('This is not a gate result');
  });

  it('posts the comment before enforcing the gate', () => {
    expect(workflow.indexOf('Post the PR comment')).toBeLessThan(
      workflow.indexOf('Verify the run, then enforce its gate'),
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

  it('waits on an explicit IPv4 address rather than "localhost"', () => {
    // Regression: the demo app bound "::" and CI resolved localhost to
    // 127.0.0.1, so wait-on timed out for 60s against a server that had
    // already logged "listening".
    expect(workflow).toContain('wait-on tcp:127.0.0.1:4317');
    expect(workflow).not.toContain('wait-on http://localhost');
  });

  it('still produces a comment when the pipeline dies early', () => {
    // Otherwise `ci-comment` exits non-zero, the file is never written, and
    // the real failure is buried under an ENOENT from the comment step.
    expect(workflow).toContain('Argus did not complete');
  });
});

describe('demo app networking', () => {
  const server = fs.readFileSync(path.join(ROOT, 'demo-app', 'src', 'server.ts'), 'utf-8');
  const demoServer = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'demo-server.ts'), 'utf-8');
  const cli = fs.readFileSync(path.join(ROOT, 'src', 'cli', 'index.ts'), 'utf-8');

  it('binds 0.0.0.0 so IPv4 clients can reach it', () => {
    expect(server).toContain("server.listen(PORT, '0.0.0.0'");
  });

  it('exposes a shutdown hook that closes the listener', () => {
    // Regression: on Windows the CLI spawns the app through a shell wrapper,
    // so killing the child PID orphaned the real node process and left the
    // port held — the next run died on EADDRINUSE.
    expect(server).toContain("pathname === '/__shutdown'");
    expect(server).toContain('server.close(');
  });

  it('shuts the app down over HTTP before falling back to a tree kill', () => {
    expect(demoServer).toContain('__shutdown');
    expect(demoServer).toContain("'/T', '/F'");
  });

  it('awaits shutdown before exiting the process', () => {
    // process.exit() after an un-awaited stop() would kill the CLI mid-request
    // and orphan the server anyway.
    expect(cli).toContain('await demo?.stop()');
    expect(cli).not.toMatch(/^\s*demo\?\.stop\(\);/m);
  });
});

describe('logger colour handling', () => {
  const logger = fs.readFileSync(path.join(ROOT, 'src', 'shared', 'logger.ts'), 'utf-8');

  it('honours FORCE_COLOR so piped output keeps its ANSI codes', () => {
    // Needed to record the README demo, and it is what CI log viewers expect.
    expect(logger).toContain('FORCE_COLOR');
  });

  it('still honours NO_COLOR', () => {
    expect(logger).toContain('NO_COLOR');
  });
});
