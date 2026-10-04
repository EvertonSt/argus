/**
 * Execution — parsing Playwright's JSON reporter output into a RunSummary.
 *
 * Split from the process-spawning half so it can be unit-tested against a
 * saved report with no browser involved.
 */
import type { RunFailure, RunSummary } from '../shared/types.js';

/** The subset of Playwright's JSON report Argus depends on. */
interface PwAnnotation {
  type?: string;
  description?: string;
}
interface PwAttachment {
  name?: string;
  path?: string;
  contentType?: string;
}
interface PwResult {
  status?: string;
  duration?: number;
  error?: { message?: string; stack?: string };
  errors?: Array<{ message?: string }>;
  attachments?: PwAttachment[];
}
interface PwTest {
  status?: string;
  annotations?: PwAnnotation[];
  results?: PwResult[];
}
interface PwSpec {
  title?: string;
  ok?: boolean;
  tests?: PwTest[];
}
interface PwSuite {
  title?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
export interface PwReport {
  stats?: {
    expected?: number;
    unexpected?: number;
    flaky?: number;
    skipped?: number;
    duration?: number;
  };
  suites?: PwSuite[];
  errors?: Array<{ message?: string }>;
}

function flattenSpecs(suites: PwSuite[] | undefined): PwSpec[] {
  if (!suites) return [];
  return suites.flatMap((suite) => [...(suite.specs ?? []), ...flattenSpecs(suite.suites)]);
}

/**
 * Strip ANSI colour codes Playwright embeds in error messages, and trim to a
 * length that is useful to a human and cheap to send to the triage model.
 */
export function cleanErrorMessage(raw: string, maxLength = 1200): string {
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/\u001b\[[0-9;]*m/g, '').trim();
  return stripped.length > maxLength ? `${stripped.slice(0, maxLength)}…` : stripped;
}

/**
 * Recover the Argus TestCase id for a spec.
 *
 * Primary source is the `argus-test-case-id` annotation the generated file
 * pushes. Falls back to the file name stem, which the codegen sets to the id.
 */
export function testCaseIdFor(spec: PwSpec, fallback?: string): string {
  for (const test of spec.tests ?? []) {
    for (const annotation of test.annotations ?? []) {
      if (annotation.type === 'argus-test-case-id' && annotation.description) {
        return annotation.description;
      }
    }
  }
  return fallback ?? spec.title ?? 'unknown';
}

export function parsePlaywrightReport(report: PwReport): RunSummary {
  const specs = flattenSpecs(report.suites);
  const failures: RunFailure[] = [];
  let passed = 0;

  for (const spec of specs) {
    const test = spec.tests?.[0];
    const result = test?.results?.[test.results.length - 1];
    const status = result?.status ?? test?.status ?? 'unknown';

    if (spec.ok === true && status !== 'failed' && status !== 'timedOut') {
      passed += 1;
      continue;
    }

    const rawMessage =
      result?.error?.message ??
      result?.errors?.[0]?.message ??
      (status === 'timedOut' ? 'Test timed out.' : 'Test failed with no error message.');

    const attachments = result?.attachments ?? [];
    const screenshot = attachments.find((a) => a.name === 'screenshot')?.path;
    const trace = attachments.find((a) => a.name === 'trace')?.path;

    const failure: RunFailure = {
      testCaseId: testCaseIdFor(spec),
      errorMessage: cleanErrorMessage(rawMessage),
    };
    if (screenshot) failure.screenshotPath = screenshot;
    if (trace) failure.tracePath = trace;
    failures.push(failure);
  }

  return {
    runId: '',
    timestamp: new Date().toISOString(),
    total: specs.length,
    passed,
    failed: failures.length,
    failures,
    durationMs: report.stats?.duration ?? 0,
  };
}
