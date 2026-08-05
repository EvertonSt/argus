/**
 * The Argus pipeline — the closed loop.
 *
 *   ingest → plan (AI) → codegen → execute → triage (AI) → file bugs → report
 *
 * The AI boundary is deliberate and narrow: only `plan` and `triage` reason
 * with a model. Execution, severity scoring, dedupe, and the CI gate are all
 * deterministic, so their behaviour is reproducible and unit-tested.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ArgusConfig } from '../shared/config.js';
import { meetsThreshold } from '../shared/config.js';
import { createAiClient, ArgusError } from '../shared/ai-client.js';
import type {
  FeatureInventory,
  FiledBug,
  RunArtifact,
  RunSummary,
  TestCase,
  TriageResult,
} from '../shared/types.js';
import { log, paint } from '../shared/logger.js';
import { ensureDir, newRunId, writeJson } from '../shared/storage.js';
import { ingest } from '../ingestion/index.js';
import { planTestCases, countByPriority } from '../planner/index.js';
import { codegenStats, generateTests } from '../codegen/index.js';
import { captureDomSnapshots, executeSuite } from '../execution/index.js';
import { summarizeVerdicts, triageFailures } from '../triage/index.js';
import { fileBugs, newBugs } from '../bug-filer/index.js';

export interface RunOptions {
  config: ArgusConfig;
  /** URL of the app under test. */
  target?: string | undefined;
  /** Folder of markdown specs. */
  specs?: string | undefined;
  /** Use bundled fixtures instead of live Anthropic calls. */
  mock: boolean;
  maxCases?: number;
}

export interface RunOutcome extends RunArtifact {
  /** True when a non-duplicate real bug met the CI severity threshold. */
  gateFailed: boolean;
  gateReason: string;
}

export async function runPipeline(options: RunOptions): Promise<RunOutcome> {
  const { config, mock } = options;
  const runId = newRunId();
  const target = options.target ?? config.targetUrl;
  const runDir = path.join(config.paths.runs, runId);
  ensureDir(runDir);

  log.banner(
    `${mock ? paint('yellow', 'MOCK MODE') + ' · fixtures, no API calls' : 'live mode'} · run ${runId}`,
  );

  // Cost transparency: state the AI budget before spending any of it.
  if (!mock) {
    log.info(
      `Planned AI calls: 1 planner + up to 1 per failure. Hard cap ${config.maxAiCalls} ` +
        `(ARGUS_MAX_AI_CALLS). Model: ${config.anthropicModel}.`,
    );
  }

  const ai = createAiClient(config, mock);

  // ---- 1. Ingest --------------------------------------------------------
  log.stage('Ingest', 'building a feature inventory');
  const inventory: FeatureInventory = await ingest({
    url: options.target ?? config.targetUrl,
    specsPath: options.specs,
  });
  writeJson(config.paths.inventory, inventory);
  log.success(`${inventory.features.length} features discovered (source: ${inventory.source})`);

  // ---- 2. Plan (AI) -----------------------------------------------------
  log.stage('Plan', 'Claude proposes a prioritised suite');
  const testCases: TestCase[] = await planTestCases(inventory, ai, {
    maxCases: options.maxCases ?? 12,
  });
  writeJson(config.paths.testCases, testCases);
  const priorities = countByPriority(testCases);
  log.success(
    `${testCases.length} test cases planned — ` +
      `${priorities.critical} critical, ${priorities.high} high, ` +
      `${priorities.medium} medium, ${priorities.low} low`,
  );

  // ---- 3. Codegen -------------------------------------------------------
  log.stage('Codegen', 'templates first, LLM only where needed');
  const files = await generateTests(testCases, {
    outputDir: config.paths.generatedTests,
    ai,
  });
  const stats = codegenStats(files);
  const templatePct = stats.steps ? Math.round((stats.templateSteps / stats.steps) * 100) : 0;
  log.success(
    `${stats.files} spec files, ${stats.steps} steps — ` +
      `${templatePct}% deterministic (${stats.llmSteps} via LLM fallback)`,
  );

  // ---- 4. Execute -------------------------------------------------------
  log.stage('Execute', 'running the generated Playwright suite');
  const summary: RunSummary = await executeSuite({
    runId,
    cwd: config.paths.root,
    runDir,
    targetUrl: target,
  });
  summary.timestamp = new Date().toISOString();
  writeJson(path.join(runDir, 'summary.json'), summary);

  const verdictLine =
    summary.failed === 0
      ? paint('green', `${summary.passed}/${summary.total} passed`)
      : `${paint('green', `${summary.passed} passed`)}, ${paint('red', `${summary.failed} failed`)}`;
  log.success(`${verdictLine} in ${Math.round((summary.durationMs ?? 0) / 1000)}s`);

  // ---- 5. Triage (AI) ---------------------------------------------------
  log.stage('Triage', 'Claude classifies every failure');
  let triage: TriageResult[] = [];
  if (summary.failures.length === 0) {
    log.info('No failures to triage.');
  } else {
    const routeFor = (id: string): string =>
      testCases.find((tc) => tc.id === id)?.targetRoute ?? '/';
    await captureDomSnapshots(summary, routeFor, target);

    triage = await triageFailures(summary, {
      ai,
      testCases,
      logPath: config.paths.triageLog,
      fixturesDir: config.paths.fixtures,
    });
    const verdicts = summarizeVerdicts(triage);
    log.success(
      `${verdicts.real_bug} real bug(s), ${verdicts.flaky} flaky, ` +
        `${verdicts.selector_drift} selector drift, ${verdicts.environment_issue} environment`,
    );
  }

  // ---- 6. File bugs -----------------------------------------------------
  log.stage('File bugs', 'real bugs only, with dedupe');
  const filedBugs: FiledBug[] = await fileBugs(triage, {
    runId,
    summary,
    testCases,
    bugsPath: config.paths.bugs,
  });
  const fresh = newBugs(filedBugs);
  if (filedBugs.length === 0) {
    log.info('No real bugs to file.');
  } else {
    log.success(
      `${filedBugs.length} bug(s) filed — ${fresh.length} new, ` +
        `${filedBugs.length - fresh.length} duplicate(s)`,
    );
  }

  // ---- 7. Gate + persist ------------------------------------------------
  log.stage('Report', 'writing artifacts and evaluating the CI gate');

  const blocking = fresh.filter((bug) => meetsThreshold(bug.severity, config.severityFailThreshold));
  const gateFailed = blocking.length > 0;
  const gateReason = gateFailed
    ? `${blocking.length} new bug(s) at or above "${config.severityFailThreshold}" severity`
    : `no new bugs at or above "${config.severityFailThreshold}" severity ` +
      `(flaky and selector-drift failures never block a merge)`;

  const artifact: RunOutcome = {
    runId,
    timestamp: new Date().toISOString(),
    mode: mock ? 'mock' : 'live',
    target,
    inventory,
    testCases,
    summary,
    triage,
    filedBugs,
    aiCalls: ai.callCount,
    gateFailed,
    gateReason,
  };

  writeJson(path.join(runDir, 'run.json'), artifact);
  updateRunIndex(config, artifact);

  log.success(`Artifacts written to ${path.relative(config.paths.root, runDir).replace(/\\/g, '/')}`);
  log.blank();
  log.table([
    ['Tests', `${summary.passed}/${summary.total} passed`],
    ['Real bugs', String(triage.filter((t) => t.verdict === 'real_bug').length)],
    ['New bugs filed', String(fresh.length)],
    ['AI calls', `${ai.callCount}${mock ? ' (mock — no spend)' : ''}`],
    ['CI gate', gateFailed ? paint('red', 'FAIL') : paint('green', 'PASS')],
  ]);
  log.detail(gateReason);
  log.blank();
  log.info(`Next: ${paint('cyan', 'npm run dashboard')} to view the report.`);
  log.blank();

  return artifact;
}

/** Compact per-run index the dashboard charts as a trend. */
export interface RunIndexEntry {
  runId: string;
  timestamp: string;
  mode: 'live' | 'mock';
  total: number;
  passed: number;
  failed: number;
  realBugs: number;
  flaky: number;
  selectorDrift: number;
  environmentIssues: number;
  newBugs: number;
  gateFailed: boolean;
}

function updateRunIndex(config: ArgusConfig, artifact: RunOutcome): void {
  const indexPath = path.join(config.paths.runs, 'index.json');
  const existing: RunIndexEntry[] = fs.existsSync(indexPath)
    ? (JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as RunIndexEntry[])
    : [];

  const verdicts = summarizeVerdicts(artifact.triage);
  existing.push({
    runId: artifact.runId,
    timestamp: artifact.timestamp,
    mode: artifact.mode,
    total: artifact.summary.total,
    passed: artifact.summary.passed,
    failed: artifact.summary.failed,
    realBugs: verdicts.real_bug,
    flaky: verdicts.flaky,
    selectorDrift: verdicts.selector_drift,
    environmentIssues: verdicts.environment_issue,
    newBugs: newBugs(artifact.filedBugs).length,
    gateFailed: artifact.gateFailed,
  });

  // Keep the trend chart readable and the file small.
  writeJson(indexPath, existing.slice(-30));
}

/** Guard used by the CLI before a live run. */
export function assertRunnable(config: ArgusConfig, mock: boolean): void {
  if (!mock && !config.anthropicApiKey) {
    throw new ArgusError(
      'ANTHROPIC_API_KEY is not set, and --mock was not passed.',
      'Run `argus run --mock` to try Argus with bundled fixtures (no key, no cost), ' +
        'or copy .env.example to .env and add your key.',
    );
  }
}
