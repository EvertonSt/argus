/**
 * The live providers are the part of Argus that spends money and talks to the
 * network, and they sat at ~30% because the existing suite only covered the
 * mock. Everything here runs against a stubbed transport: no key, no request,
 * no cost.
 *
 * What is worth pinning down is the behaviour that a bad run would otherwise
 * expose late:
 *
 *   - the call cap, because it is the only thing standing between a runaway
 *     loop and a real bill
 *   - the retry classification, because retrying an auth error spends time to
 *     fail identically while retrying a 529 is the whole point
 *   - the error message, because it is what a person reads at 2am
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeProvider, OpenAICompatibleProvider, ArgusError } from '../../src/shared/provider.js';
import { loadConfig } from '../../src/shared/config.js';
import type { ArgusConfig } from '../../src/shared/config.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function baseConfig(overrides: Partial<ArgusConfig> = {}): ArgusConfig {
  return {
    ...loadConfig(),
    aiProvider: 'claude',
    anthropicApiKey: 'sk-ant-test',
    maxAiCalls: 3,
    ...overrides,
  } as ArgusConfig;
}

describe('ClaudeProvider', () => {
  it('refuses to construct without a key', () => {
    // Constructing a provider is the moment the key is known to be absent, so
    // this is the cheapest place to fail and the clearest message to print.
    expect(() => new ClaudeProvider(baseConfig({ anthropicApiKey: undefined }))).toThrow(
      ArgusError,
    );
  });

  it('names both ways forward when the key is missing', () => {
    try {
      new ClaudeProvider(baseConfig({ anthropicApiKey: undefined }));
      expect.unreachable('should have thrown');
    } catch (err) {
      const error = err as ArgusError;
      expect(error.message).toContain('ANTHROPIC_API_KEY');
      expect(error.hint ?? '').toContain('--mock');
    }
  });

  it('stops at the configured call cap instead of billing without limit', async () => {
    const provider = new ClaudeProvider(baseConfig({ maxAiCalls: 2 }));
    // The transport is replaced wholesale, so the cap is what is under test.
    (provider as unknown as { client: { messages: { create: unknown } } }).client = {
      messages: { create: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }) },
    } as never;

    await provider.complete({ system: 's', user: 'p', purpose: 'planner' });
    await provider.complete({ system: 's', user: 'p', purpose: 'planner' });

    await expect(provider.complete({ system: 's', user: 'p', purpose: 'planner' })).rejects.toThrow(
      /cap reached/i,
    );

    expect(provider.callCount).toBe(2);
  });

  it('retries a 529 overload and then succeeds', async () => {
    // 529 is Anthropic's overloaded_error. It was missing from the transient
    // set, so a momentary capacity blip failed the entire run on the first
    // attempt. This test is why it is there.
    const provider = new ClaudeProvider(baseConfig({ maxAiCalls: 5 }));
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('overloaded'), { status: 529 }))
      .mockResolvedValue({ content: [{ type: 'text', text: 'recovered' }] });
    (provider as unknown as { client: unknown }).client = { messages: { create } };

    const out = await provider.complete({ system: 's', user: 'p', purpose: 'planner' });
    expect(out).toContain('recovered');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries a 503 and then succeeds', async () => {
    const provider = new ClaudeProvider(baseConfig({ maxAiCalls: 5 }));
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('bad gateway'), { status: 503 }))
      .mockResolvedValue({ content: [{ type: 'text', text: 'recovered' }] });
    (provider as unknown as { client: unknown }).client = { messages: { create } };

    await provider.complete({ system: 's', user: 'p', purpose: 'planner' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('retries a network-level error with no status', async () => {
    // ECONNRESET reaches here with no HTTP status at all, which is a different
    // branch of isTransient than the 5xx path above.
    const provider = new ClaudeProvider(baseConfig({ maxAiCalls: 5 }));
    const create = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
      .mockResolvedValue({ content: [{ type: 'text', text: 'recovered' }] });
    (provider as unknown as { client: unknown }).client = { messages: { create } };

    await provider.complete({ system: 's', user: 'p', purpose: 'planner' });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 and says it tried once', async () => {
    // The message used to claim "after 4 attempts" however many were made,
    // which sends the reader hunting for a retry bug that is not there.
    const provider = new ClaudeProvider(baseConfig({ maxAiCalls: 5 }));
    const create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('bad request'), { status: 400 }));
    (provider as unknown as { client: unknown }).client = { messages: { create } };

    await expect(provider.complete({ system: 's', user: 'p', purpose: 'planner' })).rejects.toThrow(
      /after 1 attempt:/,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not retry an authentication error', async () => {
    // Retrying a rejected key spends the full backoff to arrive at the same
    // answer. This is the distinction the isAuthError branch exists for.
    const provider = new ClaudeProvider(baseConfig({ maxAiCalls: 5 }));
    const create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('invalid key'), { status: 401 }));
    (provider as unknown as { client: unknown }).client = { messages: { create } };

    await expect(
      provider.complete({ system: 's', user: 'p', purpose: 'planner' }),
    ).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting attempts', async () => {
    const provider = new ClaudeProvider(baseConfig({ maxAiCalls: 10 }));
    const create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 }));
    (provider as unknown as { client: unknown }).client = { messages: { create } };

    await expect(
      provider.complete({ system: 's', user: 'p', purpose: 'planner' }),
    ).rejects.toThrow();
    expect(create.mock.calls.length).toBeGreaterThan(1);
  });

  it('reports live mode', () => {
    expect(new ClaudeProvider(baseConfig()).mode).toBe('live');
  });
});

describe('OpenAICompatibleProvider', () => {
  const ollamaConfig = baseConfig({
    aiProvider: 'ollama',
    openaiCompatible: {
      baseUrl: 'http://localhost:11434/v1',
      model: 'llama3',
      apiKey: '',
      apiKeyEnv: 'OPENAI_API_KEY',
      requireApiKey: false,
    },
  });

  it('works without a key when one is not required', () => {
    // Ollama and most local runtimes have no key at all.
    expect(() => new OpenAICompatibleProvider(ollamaConfig)).not.toThrow();
  });

  it('works with a key', () => {
    expect(
      () =>
        new OpenAICompatibleProvider(
          baseConfig({
            aiProvider: 'openai-compatible',
            openaiCompatible: {
              baseUrl: 'https://api.example.com/v1',
              model: 'gpt-4o',
              apiKey: 'sk-test',
              apiKeyEnv: 'OPENAI_API_KEY',
              requireApiKey: true,
            },
          }),
        ),
    ).not.toThrow();
  });

  it('respects the call cap', async () => {
    const provider = new OpenAICompatibleProvider(
      baseConfig({
        maxAiCalls: 1,
        openaiCompatible: {
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-4o',
          apiKey: 'sk-test',
          apiKeyEnv: 'OPENAI_API_KEY',
          requireApiKey: true,
        },
      }),
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await provider.complete({ system: 's', user: 'p', purpose: 'planner' });
    await expect(provider.complete({ system: 's', user: 'p', purpose: 'planner' })).rejects.toThrow(
      /cap reached/i,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a non-2xx response instead of returning empty text', async () => {
    const provider = new OpenAICompatibleProvider(
      baseConfig({
        openaiCompatible: {
          baseUrl: 'https://api.example.com/v1',
          model: 'gpt-4o',
          apiKey: 'sk-test',
          apiKeyEnv: 'OPENAI_API_KEY',
          requireApiKey: true,
        },
      }),
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }),
    );

    // A silent empty string here would flow into the JSON parser downstream and
    // surface as "model returned invalid JSON" a layer away from the cause.
    await expect(
      provider.complete({ system: 's', user: 'p', purpose: 'planner' }),
    ).rejects.toThrow();
  });
});
