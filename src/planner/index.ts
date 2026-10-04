/**
 * Planner — orchestration.
 *
 * One of only two places in Argus where an LLM does real reasoning (the other
 * is triage). The boundary is deliberate: this module decides *what* to test;
 * every downstream stage is deterministic.
 */
import type { AiClient } from '../shared/ai-client.js';
import { ArgusError } from '../shared/ai-client.js';
import type { FeatureInventory, TestCase } from '../shared/types.js';
import { log } from '../shared/logger.js';
import { buildPlannerPrompt, buildRetryPrompt, PLANNER_SYSTEM_PROMPT } from './prompt.js';
import { describeIssues, sortByPriority, validateTestCases } from './validate.js';

export interface PlanOptions {
  maxCases?: number;
}

export async function planTestCases(
  inventory: FeatureInventory,
  ai: AiClient,
  options: PlanOptions = {},
): Promise<TestCase[]> {
  if (inventory.features.length === 0) {
    throw new ArgusError(
      'Cannot plan tests: the feature inventory is empty.',
      'Check that --target points at a running app, or that --specs contains markdown files.',
    );
  }

  const maxCases = options.maxCases ?? 12;
  const prompt = buildPlannerPrompt(inventory, maxCases);

  const first = await ai.complete({
    purpose: 'plan test cases',
    system: PLANNER_SYSTEM_PROMPT,
    user: prompt,
    maxTokens: 4096,
    mockFixture: 'planner-response.json',
  });

  let result = validateTestCases(first, inventory.features);

  // Retry exactly once, telling the model precisely what failed validation.
  if (!result.ok) {
    const issues = describeIssues(result.issues);
    log.warn(`Planner response failed schema validation — retrying once.`);
    for (const line of issues.split('\n').slice(0, 5)) log.detail(line);

    const second = await ai.complete({
      purpose: 'plan test cases (retry)',
      system: PLANNER_SYSTEM_PROMPT,
      user: buildRetryPrompt(prompt, issues),
      maxTokens: 4096,
      mockFixture: 'planner-response.json',
    });
    result = validateTestCases(second, inventory.features);
  }

  // Fail loudly. Silently dropping invalid entries would quietly shrink
  // coverage, which is the worst possible failure mode for a QA tool.
  if (!result.ok) {
    throw new ArgusError(
      `Planner returned test cases that failed schema validation twice:\n${describeIssues(result.issues)}`,
      'This usually means the model ignored the response format. Try a different ' +
        'ANTHROPIC_MODEL, or inspect the raw response by re-running with --verbose.',
    );
  }

  return sortByPriority(result.testCases);
}

export * from './validate.js';
export * from './prompt.js';
