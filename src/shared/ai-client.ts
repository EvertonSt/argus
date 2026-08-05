/**
 * Anthropic client wrapper.
 *
 * Responsibilities that must NOT leak into calling modules:
 *   - retry with exponential backoff on transient (429 / 5xx / network) errors
 *   - immediate, clear failure on auth errors (no silent hang, no retry storm)
 *   - a hard per-run cap on the number of calls, so cost is predictable
 *   - mock mode, where every "call" is served from a fixture file instead
 *
 * Calling modules just ask for text and get text back.
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { ArgusConfig } from './config.js';
import { log } from './logger.js';

export class ArgusError extends Error {
  readonly hint: string | undefined;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'ArgusError';
    this.hint = hint;
  }
}

export interface CompletionRequest {
  /** Which pipeline stage is asking — used to pick the mock fixture. */
  purpose: string;
  system: string;
  user: string;
  maxTokens?: number;
  /** Fixture file (relative to fixtures/) used when running in mock mode. */
  mockFixture?: string;
}

export interface AiClient {
  readonly mode: 'live' | 'mock';
  /** Number of calls made so far this run. */
  readonly callCount: number;
  complete(req: CompletionRequest): Promise<string>;
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

// ---------------------------------------------------------------------------
// Live client
// ---------------------------------------------------------------------------

class LiveAiClient implements AiClient {
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
          max_tokens: req.maxTokens ?? 4096,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        });
        const text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('')
          .trim();
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
// Mock client
// ---------------------------------------------------------------------------

/**
 * Serves canned responses from fixtures/. Used by `--mock` and by the Vitest
 * suite, so tests never need an API key and never spend money.
 */
export class MockAiClient implements AiClient {
  readonly mode = 'mock' as const;
  private calls = 0;

  constructor(
    private readonly fixturesDir: string,
    /** Optional in-memory overrides, keyed by fixture name. Used by tests. */
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

export function createAiClient(config: ArgusConfig, mock: boolean): AiClient {
  return mock ? new MockAiClient(config.paths.fixtures) : new LiveAiClient(config);
}
