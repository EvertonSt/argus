/**
 * Bug filer — orchestration.
 *
 * The only new integration point relative to the standalone Bug Report
 * Generator: input arrives from the triage stage (verdict === 'real_bug')
 * instead of from interactive CLI prompts. Severity scoring, duplicate
 * detection, and environment capture are the ported implementations in the
 * sibling modules and are used unchanged.
 *
 * Fully deterministic — no LLM calls in this stage.
 */
import type { FiledBug, RunSummary, Severity, TestCase, TriageResult } from '../shared/types.js';
import { log, paint, severityBadge } from '../shared/logger.js';
import { readJson, slugify, writeJson } from '../shared/storage.js';
import type { BaselineBug } from './baseline.js';
import { matchBaseline } from './baseline.js';
import { findDuplicate, buildSignature } from './duplicate-check.js';
import { fileBugsToGitHub } from './github-filer.js';
import { formatEnvironment, getEnvironmentInfo } from './environment.js';
import { buildSeverityInput, resolveSeverity } from './severity.js';

/** Build reproduction steps from the test case that found the bug. */
export function buildReproSteps(testCase: TestCase | undefined, route: string): string[] {
  if (!testCase) return [`Navigate to ${route}`, 'Re-run the failing Argus test case.'];
  return [
    `Navigate to ${testCase.targetRoute}`,
    `Given ${testCase.gherkin.given}`,
    `When ${testCase.gherkin.when}`,
    `Expected: ${testCase.gherkin.then}`,
  ];
}

export function buildBugTitle(testCase: TestCase | undefined, testCaseId: string): string {
  // No boilerplate suffix here, deliberately. Dedupe compares titles with
  // string similarity, so any constant phrase appended to every title inflates
  // the score between otherwise unrelated bugs — with a shared suffix, three
  // distinct defects scored 0.61 against each other and two were wrongly
  // discarded as duplicates. Titles must carry only distinguishing content.
  return testCase ? testCase.title : `Failure in ${testCaseId}`;
}

export interface FileBugsOptions {
  runId: string;
  summary: RunSummary;
  testCases: TestCase[];
  /** Path to data/bugs.json — existing bugs are read for dedupe, then appended. */
  bugsPath: string;
  /**
   * Committed known defects. A bug matching one is recorded as known rather
   * than new, and so never blocks a merge — without this the gate fails on
   * every fresh checkout, because `bugsPath` lives in gitignored `data/` and is
   * therefore empty there.
   */
  baseline?: readonly BaselineBug[];
}

export async function fileBugs(
  triageResults: TriageResult[],
  options: FileBugsOptions,
): Promise<FiledBug[]> {
  const realBugs = triageResults.filter((result) => result.verdict === 'real_bug');
  if (realBugs.length === 0) return [];

  const environmentInfo = await getEnvironmentInfo();
  const environment = formatEnvironment(environmentInfo);

  const byId = new Map(options.testCases.map((tc) => [tc.id, tc]));
  const failuresById = new Map(options.summary.failures.map((f) => [f.testCaseId, f]));

  const existing = readJson<FiledBug[]>(options.bugsPath, []);
  const baseline = options.baseline ?? [];
  const filed: FiledBug[] = [];

  for (const result of realBugs) {
    const testCase = byId.get(result.testCaseId);
    const failure = failuresById.get(result.testCaseId);
    const title = buildBugTitle(testCase, result.testCaseId);

    const severityInput = buildSeverityInput(title, failure?.errorMessage ?? '', result);
    const severity: Severity = resolveSeverity(severityInput, testCase?.priority);

    // Dedupe using the richer signature (title + featureId + normalised error
    // class + verdict), not just the title.
    const signature = buildSignature(
      title,
      testCase?.featureId ?? '',
      failure?.errorMessage ?? '',
      result.verdict,
    );

    // Two different questions, deliberately answered by two different
    // mechanisms:
    //   - Is this a defect we already shipped with?  -> committed baseline,
    //     matched on (featureId, verdict). See baseline.ts for why this is not
    //     the fuzzy scorer.
    //   - Is this a second sighting of one this workspace filed? -> runtime
    //     dedupe, matched on the full signature.
    // A known defect never re-files as an issue either, so baselined bugs skip
    // the GitHub step below.
    const known = matchBaseline(signature, baseline);
    const duplicate = known ? null : findDuplicate(signature, [...existing, ...filed]);

    const bug: FiledBug = {
      id: `BUG-${slugify(result.testCaseId, 32)}-${Date.now().toString(36).slice(-4)}`,
      testCaseId: result.testCaseId,
      title,
      severity,
      environment,
      reproSteps: buildReproSteps(testCase, testCase?.targetRoute ?? '/'),
      filedAt: new Date().toISOString(),
      runId: options.runId,
      signature,
    };

    if (known) {
      bug.baselinedAs = known.entry.id;
    }

    if (duplicate) {
      bug.isDuplicateOf = duplicate.id;
      bug.duplicateScore = Math.round(duplicate.score * 100) / 100;
    }

    filed.push(bug);

    // If GitHub is configured, create an issue (best-effort, never blocks the gate).
    if (process.env.ARGUS_GITHUB_TOKEN && process.env.ARGUS_GITHUB_REPO && !known) {
      try {
        const ghResult = await fileBugsToGitHub([bug]);
        const result = ghResult[bug.id];
        if (result && !result.isDuplicate) {
          bug.githubIssue = { number: result.number, url: result.url };
        }
      } catch (e) {
        log.warn(`GitHub issue creation failed: ${e}`);
      }
    }

    const note = known
      ? paint('dim', ` (known defect, baselined as ${known.entry.id})`)
      : duplicate
        ? paint('dim', ` (duplicate of ${duplicate.id}, ${bug.duplicateScore})`)
        : '';
    log.item(`${severityBadge(severity)}  ${title}${note}`);
  }

  writeJson(options.bugsPath, [...existing, ...filed]);
  return filed;
}

/**
 * Bugs that are new: neither a duplicate of one this workspace already filed,
 * nor a defect the committed baseline already records. This is what the
 * severity gate counts and what the dashboard labels "new".
 */
export function newBugs(bugs: FiledBug[]): FiledBug[] {
  return bugs.filter((bug) => !bug.isDuplicateOf && !bug.baselinedAs);
}

export * from './baseline.js';
export * from './severity.js';
export * from './duplicate-check.js';
export * from './environment.js';
