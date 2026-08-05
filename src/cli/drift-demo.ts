#!/usr/bin/env node
/**
 * Selector-drift demo.
 *
 * Proves Argus can tell "the UI changed" apart from "the app is broken".
 *
 *   1. Run the pipeline normally. Tests are generated against a button
 *      labelled "Add task".
 *   2. Restart the demo app with DEMO_DRIFT=1, which relabels that button
 *      "Create task". Nothing about the feature's behaviour changes.
 *   3. Re-execute the ALREADY GENERATED suite. The add-task test now fails
 *      because its locator is stale.
 *   4. Triage classifies that failure as `selector_drift`, not `real_bug`,
 *      and proposes a fix — which Argus deliberately does not apply.
 *
 * Deliberately re-runs only execution and triage: regenerating the tests would
 * just produce new selectors and erase the very drift being demonstrated.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from '../shared/config.js';
import { createAiClient } from '../shared/ai-client.js';
import { log, paint } from '../shared/logger.js';
import { ensureDir, newRunId, readJson, writeJson } from '../shared/storage.js';
import { executeSuite, captureDomSnapshots } from '../execution/index.js';
import { triageFailures } from '../triage/index.js';
import { pendingSelfHeals } from '../triage/validate.js';
import { isReachable } from './demo-server.js';
import type { TestCase } from '../shared/types.js';

/**
 * The pipeline auto-starts the demo app and, on Windows especially, the child
 * can outlive the run that spawned it. Rather than telling the user to go
 * hunt a PID, ask the app to shut itself down via its own endpoint.
 */
async function stopWhateverHoldsThePort(url: string): Promise<void> {
  if (!(await isReachable(url))) return;

  log.item('Stopping the existing demo app so it can be restarted with the rename');
  try {
    await fetch(new URL('/__shutdown', url).toString(), { method: 'POST' });
  } catch {
    // The server closes the socket as it exits, so a network error here is
    // the expected outcome rather than a failure.
  }

  for (let i = 0; i < 40; i += 1) {
    if (!(await isReachable(url))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  log.error(
    `Could not free ${url} — something other than the bundled demo app is serving it.`,
    'Stop that process, then re-run `npm run demo:drift`.',
  );
  process.exit(2);
}

async function waitFor(url: string, attempts = 40): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await isReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const target = config.targetUrl;
  const mock = process.argv.includes('--mock') || !config.anthropicApiKey;

  const testCases = readJson<TestCase[]>(config.paths.testCases, []);
  if (testCases.length === 0) {
    log.error(
      'No generated test cases found.',
      'Run `npm run run:mock` first — this demo re-uses the suite that run produced.',
    );
    process.exit(2);
  }

  log.banner('Selector-drift demo · the UI changed, the app did not');
  log.info(
    'Restarting the demo app with the add button relabelled ' +
      `${paint('yellow', '"Add task" → "Create task"')}, then re-running the EXISTING suite.`,
  );
  log.blank();

  await stopWhateverHoldsThePort(target);

  const port = new URL(target).port || '4317';
  const child: ChildProcess = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', path.join('demo-app', 'src', 'server.ts')],
    {
      cwd: config.paths.root,
      env: { ...process.env, DEMO_PORT: port, DEMO_DRIFT: '1' },
      shell: process.platform === 'win32',
      stdio: 'ignore',
    },
  );

  try {
    if (!(await waitFor(target))) throw new Error(`Drifted demo app never came up at ${target}`);
    log.success(`Demo app restarted with the renamed button at ${target}`);

    const runId = newRunId();
    const runDir = path.join(config.paths.runs, runId);
    ensureDir(runDir);

    log.stage('Execute', 'running the pre-drift suite against the changed UI');
    const summary = await executeSuite({
      runId,
      cwd: config.paths.root,
      runDir,
      targetUrl: target,
    });
    log.success(`${summary.passed} passed, ${summary.failed} failed`);

    log.stage('Triage', 'is this a bug, or did the UI just move?');
    const routeFor = (id: string): string =>
      testCases.find((tc) => tc.id === id)?.targetRoute ?? '/';
    await captureDomSnapshots(summary, routeFor, target);

    const ai = createAiClient(config, mock);
    const triage = await triageFailures(summary, {
      ai,
      testCases,
      fixturesDir: config.paths.fixtures,
      logPath: config.paths.triageLog,
    });

    writeJson(path.join(runDir, 'summary.json'), summary);

    const drift = pendingSelfHeals(triage);
    log.blank();
    if (drift.length > 0) {
      log.success(
        `${drift.length} failure(s) classified as ${paint('blue', 'selector_drift')} ` +
          `— reported for review, ${paint('green', 'not filed as bugs')}.`,
      );
      for (const result of drift) {
        log.item(`${result.testCaseId}`);
        log.detail(result.reasoning);
        log.detail(`${paint('blue', 'suggested fix:')} ${result.suggestedFix}`);
      }
      log.blank();
      log.info('Argus never applies these automatically — a human approves every change.');
    } else {
      log.warn('No selector drift detected. Was the suite generated before the rename?');
    }
    log.blank();
  } finally {
    child.kill();
  }
}

main().catch((error: unknown) => {
  log.error((error as Error).message);
  process.exit(2);
});
