/**
 * Configuration loader.
 *
 * Every tunable lives here, read once at startup. The Anthropic model name is
 * deliberately a config value rather than a literal anywhere in the codebase,
 * so it can be swapped without a code change.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Severity } from './types.js';
import { PRIORITIES } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo root, resolved from this file's location (src/shared → ../..). */
export const ROOT = path.resolve(here, '..', '..');

export interface ArgusConfig {
  anthropicApiKey: string | undefined;
  anthropicModel: string;
  targetUrl: string;
  severityFailThreshold: Severity;
  maxAiCalls: number;
  browser: string;
  paths: {
    root: string;
    data: string;
    runs: string;
    generatedTests: string;
    fixtures: string;
    dashboard: string;
    demoApp: string;
    testCases: string;
    bugs: string;
    inventory: string;
    triageLog: string;
  };
}

function parseThreshold(raw: string | undefined): Severity {
  const value = (raw ?? 'high').trim().toLowerCase();
  if ((PRIORITIES as readonly string[]).includes(value)) return value as Severity;
  throw new Error(
    `ARGUS_SEVERITY_FAIL_THRESHOLD must be one of ${PRIORITIES.join(', ')} — got "${raw}".`,
  );
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer — got "${raw}".`);
  }
  return n;
}

export function loadConfig(): ArgusConfig {
  const data = path.join(ROOT, 'data');
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-20250514',
    targetUrl: process.env.ARGUS_TARGET_URL?.trim() || 'http://localhost:4317',
    severityFailThreshold: parseThreshold(process.env.ARGUS_SEVERITY_FAIL_THRESHOLD),
    maxAiCalls: parsePositiveInt(process.env.ARGUS_MAX_AI_CALLS, 25, 'ARGUS_MAX_AI_CALLS'),
    browser: process.env.ARGUS_BROWSER?.trim() || 'Chromium (Playwright)',
    paths: {
      root: ROOT,
      data,
      runs: path.join(data, 'runs'),
      generatedTests: path.join(ROOT, 'generated-tests'),
      fixtures: path.join(ROOT, 'fixtures'),
      dashboard: path.join(ROOT, 'src', 'dashboard'),
      demoApp: path.join(ROOT, 'demo-app'),
      testCases: path.join(data, 'test-cases.json'),
      bugs: path.join(data, 'bugs.json'),
      inventory: path.join(data, 'inventory.json'),
      triageLog: path.join(data, 'triage-log.json'),
    },
  };
}

/**
 * Severity ordering used by the CI gate. Higher number = more severe.
 */
export const SEVERITY_RANK: Record<Severity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}
