/**
 * Real GitHub Issues integration — optional.
 *
 * When `ARGUS_GITHUB_TOKEN` and `ARGUS_GITHUB_REPO` are set, every bug filed by
 * the deterministic pipeline is also created as a GitHub Issue with the right
 * severity label. If the token or repo is missing, filing is silently skipped
 * (the bug is still saved to bugs.json). This keeps the gate deterministic and
 * the pipeline testable without any API key.
 *
 * Uses raw fetch against the REST API (no extra runtime dependency), matching
 * Cerberus CI's approach to GitHub integration.
 */
import type { FiledBug } from '../shared/types.js';
import { log } from '../shared/logger.js';

export interface GitHubConfig {
  token: string | undefined;
  repo: string | undefined;
  owner: string | undefined;
}

export interface GitHubIssueResult {
  number: number;
  url: string;
  isDuplicate: boolean;
}

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'severity::critical',
  high: 'severity::high',
  medium: 'severity::medium',
  low: 'severity::low',
};

/**
 * Create a GitHub Issue for a filed bug. Returns the issue number + URL on success,
 * or null if GitHub integration is not configured or the issue is a duplicate.
 */
export async function createGitHubIssue(
  bug: FiledBug,
  ghConfig: GitHubConfig,
): Promise<GitHubIssueResult | null> {
  if (!ghConfig.token || !ghConfig.repo || !ghConfig.owner) {
    return null;
  }

  // Never create an Issue for a duplicate — comment on the original instead.
  if (bug.isDuplicateOf) {
    return { number: 0, url: '', isDuplicate: true };
  }

  const label = SEVERITY_LABEL[bug.severity] || 'severity::low';
  const title = `[Argus] ${bug.title}`;

  // Build the body with reproduction steps
  const body = [
    `## Defect auto-filed by Argus`,
    ``,
    `**Test case:** \`${bug.testCaseId}\``,
    `**Run:** \`${bug.runId}\``,
    `**Environment:** ${bug.environment}`,
    ``,
    `### Steps to reproduce`,
    ...(bug.reproSteps || []).map((step) => `- ${step}`),
    ``,
    `### Severity`,
    `\`${bug.severity}\``,
    ``,
    `---`,
    `*This issue was created automatically by the Argus CI pipeline. Do not close manually unless the bug is resolved.*`,
    ``,
    `*Filed at: ${bug.filedAt}*`,
  ].join('\n');

  const response = await fetch(
    `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/issues`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${ghConfig.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body,
        labels: ['auto-filed', 'argus', label],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    log.warn(`GitHub issue creation failed for "${title}": ${response.status} ${text}`);
    return null;
  }

  const result = (await response.json()) as { number: number; html_url: string };
  log.item(`Created GitHub issue #${result.number}: ${result.html_url}`);

  return {
    number: result.number,
    url: result.html_url,
    isDuplicate: false,
  };
}

/** Extract GitHub config from environment variables. */
export function getGitHubConfig(): GitHubConfig {
  const repo = process.env.ARGUS_GITHUB_REPO;
  let owner: string | undefined;

  if (repo) {
    const parts = repo.split('/');
    if (parts.length >= 2) {
      owner = parts[0];
    }
  }

  return {
    token: process.env.ARGUS_GITHUB_TOKEN,
    repo,
    owner,
  };
}

/**
 * File bugs to GitHub if configured. Returns a map of bug.id → GitHub issue info.
 * This is the single integration point — the deterministic `fileBugs` pipeline
 * stage calls this after writing bugs.json, so the gate is never delayed by
 * GitHub availability.
 */
export async function fileBugsToGitHub(
  bugs: FiledBug[],
): Promise<Record<string, GitHubIssueResult>> {
  const config = getGitHubConfig();
  if (!config.token || !config.repo || !config.owner) {
    return {};
  }

  const results: Record<string, GitHubIssueResult> = {};
  for (const bug of bugs) {
    const result = await createGitHubIssue(bug, config);
    if (result) {
      results[bug.id] = result;
    }
  }
  return results;
}
