#!/usr/bin/env node
/**
 * Capture a real `argus run --mock` for the README recording.
 *
 * Spawns the actual CLI and records every stdout chunk with the millisecond
 * offset at which it arrived. The renderer replays those offsets, so the GIF's
 * pacing is the run's real pacing — no invented timings, no staged output.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'docs/run-capture.json';

const started = Date.now();
const chunks: Array<{ t: number; text: string }> = [];

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsx', 'src/cli/index.ts', 'run', '--mock'],
  {
    // FORCE_COLOR so the captured stream keeps its ANSI codes even though
    // stdout is a pipe here rather than a terminal.
    //
    // The npm_config_* pair silences npm's own warnings and notices, which are
    // artefacts of the local npm setup rather than anything Argus prints — they
    // would otherwise open the recording with three lines of unrelated noise.
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      npm_config_loglevel: 'silent',
      npm_config_foreground_scripts: 'false',
    },
    shell: process.platform === 'win32',
  },
);

child.stdout.on('data', (buf: Buffer) => {
  chunks.push({ t: Date.now() - started, text: buf.toString('utf8') });
  process.stdout.write(buf);
});
child.stderr.on('data', (buf: Buffer) => {
  chunks.push({ t: Date.now() - started, text: buf.toString('utf8') });
  process.stderr.write(buf);
});

child.on('close', (code) => {
  const total = Date.now() - started;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ exitCode: code, totalMs: total, chunks }, null, 2));
  process.stdout.write(`\nCaptured ${chunks.length} chunks over ${(total / 1000).toFixed(1)}s -> ${out}\n`);
});
