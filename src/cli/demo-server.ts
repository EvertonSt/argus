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
  stop: () => Promise<void>;
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

async function waitUntilGone(url: string, attempts = 20): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (!(await isReachable(url))) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

/**
 * Shut the spawned demo app down, for real.
 *
 * `child.kill()` alone is not enough on Windows. With `shell: true` the tree is
 * cmd.exe → npx.cmd → tsx → node, and killing the top of it orphans the node
 * process that actually holds the port — so the next `argus run` dies with
 * EADDRINUSE against a server nobody can see.
 *
 * So: ask the app to exit via its own /__shutdown endpoint (reliable no matter
 * how deeply it is wrapped), and only fall back to killing the process tree if
 * it will not go quietly.
 */
export async function stopSpawnedServer(child: ChildProcess, url: string): Promise<void> {
  try {
    await fetch(new URL('/__shutdown', url).toString(), { method: 'POST' });
  } catch {
    // The socket closes as the server exits, so a network error here is the
    // expected outcome rather than a failure.
  }

  if (await waitUntilGone(url)) return;

  // Still up — kill the whole tree rather than just the shell wrapper.
  try {
    if (process.platform === 'win32' && typeof child.pid === 'number') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  } catch {
    // Already gone — nothing to do.
  }
}

/**
 * Ensure something is serving at `url`. Returns a handle whose `stop()` is a
 * no-op when the app was already running (we never kill a server we did not
 * start).
 */
export async function ensureDemoApp(root: string, url: string): Promise<DemoServer> {
  if (await isReachable(url)) {
    log.item(`Target already reachable at ${url}`);
    return { stop: async () => {}, started: false };
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
    await stopSpawnedServer(child, url);
    throw new Error(
      `The bundled demo app did not come up at ${url}. ` +
        `Start it manually with \`npm run demo\` and re-run.`,
    );
  }

  log.success(`Demo app running at ${url}`);
  return {
    started: true,
    stop: () => stopSpawnedServer(child, url),
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
