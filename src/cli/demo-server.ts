/**
 * Demo-app lifecycle helper.
 *
 * `argus run --mock` has to work on a fresh clone with no setup, so if the
 * default target is not already serving, Argus starts the bundled demo app
 * itself and shuts it down when the run ends.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { log } from '../shared/logger.js';

export interface DemoServer {
  stop: () => void;
  started: boolean;
}

export async function isReachable(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReachable(url: string, attempts = 30): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (await isReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

/**
 * Ensure something is serving at `url`. Returns a handle whose `stop()` is a
 * no-op when the app was already running (we never kill a server we did not
 * start).
 */
export async function ensureDemoApp(root: string, url: string): Promise<DemoServer> {
  if (await isReachable(url)) {
    log.item(`Target already reachable at ${url}`);
    return { stop: () => {}, started: false };
  }

  log.item(`No server at ${url} — starting the bundled demo app`);

  const port = new URL(url).port || '4317';
  const child: ChildProcess = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsx', path.join('demo-app', 'src', 'server.ts')],
    {
      cwd: root,
      env: { ...process.env, DEMO_PORT: port },
      shell: process.platform === 'win32',
      stdio: 'ignore',
      detached: false,
    },
  );

  const ready = await waitUntilReachable(url);
  if (!ready) {
    child.kill();
    throw new Error(
      `The bundled demo app did not come up at ${url}. ` +
        `Start it manually with \`npm run demo\` and re-run.`,
    );
  }

  log.success(`Demo app running at ${url}`);
  return {
    started: true,
    stop: () => {
      try {
        child.kill();
      } catch {
        // Already gone — nothing to do.
      }
    },
  };
}

/** Reset the demo app's in-memory state so runs are comparable. */
export async function resetDemoApp(url: string): Promise<void> {
  try {
    await fetch(new URL('/__reset', url).toString());
  } catch {
    // Not the bundled demo app, or not reachable — harmless.
  }
}
