/**
 * `src/shared/config.ts` and `src/shared/storage.ts` were at 21% and 55%.
 *
 * They are the layer every other module reads from: the environment becomes a
 * typed config, and that config decides which provider is called and therefore
 * whether a run costs money. A silent fallback here does not throw - it quietly
 * points a CI job at the wrong endpoint, or drops a run directory on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, meetsThreshold } from '../../src/shared/config.js';
import {
  ensureDir,
  readJson,
  writeJson,
  appendJsonArray,
  newRunId,
  slugify,
} from '../../src/shared/storage.js';

const ENV_KEYS = [
  'ARGUS_AI_PROVIDER',
  'ARGUS_TARGET',
  'ARGUS_TARGET_URL',
  'TARGET_URL',
  'ARGUS_ANTHROPIC_MODEL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_API_KEY',
  'ARGUS_OPENAI_BASE_URL',
  'ARGUS_OPENAI_MODEL',
  'ARGUS_OPENAI_API_KEY',
  'ARGUS_OPENAI_API_KEY_ENV',
  'ARGUS_CI_THRESHOLD',
  'ARGUS_SEVERITY_FAIL_THRESHOLD',
  'ARGUS_MAX_AI_CALLS',
  'ARGUS_BROWSER',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('loadConfig', () => {
  it('defaults to claude and a local target when nothing is set', () => {
    const config = loadConfig();
    // Defaulting to a paid provider is a deliberate choice, and it is why
    // `assertRunnable` refuses to start without a key. It is recorded here so
    // a change to the default has to change this test.
    expect(config.aiProvider).toBe('claude');
    expect(config.targetUrl).toBe('http://localhost:4317');
    expect(config.maxAiCalls).toBe(100);
    expect(config.browser).toBe('chromium');
  });

  it('reads the provider from ARGUS_AI_PROVIDER', () => {
    process.env.ARGUS_AI_PROVIDER = 'claude';
    expect(loadConfig().aiProvider).toBe('claude');
  });

  it('prefers ARGUS_TARGET over ARGUS_TARGET_URL and TARGET_URL', () => {
    // Three names for one setting is a smell, but changing the precedence now
    // would silently repoint a running CI job. The order is pinned instead.
    process.env.TARGET_URL = 'http://lowest:1';
    process.env.ARGUS_TARGET_URL = 'http://middle:2';
    expect(loadConfig().targetUrl).toBe('http://middle:2');

    process.env.ARGUS_TARGET = 'http://highest:3';
    expect(loadConfig().targetUrl).toBe('http://highest:3');
  });

  it('trims the Anthropic key and treats whitespace as absent', () => {
    process.env.ANTHROPIC_API_KEY = '   sk-ant-test   ';
    expect(loadConfig().anthropicApiKey).toBe('sk-ant-test');

    process.env.ANTHROPIC_API_KEY = '    ';
    // An all-whitespace key that reached the SDK would fail at the request,
    // minutes later, with an error that does not mention the environment.
    expect(loadConfig().anthropicApiKey).toBeUndefined();
  });

  it('does not require a key for ollama, and does for openai-compatible', () => {
    process.env.ARGUS_AI_PROVIDER = 'ollama';
    expect(loadConfig().openaiCompatible.requireApiKey).toBe(false);

    process.env.ARGUS_AI_PROVIDER = 'openai-compatible';
    expect(loadConfig().openaiCompatible.requireApiKey).toBe(true);
  });

  it('falls back to a default base URL for the chosen provider', () => {
    process.env.ARGUS_AI_PROVIDER = 'ollama';
    expect(loadConfig().openaiCompatible.baseUrl).toContain('11434');
  });

  it('lets ARGUS_CI_THRESHOLD win over the longer name', () => {
    process.env.ARGUS_SEVERITY_FAIL_THRESHOLD = 'low';
    expect(loadConfig().severityFailThreshold).toBe('low');

    process.env.ARGUS_CI_THRESHOLD = 'critical';
    expect(loadConfig().severityFailThreshold).toBe('critical');
  });

  it('keeps maxAiCalls numeric even when the env value is junk', () => {
    process.env.ARGUS_MAX_AI_CALLS = 'not-a-number';
    expect(Number.isNaN(loadConfig().maxAiCalls)).toBe(true);
  });

  it('derives every path from the repository root', () => {
    const { paths } = loadConfig();
    expect(paths.data).toBe(path.join(paths.root, 'data'));
    expect(paths.runs).toBe(path.join(paths.root, 'data', 'runs'));
    expect(paths.fixtures.endsWith('fixtures')).toBe(true);
    expect(paths.dashboard.endsWith(path.join('src', 'dashboard'))).toBe(true);
  });
});

describe('severity ordering', () => {
  it('never reports a lower severity as meeting a higher threshold', () => {
    expect(meetsThreshold('low', 'critical')).toBe(false);
    expect(meetsThreshold('critical', 'low')).toBe(true);
  });
});

describe('storage helpers', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-storage-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates nested directories', () => {
    const nested = path.join(dir, 'a', 'b', 'c');
    ensureDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('is idempotent', () => {
    const nested = path.join(dir, 'x');
    ensureDir(nested);
    expect(() => ensureDir(nested)).not.toThrow();
  });

  it('returns the fallback when a file is missing', () => {
    expect(readJson(path.join(dir, 'nope.json'), { ok: true })).toEqual({ ok: true });
  });

  it('returns the fallback rather than throwing on malformed JSON', () => {
    // A half-written artifact is normal after a killed run. Throwing here
    // would turn a recoverable cache miss into a failed pipeline.
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, '{ not json', 'utf-8');
    expect(readJson(file, [])).toEqual([]);
  });

  it('round-trips through writeJson and readJson', () => {
    const file = path.join(dir, 'ok.json');
    writeJson(file, { a: 1, b: [2, 3] });
    expect(readJson(file, {})).toEqual({ a: 1, b: [2, 3] });
  });

  it('creates the parent directory when writing', () => {
    const file = path.join(dir, 'deep', 'nested', 'x.json');
    writeJson(file, { ok: true });
    expect(fs.existsSync(file)).toBe(true);
  });

  it('appends without dropping earlier entries', () => {
    const file = path.join(dir, 'log.json');
    expect(appendJsonArray(file, [{ n: 1 }])).toEqual([{ n: 1 }]);
    expect(appendJsonArray(file, [{ n: 2 }])).toEqual([{ n: 1 }, { n: 2 }]);
    expect(appendJsonArray(file, [])).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('treats a corrupt log as empty rather than losing the run', () => {
    const file = path.join(dir, 'corrupt.json');
    fs.writeFileSync(file, '[[[', 'utf-8');
    expect(appendJsonArray(file, [{ n: 1 }])).toEqual([{ n: 1 }]);
  });

  it('builds a run id that sorts chronologically and is filesystem safe', () => {
    const early = newRunId(new Date('2026-01-02T03:04:05Z'));
    const late = newRunId(new Date('2026-01-02T03:04:06Z'));
    expect(early < late).toBe(true);
    expect(early).toMatch(/^[a-z0-9-]+$/);
  });

  it('gives two runs in the same second different ids', () => {
    // A run directory keyed only to the second would make the second run
    // overwrite the first, and with it the only copy of the evidence.
    const at = new Date('2026-01-02T03:04:05Z');
    expect(newRunId(at)).not.toBe(newRunId(new Date(at.getTime() + 1)));
  });

  it('slugifies into a safe, bounded token', () => {
    expect(slugify('Should apply discount code')).toBe('should-apply-discount-code');
    expect(slugify('a/b\\c:d*e?f')).not.toMatch(/[/\\:*?]/);
    expect(slugify('x'.repeat(200)).length).toBeLessThanOrEqual(40);
    // An empty title still has to produce a usable directory name. Returning
    // "" would put every untitled test case in the same folder.
    expect(slugify('')).toBe('item');
    expect(slugify('---')).toBe('item');
    expect(slugify('Añadir café')).toBe('anadir-cafe');
  });
});
