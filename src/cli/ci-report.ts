/**
 * CI report — renders the PR comment.
 *
 * Pure string building so the comment's shape is unit-tested rather than
 * discovered by pushing commits and squinting at GitHub.
 */
import type {
  FiledBug,
  RunArtifact,
  Severity,
  TriageVerdict,
  RunIndexEntry,
  FeatureInventory,
  TestCase,
} from '../shared/types.js';
import { readJson } from '../shared/storage.js';
import type { ArgusConfig } from '../shared/config.js';

const SEVERITY_ICON: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '⚪',
};

const VERDICT_LABEL: Record<TriageVerdict, string> = {
  real_bug: '🐞 Real bug',
  flaky: '🎲 Flaky',
  selector_drift: '🔧 Selector drift',
  environment_issue: '🛠️ Environment',
};

export interface CiReportInput extends RunArtifact {
  gateFailed: boolean;
  gateReason: string;
  threshold: Severity;
}

function countVerdicts(artifact: CiReportInput): Record<TriageVerdict, number> {
  const counts: Record<TriageVerdict, number> = {
    real_bug: 0,
    flaky: 0,
    selector_drift: 0,
    environment_issue: 0,
  };
  for (const result of artifact.triage) counts[result.verdict] += 1;
  return counts;
}

export function renderPrComment(artifact: CiReportInput): string {
  const { summary } = artifact;
  const counts = countVerdicts(artifact);
  const fresh = artifact.filedBugs.filter((bug) => !bug.isDuplicateOf);
  const duplicates = artifact.filedBugs.length - fresh.length;

  const headline = artifact.gateFailed
    ? '### ❌ Argus QA — merge blocked'
    : summary.failed > 0
      ? '### ⚠️ Argus QA — failures found, merge not blocked'
      : '### ✅ Argus QA — all clear';

  const lines: string[] = [
    headline,
    '',
    `**${summary.passed}/${summary.total} tests passed** · ${artifact.testCases.length} cases generated ` +
      `from ${artifact.inventory.features.length} discovered features · ${artifact.aiCalls} AI calls`,
    '',
  ];

  if (summary.failed > 0) {
    lines.push(
      '| Triage verdict | Count | Blocks merge? |',
      '| --- | ---: | --- |',
      `| ${VERDICT_LABEL.real_bug} | ${counts.real_bug} | yes, at ≥ \`${artifact.threshold}\` |`,
      `| ${VERDICT_LABEL.flaky} | ${counts.flaky} | no |`,
      `| ${VERDICT_LABEL.selector_drift} | ${counts.selector_drift} | no |`,
      `| ${VERDICT_LABEL.environment_issue} | ${counts.environment_issue} | no |`,
      '',
    );
  }

  if (fresh.length > 0) {
    lines.push(`#### Newly filed bugs (${fresh.length})`, '');
    for (const bug of fresh) {
      lines.push(
        `- ${SEVERITY_ICON[bug.severity]} **${bug.severity}** — ${bug.title} \`${bug.testCaseId}\``,
      );
    }
    lines.push('');
  }

  if (duplicates > 0) {
    lines.push(
      `_${duplicates} further failure(s) matched an already-filed bug and were not re-filed._`,
      '',
    );
  }

  const drift = artifact.triage.filter((r) => r.verdict === 'selector_drift' && r.suggestedFix);
  if (drift.length > 0) {
    lines.push('<details><summary>🔧 Self-heal suggestions (human review required)</summary>', '');
    for (const result of drift) {
      lines.push(`- \`${result.testCaseId}\` — ${result.suggestedFix}`);
    }
    lines.push('', '</details>', '');
  }

  if (artifact.triage.length > 0) {
    lines.push('<details><summary>🧠 Triage reasoning</summary>', '');
    for (const result of artifact.triage) {
      const confidence = Math.round(result.confidence * 100);
      lines.push(
        `- ${VERDICT_LABEL[result.verdict]} (${confidence}%) \`${result.testCaseId}\`  `,
        `  ${result.reasoning}`,
      );
    }
    lines.push('', '</details>', '');
  }

  lines.push(
    '---',
    '',
    `**Gate:** ${artifact.gateReason}.`,
    '',
    '<sub>Flaky and selector-drift failures never block a merge — only real bugs at or above ' +
      `the configured severity threshold (\`${artifact.threshold}\`) do. ` +
      'Posted by [Argus](https://github.com/EvertonSt/argus).</sub>',
  );

  return lines.join('\n');
}

/** One-line summary for the GitHub Actions step summary / job log. */
export function renderStepSummary(artifact: CiReportInput): string {
  const fresh = artifact.filedBugs.filter((bug) => !bug.isDuplicateOf).length;
  return (
    `Argus: ${artifact.summary.passed}/${artifact.summary.total} passed, ` +
    `${fresh} new bug(s), gate ${artifact.gateFailed ? 'FAILED' : 'passed'}`
  );
}

export function bugsBySeverity(bugs: FiledBug[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const bug of bugs) counts[bug.severity] += 1;
  return counts;
}

/**
 * Export all dashboard-relevant data as a single object for static deployment.
 * Reads from the runtime data/ directory and returns structures the Next.js
 * dashboard app can import at build time.
 */
export function buildDashboardData(config: ArgusConfig): Record<string, unknown> {
  const runIndex = readJson<RunIndexEntry[]>(config.paths.runs + '/index.json', []);
  const bugs = readJson<FiledBug[]>(config.paths.bugs, []);
  const inventory = readJson<FeatureInventory | null>(config.paths.inventory, null);
  const testCases = readJson<TestCase[]>(config.paths.testCases, []);

  // Aggregate latest run's triage counts into the run index for the dashboard.
  const enrichedIndex = runIndex.map((entry) => ({ ...entry }));

  return {
    'run-index.json': enrichedIndex,
    'bugs.json': bugs,
    'inventory.json': inventory,
    'test-cases.json': testCases,
  };
}

/**
 * Render GitHub Actions workflow-command annotations for each failed test.
 * Each annotation appears inline on the Files changed tab, pointing to the
 * exact test case file and line where the failure was detected.
 *
 * Format: ::error file={path},line={n}::{message}
 * Deterministic — no AI calls, just the triage verdict + reasoning.
 */
export function renderAnnotations(artifact: CiReportInput): string {
  const lines: string[] = [];
  for (const failure of artifact.summary.failures) {
    const triage = artifact.triage.find((t) => t.testCaseId === failure.testCaseId);
    const verdictLabel = triage ? VERDICT_LABEL[triage.verdict] : 'unknown';
    const confidence = triage ? Math.round(triage.confidence * 100) : 0;

    // Construct a file path that exists in the repo: generated-tests/<id>.spec.ts
    const testFile = `generated-tests/${failure.testCaseId}.spec.ts`;
    // Line 1 — the test definition. Real bugs get ::error (red X), others get ::warning.
    const level = triage && triage.verdict === 'real_bug' ? 'error' : 'warning';

    const message = `[Argus ${verdictLabel} (${confidence}%)] ${failure.errorMessage.slice(0, 180)}`;
    lines.push(`::${level} file=${testFile},line=1::${message}`);
  }
  return lines.join('\n');
}

/**
 * Full CI output: PR comment + inline annotations, ready to write to GITHUB_STEP_SUMMARY.
 */
export function renderCiOutput(artifact: CiReportInput): string {
  return (
    renderPrComment(artifact) + '\n\n<!-- INLINE ANNOTATIONS -->\n' + renderAnnotations(artifact)
  );
}
