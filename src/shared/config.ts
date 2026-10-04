/**
 * Configuration loader.
 *
 * Every tunable lives here, read once at startup. The AI provider and model
 * are deliberately config values rather than literals anywhere in the
 * codebase, so they can be swapped without a code change — mirroring
 * Cerberus CI's provider-agnostic architecture.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProviderName } from './provider.js';
import type { Severity } from './types.js';
import { PRIORITIES } from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');

export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey: string | undefined;
  apiKeyEnv: string;
  requireApiKey: boolean;
}

export interface ArgusConfig {
  aiProvider: ProviderName;
  anthropicApiKey: string | undefined;
  anthropicModel: string;
  openaiCompatible: OpenAICompatibleConfig;
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

function defaultBaseUrlFor(provider: ProviderName): string | undefined {
  if (provider === 'ollama') return 'http://localhost:11434/v1';
  return undefined;
}

function defaultModelFor(provider: ProviderName, raw: string | undefined): string {
  if (raw?.trim()) return raw.trim();
  switch (provider) {
    case 'claude':
      return 'claude-sonnet-4-20250514';
    case 'openai-compatible':
      return 'gpt-4o';
    case 'ollama':
      return 'llama3.1:latest';
    default:
      return 'claude-sonnet-4-20250514';
  }
}

const PROVIDER_ALIASES: Record<string, ProviderName> = {
  claude: 'claude',
  anthropic: 'claude',
  'openai-compatible': 'openai-compatible',
  openai: 'openai-compatible',
  openrouter: 'openai-compatible',
  groq: 'openai-compatible',
  together: 'openai-compatible',
  deepseek: 'openai-compatible',
  'lm-studio': 'openai-compatible',
  lmstudio: 'openai-compatible',
  ollama: 'ollama',
  mock: 'mock',
};

function parseProvider(raw: string | undefined): ProviderName {
  const value = (raw ?? 'claude').trim().toLowerCase();
  const resolved = PROVIDER_ALIASES[value];
  if (!resolved) {
    throw new Error(
      `ARGUS_AI_PROVIDER must be one of ${Object.keys(PROVIDER_ALIASES).join(', ')} — got "${raw}".`,
    );
  }
  return resolved;
}

function parseThreshold(raw: string | undefined): Severity {
  const value = (raw ?? 'high').trim().toLowerCase();
  for (const s of [...PRIORITIES]) {
    if (s === value) return s as Severity;
  }
  return 'high';
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

/** Check whether a severity passes the CI gate threshold (deterministic). */
export function meetsThreshold(severity: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[threshold];
}

/**
 * Load configuration from environment variables.
 * Mirrors Cerberus CI's config-driven approach.
 */
export function loadConfig(): ArgusConfig {
  const aiProvider = parseProvider(process.env.ARGUS_AI_PROVIDER);
  const targetUrl =
    process.env.ARGUS_TARGET ||
    process.env.ARGUS_TARGET_URL ||
    process.env.TARGET_URL ||
    'http://localhost:4317';

  const config: ArgusConfig = {
    aiProvider,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
    anthropicModel:
      process.env.ARGUS_ANTHROPIC_MODEL ||
      process.env.ANTHROPIC_MODEL ||
      'claude-sonnet-4-20250514',
    openaiCompatible: {
      baseUrl:
        process.env.ARGUS_OPENAI_BASE_URL ||
        process.env.OPENAI_BASE_URL ||
        defaultBaseUrlFor(aiProvider) ||
        '',
      model:
        process.env.ARGUS_OPENAI_MODEL || defaultModelFor(aiProvider, process.env.OPENAI_MODEL),
      apiKey: process.env.ARGUS_OPENAI_API_KEY || 'OPENAI_API_KEY',
      apiKeyEnv: process.env.ARGUS_OPENAI_API_KEY_ENV || 'OPENAI_API_KEY',
      requireApiKey: aiProvider !== 'ollama' && aiProvider !== 'mock',
    },
    targetUrl,
    severityFailThreshold: parseThreshold(
      process.env.ARGUS_CI_THRESHOLD ?? process.env.ARGUS_SEVERITY_FAIL_THRESHOLD,
    ),
    maxAiCalls: parseInt(process.env.ARGUS_MAX_AI_CALLS || '100', 10),
    browser: process.env.ARGUS_BROWSER || 'chromium',
    paths: {
      root: ROOT,
      data: path.join(ROOT, 'data'),
      runs: path.join(ROOT, 'data', 'runs'),
      generatedTests: path.join(ROOT, 'generated-tests'),
      fixtures: path.join(ROOT, 'fixtures'),
      dashboard: path.join(ROOT, 'src', 'dashboard'),
      demoApp: path.join(ROOT, 'demo-app'),
      testCases: path.join(ROOT, 'data', 'test-cases.json'),
      bugs: path.join(ROOT, 'data', 'bugs.json'),
      inventory: path.join(ROOT, 'data', 'inventory.json'),
      triageLog: path.join(ROOT, 'data', 'triage.log'),
    },
  };

  return config;
}
