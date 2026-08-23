/**
 * Execution — running the generated Playwright suite.
 *
 * Invoked via the Playwright CLI with the JSON reporter, and the structured
 * report is parsed back into a typed RunSummary (see ./parse-report.ts).
 * Deliberately NOT "shell out and scrape stdout": the JSON report is the
 * contract, so a formatting change in Playwright's console output can never
 * silently break triage.
 *
 * No LLM calls occur in this module. Execution is fully deterministic.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import type { RunSummary } from '../shared/types.js';
import { DOM_SNAPSHOT_SCRIPT } from '../ingestion/browser-script.js';
import { ensureDir, readJson } from '../shared/storage.js';
import { log } from '../shared/logger.js';
import { parsePlaywrightReport, type PwReport } from './parse-report.js';

export interface ExecuteOptions {
  runId: string;
  /** Repo root — Playwright is invoked from here. */
  cwd: string;
  /** Where run artifacts (report, traces, screenshots) are written. */
  runDir: string;
  /** baseURL handed to Playwright. */
  targetUrl: string;
  timeoutMs?: number;
}

export async function executeSuite(options: ExecuteOptions): Promise<RunSummary> {
  const { runId, cwd, runDir, targetUrl } = options;
  ensureDir(runDir);

  const reportPath = path.join(runDir, 'playwright-report.json');
  const artifactsDir = path.join(runDir, 'artifacts');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ARGUS_TARGET_URL: targetUrl,
    ARGUS_PW_JSON: reportPath,
    ARGUS_PW_ARTIFACTS: artifactsDir,
  };

  const exitCode = await new Promise<number>((resolve) => {
    // No `--reporter` flag here: passing one on the CLI overrides the config's
    // reporter entry *including* its outputFile, which sends the JSON report
    // to stdout instead of to disk. The config already declares the JSON
    // reporter, and ARGUS_PW_JSON points it at this run's directory.
    const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test'], {
      cwd,
      env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Playwright writes the JSON report to the configured file; its stdout is
    // noise here, but a hard crash needs surfacing, so stderr is retained.
    let stderr = '';
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill();
      log.warn('Playwright run exceeded its timeout and was terminated.');
      resolve(-1);
    }, options.timeoutMs ?? 180_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && stderr.trim()) {
        for (const line of stderr.trim().split('\n').slice(-4)) log.detail(line);
      }
      resolve(code ?? -1);
    });
  });

  if (!fs.existsSync(reportPath)) {
    throw new Error(
      `Playwright produced no JSON report (exit code ${exitCode}). ` +
        `Check that the target app is reachable at ${targetUrl}.`,
    );
  }

  const report = readJson<PwReport>(reportPath, {});
  const summary = parsePlaywrightReport(report);
  summary.runId = runId;

  // Rewrite artifact paths to be relative to the repo root so the dashboard
  // can link to them regardless of where it is served from.
  for (const failure of summary.failures) {
    if (failure.screenshotPath) {
      failure.screenshotPath = path.relative(cwd, failure.screenshotPath).replace(/\\/g, '/');
    }
    if (failure.tracePath) {
      failure.tracePath = path.relative(cwd, failure.tracePath).replace(/\\/g, '/');
    }
  }

  return summary;
}

/**
 * Capture the DOM of the failing route, so triage can reason about what the
 * page actually contained rather than guessing from the error text alone.
 * Best-effort: a failure to capture must never fail the run.
 */
export async function captureDomSnapshots(
  summary: RunSummary,
  routeFor: (testCaseId: string) => string,
  baseUrl: string,
): Promise<void> {
  if (summary.failures.length === 0) return;

  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    for (const failure of summary.failures) {
      try {
        const route = routeFor(failure.testCaseId);
        await page.goto(new URL(route, baseUrl).toString(), {
          waitUntil: 'domcontentloaded',
          timeout: 10_000,
        });
        failure.domSnapshot = (await page.evaluate(DOM_SNAPSHOT_SCRIPT)) as string;
      } catch {
        // A missing snapshot degrades triage quality slightly; it is not fatal.
      }
    }
  } catch {
    log.warn('Could not capture DOM snapshots for triage — continuing without them.');
  } finally {
    await browser?.close();
  }
}

export * from './parse-report.js';
