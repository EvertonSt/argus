/**
 * AI provider abstraction — provider-agnostic inference.
 *
 * Design mirrors Cerberus CI: an `AIProvider` interface with concrete
 * implementations, so swapping Claude → OpenAI → Ollama → mock is a config
 * change, not a code change.
 *
 * The `chat/completions` request shape has converged to an industry standard.
 * `OpenAICompatibleProvider` speaks it over raw `fetch` with no SDK dependency,
 * transparently covering OpenAI, OpenRouter, Groq, Together AI, DeepSeek, and
 * LM Studio. Ollama is the same transport with `requireApiKey=false`. A
 * `MockAiClient` serves canned fixtures for tests and `--mock` runs.
 *
 * Argus's AI boundary is narrow (planner + triage, ~2 call sites) and
 * deliberately shallow: no streaming, no tool calls, no multi-turn. The
 * provider API matches that — a single `complete()` returning trimmed text.
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { ArgusConfig } from './config.js';
import { log } from './logger.js';

export interface CompletionRequest {
  /** Which pipeline stage is asking — used to pick the mock fixture. */
  purpose: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Fixture file (relative to fixtures/) used when running in mock mode. */
  mockFixture?: string;
}

export interface AIProvider {
  readonly id: string;
  readonly mode: 'live' | 'mock';
  /** Number of calls made so far this run. */
  readonly callCount: number;
  complete(req: CompletionRequest): Promise<string>;
}

// ---------------------------------------------------------------------------
// Config shape — mirrors Cerberus's `ai:` block.
// ---------------------------------------------------------------------------

export type ProviderName = 'claude' | 'openai-compatible' | 'ollama' | 'mock';

export interface ProviderConfig {
  provider: ProviderName;
  /** Model identifier, provider-specific. */
  model: string;
  /** Environment variable holding the API key (null/empty for Ollama/mock). */
  apiKeyEnv?: string;
  /** base_url for openai-compatible / ollama transports. */
  baseUrl?: string;
  /** Max tokens per completion. Default 4096. */
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// Shared infrastructure
// ---------------------------------------------------------------------------

export class ArgusError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'ArgusError';
    this.hint = hint;
  }
}

const TRANSIENT_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number') return TRANSIENT_STATUSES.has(status);
  const code = (err as { code?: string })?.code ?? '';
  return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(code);
}

function isAuthError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  return status === 401 || status === 403;
}

function openaiRequestBody(req: CompletionRequest, model: string, maxTokens: number): unknown {
  return {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
  };
}

function resolveMaxTokens(req: CompletionRequest, fallback: number): number {
  return req.maxTokens ?? fallback;
}

// ---------------------------------------------------------------------------
// Provider factory — selects the right transport for the current config.
// ---------------------------------------------------------------------------

export function createProvider(config: ArgusConfig): AIProvider {
  switch (config.aiProvider) {
    case 'claude':
      return new ClaudeProvider(config);
    case 'openai-compatible':
      return new OpenAICompatibleProvider(config);
    case 'ollama': {
      const localConfig: ArgusConfig = {
        ...config,
        aiProvider: 'openai-compatible',
        openaiCompatible: { ...config.openaiCompatible, requireApiKey: false },
      };
      return new OpenAICompatibleProvider(localConfig);
    }
    case 'mock':
      return new MockAiClient(config.paths.fixtures);
  }
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

export class ClaudeProvider implements AIProvider {
  readonly id = 'claude';
  readonly mode = 'live' as const;
  private calls = 0;
  private readonly client: Anthropic;

  constructor(private readonly config: ArgusConfig) {
    if (!config.anthropicApiKey) {
      throw new ArgusError(
        'ANTHROPIC_API_KEY is not set, and --mock was not passed.',
        'Either copy .env.example to .env and add your key, or run `argus run --mock` ' +
          'to use bundled fixture responses (no key, no cost).',
      );
    }
    this.client = new Anthropic({ apiKey: config.anthropicApiKey });
  }

  get callCount(): number {
    return this.calls;
  }

  async complete(req: CompletionRequest): Promise<string> {
    return this.callWithRetry(req);
  }

  private async callWithRetry(req: CompletionRequest): Promise<string> {
    if (this.calls >= this.config.maxAiCalls) {
      throw new ArgusError(
        `AI call cap reached (${this.config.maxAiCalls} calls) during "${req.purpose}".`,
        'Raise ARGUS_MAX_AI_CALLS in .env if this run legitimately needs more calls.',
      );
    }
    this.calls += 1;

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.client.messages.create({
          model: this.config.anthropicModel,
          max_tokens: resolveMaxTokens(req, 4096),
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        });
        const text =
          response.content
            .filter((block): block is Anthropic.TextBlock => block.type === 'text')
            .map((block) => block.text)
            ?.join('')
            .trim() ?? '';
        if (!text) {
          throw new ArgusError(`Anthropic returned an empty response for "${req.purpose}".`);
        }
        return text;
      } catch (err) {
        lastError = err;
        if (isAuthError(err)) {
          throw new ArgusError(
            'Anthropic rejected the API key (HTTP 401/403).',
            'Check ANTHROPIC_API_KEY in your .env, or run with --mock to skip live calls.',
          );
        }
        if (err instanceof ArgusError) throw err;
        if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        log.warn(
          `Transient Anthropic error on "${req.purpose}" (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ArgusError(
      `Anthropic call failed for "${req.purpose}" after ${MAX_ATTEMPTS} attempts: ${detail}`,
      'This is usually a network or rate-limit issue. Try again, or use --mock.',
    );
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible  (OpenAI / OpenRouter / Groq / Together / DeepSeek / ...)
// ---------------------------------------------------------------------------

export class OpenAICompatibleProvider implements AIProvider {
  readonly id = 'openai-compatible';
  readonly mode = 'live' as const;
  private calls = 0;

  constructor(private readonly config: ArgusConfig) {
    if (!config.openaiCompatible.baseUrl) {
      throw new ArgusError(
        'AI provider "openai-compatible" requires ARGUS_OPENAI_BASE_URL (or OPENAI_BASE_URL).',
        'Set the base_url for your provider — e.g. https://api.openai.com/v1, ' +
          'http://localhost:11434/v1 for Ollama, or https://openrouter.ai/api/v1.',
      );
    }
    if (config.openaiCompatible.requireApiKey && !config.openaiCompatible.apiKey) {
      throw new ArgusError(
        `An API key is not set for provider "openai-compatible".`,
        `Set ${config.openaiCompatible.apiKeyEnv} in your environment, or run with --mock.`,
      );
    }
  }

  get callCount(): number {
    return this.calls;
  }

  async complete(req: CompletionRequest): Promise<string> {
    if (this.calls >= this.config.maxAiCalls) {
      throw new ArgusError(
        `AI call cap reached (${this.config.maxAiCalls} calls) during "${req.purpose}".`,
        'Raise ARGUS_MAX_AI_CALLS in .env if this run legitimately needs more calls.',
      );
    }
    this.calls += 1;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.openaiCompatible.apiKey) {
      headers.Authorization = `Bearer ${this.config.openaiCompatible.apiKey}`;
    }

    const body = openaiRequestBody(
      req,
      this.config.openaiCompatible.model,
      resolveMaxTokens(req, 4096),
    );

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(this.config.openaiCompatible.baseUrl + '/chat/completions', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });

        if (response.status === 401 || response.status === 403) {
          throw new ArgusError(
            'The OpenAI-compatible provider rejected the API key (HTTP 401/403).',
            'Check your API key, or run with --mock to skip live calls.',
          );
        }
        if (!response.ok && isTransient(response.status)) {
          throw { status: response.status };
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new ArgusError(
            `OpenAI-compatible provider error (${response.status}) for "${req.purpose}": ${detail.slice(0, 500)}`,
          );
        }

        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const text = data.choices?.[0]?.message?.content?.trim() ?? '';
        if (!text) {
          throw new ArgusError(`Provider returned an empty response for "${req.purpose}".`);
        }
        return text;
      } catch (err) {
        lastError = err;
        if (err instanceof ArgusError) throw err;
        if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        log.warn(
          `Transient provider error on "${req.purpose}" (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ArgusError(
      `OpenAI-compatible call failed for "${req.purpose}" after ${MAX_ATTEMPTS} attempts: ${detail}`,
      'This is usually a network or rate-limit issue. Try again, or use --mock.',
    );
  }
}

// ---------------------------------------------------------------------------
// Mock — serves canned fixture responses, zero cost, zero network.
// ---------------------------------------------------------------------------

export class MockAiClient implements AIProvider {
  readonly id = 'mock';
  readonly mode = 'mock' as const;
  private calls = 0;

  constructor(
    private readonly fixturesDir: string = '',
    private readonly overrides: Record<string, string> = {},
  ) {}

  get callCount(): number {
    return this.calls;
  }

  async complete(req: CompletionRequest): Promise<string> {
    this.calls += 1;
    const name = req.mockFixture;
    if (!name) {
      throw new ArgusError(
        `Mock mode: no fixture declared for AI call "${req.purpose}".`,
        'Every AI call site must supply `mockFixture` so --mock can run offline.',
      );
    }
    if (name in this.overrides) return this.overrides[name] as string;

    const file = path.join(this.fixturesDir, name);
    if (!fs.existsSync(file)) {
      throw new ArgusError(
        `Mock fixture not found: ${file}`,
        'Fixtures ship with the repo — if this is missing, re-clone or restore fixtures/.',
      );
    }
    return fs.readFileSync(file, 'utf-8').trim();
  }
}
