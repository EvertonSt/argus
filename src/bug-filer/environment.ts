/**
 * Bug filer — environment auto-detection.
 *
 * PORTED from the Bug Report Generator (`src/environment.js`), including the
 * `systeminformation` dependency and its try/catch degradation to os-only
 * values. Adaptation: the browser is read from ARGUS_BROWSER rather than
 * BUG_REPORT_BROWSER, and the Node version is added since Argus's runs are
 * Node-driven.
 */
import os from 'node:os';
import si from 'systeminformation';
import type { EnvironmentInfo } from '../shared/types.js';

let cached: EnvironmentInfo | null = null;

/**
 * Hardware probing via systeminformation costs well over a second per call on
 * Windows, and the answer cannot change mid-run — so it is memoised. Without
 * this the unit suite spent ~17s re-probing the same CPU.
 */
export async function getEnvironmentInfo(): Promise<EnvironmentInfo> {
  if (cached) return cached;

  const browser = process.env.ARGUS_BROWSER || 'Chromium (Playwright)';
  try {
    const [cpu, mem] = await Promise.all([si.cpu(), si.mem()]);
    cached = {
      os: `${os.type()} ${os.release()}`,
      cpu: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      ramGB: Math.round(mem.total / 1024 / 1024 / 1024),
      browser,
      node: process.version,
    };
  } catch {
    cached = {
      os: os.type(),
      cpu: 'Unknown',
      ramGB: 'Unknown',
      browser,
      node: process.version,
    };
  }
  return cached;
}

/** Test hook: forget the memoised environment. */
export function resetEnvironmentCache(): void {
  cached = null;
}

/** One-line environment string stored on each filed bug. */
export function formatEnvironment(info: EnvironmentInfo): string {
  return `${info.os} · ${info.cpu} · ${info.ramGB}GB RAM · ${info.browser} · Node ${info.node}`;
}
