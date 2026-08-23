#!/usr/bin/env node
/**
 * Argus CLI.
 *
 * Commands:
 *   argus run --target <url|specs>   run the full pipeline
 *   argus run --mock                 run it with fixtures — no API key, no cost
 *   argus dashboard                  serve the dashboard and print the URL
 *   argus triage-log                 print the last run's triage reasoning
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Command } from 'commander';
import { loadConfig } from '../shared/config.js';
import { ArgusError } from '../shared/ai-client.js';
import { log, paint, severityBadge, verdictBadge } from '../shared/logger.js';
import { readJson } from '../shared/storage.js';
import type { FiledBug, TriageLogEntry } from '../shared/types.js';
import { assertRunnable, runPipeline } from './pipeline.js';
import { ensureDemoApp, resetDemoApp } from './demo-server.js';
import { renderPrComment, type CiReportInput, buildDashboardData } from './ci-report.js';

const program = new Command();

program
  .name('argus')
  .description('Autonomous AI QA agent — plans, runs, triages, and files.')
  .version('1.0.0');

// ---------------------------------------------------------------------------
// argus run
// ---------------------------------------------------------------------------

program
  .command('run')
  .description('Run the full QA pipeline once.')
  .option('-t, --target <url>', 'URL of the application under test')
  .option('-s, --specs <path>', 'folder of markdown feature specs')
  .option('--mock', 'use bundled fixtures instead of live Anthropic calls', false)
  .option('--max-cases <n>', 'maximum test cases to plan', '12')
  .action(async (options: { target?: string; specs?: string; mock: boolean; maxCases: string }) => {
    const config = loadConfig();
    let demo: { stop: () => void } | null = null;

    try {
      assertRunnable(config, options.mock);

      const target = options.target ?? config.targetUrl;

      // Only manage the demo app when the target is the bundled default.
      if (target === config.targetUrl) {
        demo = await ensureDemoApp(config.paths.root, target);
        await resetDemoApp(target);
      }

      const outcome = await runPipeline({
        config,
        target,
        specs: options.specs,
        mock: options.mock,
        maxCases: Number(options.maxCases) || 12,
      });

      // Await the shutdown before exiting: process.exit() would otherwise
      // terminate this CLI mid-request and orphan the demo app, leaving the
      // port held and the next run dead on EADDRINUSE.
      await demo?.stop();
      process.exit(outcome.gateFailed ? 1 : 0);
    } catch (error) {
      await demo?.stop();
      if (error instanceof ArgusError) {
        log.error(error.message, error.hint);
      } else {
        log.error((error as Error).message);
      }
      process.exit(2);
    }
  });

// ---------------------------------------------------------------------------
// argus dashboard
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

program
  .command('dashboard')
  .description('Serve the dashboard locally and print its URL.')
  .option('-p, --port <port>', 'port to listen on', '4318')
  .action((options: { port: string }) => {
    const config = loadConfig();
    const port = Number(options.port) || 4318;

    // Serves the repo root, and redirects "/" to the dashboard rather than
    // serving its HTML at "/". Serving it at the root would make the page's
    // base URL "/", so relative asset paths ("styles.css", "../../data/...")
    // would resolve to the wrong place and 404 — which silently left the
    // dashboard blank. A redirect keeps the base URL correct, so the exact
    // same relative paths work over http:// and file:// alike.
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === '/') {
        res.writeHead(302, { Location: '/src/dashboard/index.html' }).end();
        return;
      }

      const filePath = path.join(config.paths.root, pathname);
      // Refuse to serve anything outside the repo.
      if (!filePath.startsWith(config.paths.root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(filePath).pipe(res);
    });

    server.listen(port, () => {
      log.blank();
      log.success(`Argus dashboard: ${paint('cyan', `http://localhost:${port}`)}`);
      log.detail('Press Ctrl+C to stop.');
      log.blank();
    });
  });

// ---------------------------------------------------------------------------
// argus triage-log
// ---------------------------------------------------------------------------

program
  .command('triage-log')
  .description("Print the most recent run's triage reasoning.")
  .action(() => {
    const config = loadConfig();
    const entries = readJson<TriageLogEntry[]>(config.paths.triageLog, []);

    if (entries.length === 0) {
      log.blank();
      log.warn('No triage log yet. Run `argus run --mock` first.');
      log.blank();
      return;
    }

    log.blank();
    process.stdout.write(
      `${paint('bold', 'Triage decisions')} ${paint('dim', `· run ${entries[0]?.runId ?? 'unknown'}`)}\n\n`,
    );

    for (const entry of entries) {
      const confidence = `${Math.round(entry.confidence * 100)}%`;
      process.stdout.write(
        `  ${verdictBadge(entry.verdict)} ${paint('dim', `(${confidence})`)}  ${entry.testTitle}\n`,
      );
      process.stdout.write(`    ${paint('gray', entry.reasoning)}\n`);
      if (entry.suggestedFix) {
        process.stdout.write(
          `    ${paint('blue', 'suggested fix:')} ${paint('gray', entry.suggestedFix)}\n`,
        );
      }
      process.stdout.write(
        `    ${paint('gray', `error: ${entry.errorMessage.split('\n')[0]}`)}\n\n`,
      );
    }

    const bugs = readJson<FiledBug[]>(config.paths.bugs, []);
    const recent = bugs.filter((bug) => bug.runId === entries[0]?.runId);
    if (recent.length > 0) {
      process.stdout.write(`${paint('bold', 'Bugs filed from this run')}\n\n`);
      for (const bug of recent) {
        const dup = bug.isDuplicateOf ? paint('dim', ` (duplicate of ${bug.isDuplicateOf})`) : '';
        process.stdout.write(`  ${severityBadge(bug.severity)}  ${bug.title}${dup}\n`);
      }
      process.stdout.write('\n');
    }
  });

// ---------------------------------------------------------------------------
// argus ci-comment
// ---------------------------------------------------------------------------

program
  .command('dashboard:build')
  .description('Generate a static JSON export of dashboard data for Vercel deployment.')
  .action(() => {
    const config = loadConfig();
    const data = buildDashboardData(config);
    const exportDir = path.join(config.paths.root, 'dashboard', 'data');
    fs.mkdirSync(exportDir, { recursive: true });
    for (const [name, json] of Object.entries(data)) {
      fs.writeFileSync(path.join(exportDir, name), JSON.stringify(json, null, 2));
    }
    log.success(`Dashboard data exported to ${path.relative(config.paths.root, exportDir)}/`);
    log.info('Run `cd dashboard && npm install && npm run build` to build the Next.js site.');
  });

program
  .command('ci-comment')
  .description('Render the latest run as a markdown PR comment (used by CI).')
  .option('-o, --out <path>', 'write the comment to a file instead of stdout')
  .action((options: { out?: string }) => {
    const config = loadConfig();
    const indexPath = path.join(config.paths.runs, 'index.json');
    const index = readJson<Array<{ runId: string }>>(indexPath, []);
    const latest = index[index.length - 1];

    if (!latest) {
      log.error('No runs found. Run `argus run` first.');
      process.exit(2);
    }

    const artifact = readJson<CiReportInput | null>(
      path.join(config.paths.runs, latest.runId, 'run.json'),
      null,
    );
    if (!artifact) {
      log.error(`Run artifact missing for ${latest.runId}.`);
      process.exit(2);
    }

    const markdown = renderPrComment({ ...artifact, threshold: config.severityFailThreshold });
    if (options.out) {
      fs.writeFileSync(options.out, markdown, 'utf-8');
      log.success(`PR comment written to ${options.out}`);
    } else {
      process.stdout.write(`${markdown}\n`);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  log.error((error as Error).message);
  process.exit(2);
});
