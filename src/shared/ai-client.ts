/**
 * AI client — backwards-compatible facade over the provider abstraction.
 *
 * The pipeline and tests were written against `createAiClient(config, mock)`
 * and `MockAiClient`. This file re-exports the new providers and keeps that
 * legacy API working, so nothing that imports it breaks.
 *
 * New code should import `createProvider`, `ClaudeProvider`, etc. directly
 * from `./provider.js`.
 */
export {
  ArgusError,
  MockAiClient,
  ClaudeProvider,
  OpenAICompatibleProvider,
  createProvider,
} from './provider.js';
export type { AIProvider, CompletionRequest, ProviderConfig, ProviderName } from './provider.js';

import { createProvider } from './provider.js';
import { MockAiClient } from './provider.js';
import type { AIProvider } from './provider.js';
import type { ArgusConfig } from './config.js';

/** Legacy alias — `AIProvider` is the new name, but existing call sites say AiClient. */
export type AiClient = AIProvider;

/**
 * Legacy factory. Preserved so `pipeline.ts` and the test suite keep working
 * verbatim. `mock` is honoured for backwards-compat; `config.aiProvider`
 * takes precedence when set to a non-mock provider.
 */
export function createAiClient(config: ArgusConfig, mock: boolean): AiClient {
  if (mock || config.aiProvider === 'mock') {
    return new MockAiClient(config.paths.fixtures);
  }
  return createProvider(config);
}
