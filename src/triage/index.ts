/**
 * Triage — orchestration.
 *
 * The second and last place an LLM does real reasoning in Argus. It decides
 * *why* a test failed; everything it feeds (severity scoring, dedupe, the CI
 * gate) is deterministic.
 *
 * Mock mode is keyed per test case, so `--mock` produces a realistic mixture of
 * verdicts rather than the same answer four times.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AiClient } from '../shared/ai-client.js';
import type {
  RunSummary,
  TestCase,
  TriageLogEntry,
  TriageResult,
} from '../shared/types.js';
import { log, verdictBadge } from '../shared/logger.js';
import { writeJson } from '../shared/storage.js';
import { buildTriagePrompt, TRIAGE_SYSTEM_PROMPT } from './prompt.js';
import { validateTriageResponse } from './validate.js';

export interface TriageOptions {
  ai: AiClient;
  testCases: TestCase[];
  /** Where to write the human-readable triage log. */
  logPath?: string;
  /** Fixture directory, used to resolve per-test-case mock responses. */
  fixturesDir?: string;
}

/**
 * In mock mode, prefer a fixture named for the specific test case
 * (`triage-<testCaseId>.json`) so the demo shows several different verdicts.
 * Falls back to a generic response when no specific one exists.
 */
function mockFixtureFor(testCaseId: string, fixturesDir: string | undefined): string {
  if (fixturesDir) {
    const specific = `triage-${testCaseId}.json`;
    if (fs.existsSync(path.join(fixturesDir, specific))) return specific;
  }
  return 'triage-default.json';
}

export async function triageFailures(
  summary: RunSummary,
  options: TriageOptions,
): Promise<TriageResult[]> {
  const { ai, testCases } = options;
  if (summary.failures.length === 0) return [];

  const byId = new Map(testCases.map((tc) => [tc.id, tc]));
  const results: TriageResult[] = [];
  const logEntries: TriageLogEntry[] = [];

  for (const failure of summary.failures) {
    const testCase = byId.get(failure.testCaseId);
    const raw = await ai.complete({
      purpose: `triage ${failure.testCaseId}`,
      system: TRIAGE_SYSTEM_PROMPT,
      user: buildTriagePrompt(failure, testCase),
      maxTokens: 700,
      mockFixture: mockFixtureFor(failure.testCaseId, options.fixturesDir),
    });

    const validation = validateTriageResponse(raw, failure.testCaseId);

    // A malformed verdict must not silently vanish, and must not be guessed
    // at either. Record it as low-confidence environment_issue so a human
    // sees it in the log, and keep going — one bad response should not abort
    // triage of the remaining failures.
    const result: TriageResult = validation.ok
      ? validation.result
      : {
          testCaseId: failure.testCaseId,
          verdict: 'environment_issue',
          confidence: 0,
          reasoning: `Triage response could not be parsed: ${validation.problem}`,
        };

    if (!validation.ok) log.warn(`Unparseable triage response for ${failure.testCaseId}.`);

    results.push(result);
    logEntries.push({
      ...result,
      runId: summary.runId,
      testTitle: testCase?.title ?? failure.testCaseId,
      errorMessage: failure.errorMessage,
      triagedAt: new Date().toISOString(),
      source: ai.mode,
    });

    const confidence = `${Math.round(result.confidence * 100)}%`;
    log.item(`${verdictBadge(result.verdict)} (${confidence}) — ${testCase?.title ?? failure.testCaseId}`);
    log.detail(result.reasoning);
    if (result.suggestedFix) log.detail(`suggested fix: ${result.suggestedFix}`);
  }

  if (options.logPath) writeJson(options.logPath, logEntries);

  return results;
}

export * from './validate.js';
export * from './prompt.js';
