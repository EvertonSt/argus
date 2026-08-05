import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanErrorMessage,
  parsePlaywrightReport,
  testCaseIdFor,
  type PwReport,
} from '../../src/execution/parse-report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A real report, produced by running the generated suite against the demo app. */
const report = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'fixtures', 'playwright-report.json'), 'utf-8'),
) as PwReport;

describe('cleanErrorMessage', () => {
  it('strips ANSI colour codes', () => {
    expect(cleanErrorMessage('\u001b[31mExpected 2\u001b[39m')).toBe('Expected 2');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanErrorMessage('  boom  ')).toBe('boom');
  });

  it('truncates very long messages', () => {
    const long = 'x'.repeat(2000);
    expect(cleanErrorMessage(long).length).toBeLessThanOrEqual(1201);
  });
});

describe('testCaseIdFor', () => {
  it('reads the argus-test-case-id annotation', () => {
    const spec = {
      title: 'whatever',
      tests: [{ annotations: [{ type: 'argus-test-case-id', description: 'my-case' }] }],
    };
    expect(testCaseIdFor(spec)).toBe('my-case');
  });

  it('falls back to the supplied fallback when the annotation is absent', () => {
    expect(testCaseIdFor({ title: 'T', tests: [] }, 'fallback-id')).toBe('fallback-id');
  });

  it('falls back to the spec title as a last resort', () => {
    expect(testCaseIdFor({ title: 'Some title' })).toBe('Some title');
  });
});

describe('parsePlaywrightReport (against a real recorded run)', () => {
  const summary = parsePlaywrightReport(report);

  it('counts every spec in the report', () => {
    expect(summary.total).toBe(8);
  });

  it('splits passes and failures', () => {
    expect(summary.passed).toBe(4);
    expect(summary.failed).toBe(4);
  });

  it('keeps passed + failed equal to total', () => {
    expect(summary.passed + summary.failed).toBe(summary.total);
  });

  it('maps every failure back to its Argus test case id', () => {
    const ids = summary.failures.map((f) => f.testCaseId);
    expect(ids).toContain('delete-removes-clicked-task');
    expect(ids).toContain('complete-persists-after-reload');
    expect(ids).toContain('reject-empty-task');
  });

  it('captures a screenshot path for each failure', () => {
    for (const failure of summary.failures) {
      expect(failure.screenshotPath).toBeTruthy();
    }
  });

  it('captures a trace path for each failure', () => {
    for (const failure of summary.failures) {
      expect(failure.tracePath).toBeTruthy();
    }
  });

  it('records a non-empty error message for each failure', () => {
    for (const failure of summary.failures) {
      expect(failure.errorMessage.length).toBeGreaterThan(10);
    }
  });

  it('reports the run duration', () => {
    expect(summary.durationMs).toBeGreaterThan(0);
  });
});

describe('parsePlaywrightReport — edge cases', () => {
  it('handles an empty report without throwing', () => {
    const summary = parsePlaywrightReport({});
    expect(summary).toMatchObject({ total: 0, passed: 0, failed: 0 });
  });

  it('recurses into nested suites', () => {
    const nested: PwReport = {
      suites: [
        {
          title: 'outer',
          suites: [{ title: 'inner', specs: [{ title: 'a', ok: true, tests: [{ status: 'expected' }] }] }],
        },
      ],
    };
    expect(parsePlaywrightReport(nested).total).toBe(1);
  });

  it('treats a timed-out test as a failure with a clear message', () => {
    const timedOut: PwReport = {
      suites: [
        {
          specs: [{ title: 'slow', ok: false, tests: [{ results: [{ status: 'timedOut' }] }] }],
        },
      ],
    };
    const summary = parsePlaywrightReport(timedOut);
    expect(summary.failed).toBe(1);
    expect(summary.failures[0]?.errorMessage).toBe('Test timed out.');
  });

  it('omits attachment paths when Playwright captured none', () => {
    const bare: PwReport = {
      suites: [
        {
          specs: [
            { title: 'x', ok: false, tests: [{ results: [{ status: 'failed', error: { message: 'nope' } }] }] },
          ],
        },
      ],
    };
    const failure = parsePlaywrightReport(bare).failures[0];
    expect(failure?.screenshotPath).toBeUndefined();
    expect(failure?.tracePath).toBeUndefined();
  });
});
