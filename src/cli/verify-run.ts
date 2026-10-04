/**
 * Run verification — did the pipeline actually finish, and what did it decide?
 *
 * WHY THIS EXISTS
 *
 * A QA gate that reports on a workflow step's exit code cannot see the
 * difference between "the product ran and found a real bug" and "the product
 * never ran at all". Those two failures deserve opposite responses, and a gate
 * that cannot tell them apart will eventually report the second while claiming
 * the first.
 *
 * That is not hypothetical. `argus.yml` carried `continue-on-error: true` on
 * its Run Argus step, which GitHub reports as `conclusion: success` even when
 * the command exits non-zero. The workflow invoked the CLI in a way pnpm 11
 * silently broke, so the run aborted immediately and wrote nothing — yet the
 * step showed green, and the final gate step reported "Argus found a new real
 * bug at or above the high severity threshold". It had found nothing. Seven
 * consecutive red runs, every one of them explaining itself wrongly.
 *
 * The fix is to stop asking the process what happened and start asking the
 * artifact. `run.json` is written at the very end of the pipeline, after all
 * seven stages, and it records the gate verdict the pipeline actually reached.
 * If that file is absent or does not hold together, the run did not complete —
 * which is a different failure, with a different message, and it is reported as
 * one.
 *
 * Deterministic: this reads files Argus itself wrote. No model involved.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FiledBug, RunArtifact } from '../shared/types.js';
import { paint } from '../shared/logger.js';

export type VerifyStatus =
  /** A complete run happened and its gate passed. */
  | 'ok'
  /** A complete run happened and its gate failed. */
  | 'gate_failed'
  /** No trustworthy run artifact. The pipeline did not finish. */
  | 'incomplete';

export interface RunVerification {
  status: VerifyStatus;
  runId: string | undefined;
  /** The gate sentence recorded by the pipeline. */
  gateReason: string;
  /**
   * Why the artifact cannot be trusted. Populated only for `incomplete`, and
   * always specific: "the run did not finish" is not actionable, "no run index
   * at data/runs/index.json" is.
   */
  problems: string[];
  mode: 'live' | 'mock' | undefined;
  passed: number | undefined;
  total: number | undefined;
  newBugs: number | undefined;
  knownBugs: number | undefined;
  /** How many generated Playwright specs the run produced. */
  specCount: number;
}

export interface VerifyRunOptions {
  /** Directory holding run subdirectories and index.json. */
  runsDir: string;
  /** Directory the codegen stage writes its specs into. */
  generatedTestsDir: string;
  /** Used only to make problem messages relative and readable. */
  root?: string;
}

type ParseResult = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Read and parse JSON, keeping the failure reason.
 *
 * Deliberately not the shared `readJson`, which falls back to a default when a
 * file is unreadable. A fallback is right for a cache and wrong here: silently
 * substituting an empty array for a corrupt index turns "the run wrote
 * something broken" into "the run never happened", which is the exact confusion
 * this command exists to remove.
 */
function readJsonChecked(file: string): ParseResult {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return { ok: false, error: `not found at ${file}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `could not be parsed (${detail})` };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Count generated spec files, treating an unreadable directory as zero. */
function countSpecs(dir: string): number {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.spec.ts') || name.endsWith('.spec.js')).length;
  } catch {
    return 0;
  }
}

function rel(root: string | undefined, file: string): string {
  if (!root) return file;
  return path.relative(root, file).replace(/\\/g, '/');
}

function countKnown(bugs: unknown): number {
  if (!Array.isArray(bugs)) return 0;
  return (bugs as FiledBug[]).filter((bug) => Boolean(bug?.baselinedAs)).length;
}

function countNew(bugs: unknown): number {
  if (!Array.isArray(bugs)) return 0;
  return (bugs as FiledBug[]).filter((bug) => !bug?.isDuplicateOf && !bug?.baselinedAs).length;
}

function incomplete(problems: string[]): RunVerification {
  return {
    status: 'incomplete',
    runId: undefined,
    gateReason: '',
    problems,
    mode: undefined,
    passed: undefined,
    total: undefined,
    newBugs: undefined,
    knownBugs: undefined,
    specCount: 0,
  };
}

/**
 * Verify the most recent run.
 *
 * Returns a verdict; it never throws and never exits. Keeping the decision in a
 * pure-ish function is what lets the failure modes be unit-tested instead of
 * discovered on a runner.
 */
export function verifyRun(options: VerifyRunOptions): RunVerification {
  const { runsDir, generatedTestsDir, root } = options;
  const indexPath = path.join(runsDir, 'index.json');

  if (!fs.existsSync(indexPath)) {
    return incomplete([
      `no run index at ${rel(root, indexPath)} — the pipeline never reached the report stage`,
    ]);
  }

  const index = readJsonChecked(indexPath);
  if (!index.ok) {
    return incomplete([`run index ${index.error}`]);
  }
  if (!Array.isArray(index.value)) {
    return incomplete([`run index at ${rel(root, indexPath)} is not an array`]);
  }
  if (index.value.length === 0) {
    return incomplete([
      `run index at ${rel(root, indexPath)} is empty — Argus has not recorded a completed run`,
    ]);
  }

  const latest = index.value[index.value.length - 1];
  if (!isRecord(latest) || typeof latest.runId !== 'string' || latest.runId.length === 0) {
    return incomplete([`the newest entry in ${rel(root, indexPath)} has no run id`]);
  }

  const runId = latest.runId;
  const runPath = path.join(runsDir, runId, 'run.json');
  if (!fs.existsSync(runPath)) {
    return incomplete([
      `run ${runId} is indexed but ${rel(root, runPath)} is missing — the run started and did not finish`,
    ]);
  }

  const run = readJsonChecked(runPath);
  if (!run.ok) {
    return incomplete([`run artifact ${run.error}`]);
  }
  if (!isRecord(run.value)) {
    return incomplete([`run artifact at ${rel(root, runPath)} is not an object`]);
  }

  // Field-by-field, because a half-written artifact is the shape a crash in
  // the middle of the report stage actually takes.
  const problems: string[] = [];
  const artifact = run.value as Partial<RunArtifact> & Record<string, unknown>;

  if (artifact.runId !== runId) {
    problems.push(`run artifact is for ${String(artifact.runId)} but the index points at ${runId}`);
  }
  if (artifact.gateFailed === undefined || typeof artifact.gateFailed !== 'boolean') {
    problems.push('run artifact records no gate verdict');
  }
  if (typeof artifact.gateReason !== 'string' || artifact.gateReason.length === 0) {
    problems.push('run artifact records no gate reason');
  }
  if (!isRecord(artifact.summary)) {
    problems.push('run artifact has no execution summary');
  } else {
    const summary = artifact.summary as Record<string, unknown>;
    for (const field of ['total', 'passed', 'failed'] as const) {
      if (!isCount(summary[field])) problems.push(`execution summary has no ${field} count`);
    }
  }
  if (!Array.isArray(artifact.testCases)) {
    problems.push('run artifact has no planned test cases');
  }
  if (!isRecord(artifact.inventory)) {
    problems.push('run artifact has no feature inventory');
  }

  const specCount = countSpecs(generatedTestsDir);
  if (specCount === 0) {
    problems.push(
      `no generated specs in ${rel(root, generatedTestsDir)} — the codegen stage produced nothing`,
    );
  }

  const summary: Record<string, unknown> = isRecord(artifact.summary) ? artifact.summary : {};
  const base: RunVerification = {
    status: 'ok',
    runId,
    gateReason: typeof artifact.gateReason === 'string' ? artifact.gateReason : '',
    problems,
    mode: artifact.mode === 'live' || artifact.mode === 'mock' ? artifact.mode : undefined,
    passed: isCount(summary.passed) ? summary.passed : undefined,
    total: isCount(summary.total) ? summary.total : undefined,
    newBugs: countNew(artifact.filedBugs),
    knownBugs: countKnown(artifact.filedBugs),
    specCount,
  };

  if (problems.length > 0) {
    // A verdict recorded alongside an artifact that does not hold together is
    // not a verdict. Report the incompleteness and refuse to act on the gate,
    // rather than trusting half a record.
    return { ...base, status: 'incomplete' };
  }

  return { ...base, status: artifact.gateFailed === true ? 'gate_failed' : 'ok' };
}

/** Render the verdict for a terminal or a CI log. */
export function renderVerification(v: RunVerification, threshold = 'high'): string {
  const lines: string[] = [];

  if (v.status === 'incomplete') {
    lines.push(paint('red', '✗ No usable run artifact — the pipeline did not complete.'), '');
    for (const problem of v.problems) lines.push(`  - ${problem}`);
    lines.push(
      '',
      paint(
        'dim',
        'This is not a failing gate. Argus did not finish, so it has no verdict to report.',
      ),
      paint('dim', 'Check the job log for the stage that stopped.'),
    );
    return lines.join('\n');
  }

  const failed = v.status === 'gate_failed';
  lines.push(
    `${failed ? paint('red', '✗ Gate FAILED') : paint('green', '✓ Gate passed')}  ` +
      `${paint('dim', `run ${v.runId} · ${v.mode ?? 'unknown mode'}`)}`,
    '',
  );
  lines.push(
    `  Tests          ${v.passed ?? 0}/${v.total ?? 0} passed`,
    `  New bugs       ${v.newBugs ?? 0}`,
    `  Known defects  ${v.knownBugs ?? 0} (baselined)`,
    `  Specs generated ${v.specCount}`,
    '',
  );
  if (failed) {
    lines.push(
      `  ${paint('red', v.gateReason)}`,
      '',
      paint('dim', `A defect is new only if it does not match baseline/known-bugs.json.`),
    );
  } else {
    lines.push(`  ${paint('green', v.gateReason)}`);
    if ((v.newBugs ?? 0) > 0) {
      lines.push(
        '',
        paint(
          'dim',
          `New defects below the ${threshold} threshold do not block a merge. They are in the PR comment.`,
        ),
      );
    }
  }
  return lines.join('\n');
}
