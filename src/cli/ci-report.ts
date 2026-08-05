/**
 * CI report — renders the PR comment.
 *
 * Pure string building so the comment's shape is unit-tested rather than
 * discovered by pushing commits and squinting at GitHub.
 */
import type { FiledBug, RunArtifact, Severity, TriageVerdict } from '../shared/types.js';

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
      lines.push(`- ${SEVERITY_ICON[bug.severity]} **${bug.severity}** — ${bug.title} \`${bug.testCaseId}\``);
    }
    lines.push('');
  }

  if (duplicates > 0) {
    lines.push(`_${duplicates} further failure(s) matched an already-filed bug and were not re-filed._`, '');
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
