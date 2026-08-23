/**
 * Triage — orchestration.
 *
 * The second and last place an LLM does real reasoning in Argus. It decides
 * *why* a test failed; everything it feeds (severity scoring, dedupe, the CI
 * gate) is deterministic.
 *
 * Mock mode is keyed per test case, so `--mock` produces a realistic mixture of
 * verdicts rather than the same answer four times.
 *
 * Verdict cache: when a failure's error-message signature matches a cached
 * entry, the AI call is skipped entirely — the cached verdict is reused.
 * Cache lives in data/triage-cache.json with a 30-day TTL.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AiClient } from '../shared/ai-client.js';
import type { RunSummary, TestCase, TriageLogEntry, TriageResult } from '../shared/types.js';
import { log, verdictBadge } from '../shared/logger.js';
import { writeJson } from '../shared/storage.js';
import { buildTriagePrompt, TRIAGE_SYSTEM_PROMPT } from './prompt.js';
import { validateTriageResponse } from './validate.js';
import { lookupCachedVerdict, cacheVerdict, cachedToTriageResult } from './cache.js';

export interface TriageOptions {
  ai: AiClient;
  testCases: TestCase[];
  /** Directory for the verdict cache (default: data/). */
  runDir?: string;
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

/** Load the verdict cache from disk, if it exists. */
function loadCache(runDir?: string): Map<string, any> {
  if (!runDir) return new Map();
  const cachePath = path.join(runDir, 'triage-cache.json');
  if (!fs.existsSync(cachePath)) return new Map();
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const cache = new Map<string, any>();
    Object.entries(data).forEach(([k, v]) => cache.set(k, v));
    return cache;
  } catch {
    return new Map();
  }
}

/** Persist the verdict cache to disk. */
function saveCache(cache: Map<string, any>, runDir?: string): void {
  if (!runDir) return;
  const cachePath = path.join(runDir, 'triage-cache.json');
  const obj: Record<string, any> = {};
  cache.forEach((v, k) => {
    obj[k] = v;
  });
  writeJson(cachePath, obj);
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

  // Load the verdict cache to skip AI calls for previously-seen errors.
  const cache = loadCache(options.runDir);
  let cacheHits = 0;

  for (const failure of summary.failures) {
    const testCase = byId.get(failure.testCaseId);
    const errorMessage = failure.errorMessage || '';

    // Check the cache first — if we've triaged this exact error before,
    // reuse the verdict and skip the AI call.
    const cached = lookupCachedVerdict(cache, failure.testCaseId, errorMessage);
    if (cached) {
      cacheHits += 1;
      const result = cachedToTriageResult(cached, failure.testCaseId);
      results.push(result);
      logEntries.push({
        ...result,
        runId: summary.runId,
        testTitle: testCase?.title ?? failure.testCaseId,
        errorMessage,
        triagedAt: new Date().toISOString(),
        source: ai.mode,
      });
      const confidence = `${Math.round(result.confidence * 100)}%`;
      log.item(
        `(cache) ${verdictBadge(result.verdict)} (${confidence}) — ${testCase?.title ?? failure.testCaseId}`,
      );
      continue;
    }

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

    // Cache the result for future runs.
    cacheVerdict(
      cache,
      failure.testCaseId,
      errorMessage,
      result.verdict,
      result.confidence,
      result.reasoning,
      result.suggestedFix,
      ai.mode === 'live' ? 'ai' : 'rules',
    );

    results.push(result);
    logEntries.push({
      ...result,
      runId: summary.runId,
      testTitle: testCase?.title ?? failure.testCaseId,
      errorMessage,
      triagedAt: new Date().toISOString(),
      source: ai.mode,
    });

    const confidence = `${Math.round(result.confidence * 100)}%`;
    log.item(
      `${verdictBadge(result.verdict)} (${confidence}) — ${testCase?.title ?? failure.testCaseId}`,
    );
    log.detail(result.reasoning);
    if (result.suggestedFix) log.detail(`suggested fix: ${result.suggestedFix}`);
  }

  if (cacheHits > 0)
    log.info(`Verdict cache: ${cacheHits}/${summary.failures.length} calls skipped via cache.`);

  // Persist the cache for next time.
  saveCache(cache, options.runDir);

  if (options.logPath) writeJson(options.logPath, logEntries);

  return results;
}

export * from './validate.js';
export * from './prompt.js';
