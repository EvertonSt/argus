/**
 * `src/cli/pipeline.ts` was at 0% coverage: the orchestrator that decides
 * whether a merge is blocked had no test at all.
 *
 * `runPipeline` itself drives a real browser, so it is exercised end to end by
 * the QA workflow rather than here. What is unit-testable - and what actually
 * decides a merge - is `assertRunnable`, the precondition check, and the
 * severity threshold arithmetic that `gateFailed` is derived from.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { assertRunnable } from '../../src/cli/pipeline.js';
import { loadConfig, meetsThreshold } from '../../src/shared/config.js';
import { ArgusError } from '../../src/shared/provider.js';
import type { ArgusConfig } from '../../src/shared/config.js';

const SAVED = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED };
});

/**
 * Built from the real loader with the environment cleared, rather than
 * hand-written as an object literal.
 *
 * An earlier version of this file spelled the fixture out by hand and cast it
 * with `as ArgusConfig`. It type-checked, it passed, and it was wrong: three of
 * the field names did not exist on the real type, so the cast hid a fixture
 * that could not have come from production. Deriving it means the test cannot
 * drift from the shape without failing.
 */
function config(overrides: Partial<ArgusConfig> = {}): ArgusConfig {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('ARGUS_') || key.startsWith('ANTHROPIC') || key.startsWith('OPENAI_')) {
      delete process.env[key];
    }
  }
  return { ...loadConfig(), ...overrides };
}

describe('assertRunnable', () => {
  it('allows --mock regardless of provider', () => {
    // A fork or a Dependabot PR has no key. Failing here would hand them a red
    // X they have no way to fix, which is how a QA tool gets uninstalled.
    expect(() => assertRunnable(config({ aiProvider: 'claude' }), true)).not.toThrow();
    expect(() => assertRunnable(config({ aiProvider: 'claude' }), false)).toThrow(ArgusError);
  });

  it('allows a mock provider without the flag', () => {
    expect(() => assertRunnable(config({ aiProvider: 'mock' }), false)).not.toThrow();
  });

  it('names both remedies when the key is missing', () => {
    try {
      assertRunnable(config({ aiProvider: 'claude' }), false);
      expect.unreachable('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('ANTHROPIC_API_KEY');
      expect(message).toContain('--mock');
    }
  });

  it('rejects an openai-compatible provider with a required key and none set', () => {
    expect(() =>
      assertRunnable(
        config({
          aiProvider: 'openai-compatible',
          openaiCompatible: {
            baseUrl: 'http://localhost:11434/v1',
            model: 'llama3',
            apiKeyEnv: 'OPENAI_API_KEY',
            apiKey: '',
            requireApiKey: true,
          },
        }),
        false,
      ),
    ).toThrow(ArgusError);
  });

  it('allows an openai-compatible provider when the key is optional and absent', () => {
    // Ollama and most local runtimes have no key at all. Requiring one there
    // would make the provider unusable.
    expect(() =>
      assertRunnable(
        config({
          aiProvider: 'ollama',
          openaiCompatible: {
            baseUrl: 'http://localhost:11434/v1',
            model: 'llama3',
            apiKeyEnv: 'OPENAI_API_KEY',
            apiKey: '',
            requireApiKey: false,
          },
        }),
        false,
      ),
    ).not.toThrow();
  });
});

describe('severity threshold', () => {
  const ORDER = ['low', 'medium', 'high', 'critical'] as const;

  it('is monotonic', () => {
    for (let i = 0; i < ORDER.length; i++) {
      for (let j = 0; j < ORDER.length; j++) {
        expect(meetsThreshold(ORDER[i], ORDER[j])).toBe(i >= j);
      }
    }
  });

  it('treats the threshold as inclusive', () => {
    // A bug exactly at the configured threshold has to fail the build. An
    // exclusive comparison would silently let the boundary case through.
    expect(meetsThreshold('high', 'high')).toBe(true);
    expect(meetsThreshold('critical', 'high')).toBe(true);
    expect(meetsThreshold('medium', 'high')).toBe(false);
  });
});
