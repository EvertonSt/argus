import { describe, it, expect } from 'vitest';
import {
  createProvider,
  MockAiClient,
  ClaudeProvider,
  OpenAICompatibleProvider,
} from '../../src/shared/provider.js';
import type { ArgusConfig } from '../../src/shared/config.js';

const baseConfig: ArgusConfig = {
  aiProvider: 'mock',
  anthropicApiKey: undefined,
  anthropicModel: 'claude-sonnet-4-20250514',
  openaiCompatible: {
    baseUrl: '',
    model: 'gpt-4o',
    apiKey: undefined,
    apiKeyEnv: 'OPENAI_API_KEY',
    requireApiKey: false,
  },
  targetUrl: 'http://localhost:4317',
  severityFailThreshold: 'high',
  maxAiCalls: 100,
  browser: 'chromium',
  paths: {
    root: '/tmp/argus',
    data: '/tmp/argus/data',
    runs: '/tmp/argus/data/runs',
    inventory: '/tmp/argus/data/inventory.json',
    testCases: '/tmp/argus/data/test-cases.json',
    bugs: '/tmp/argus/data/bugs.json',
    generatedTests: '/tmp/argus/generated-tests',
    fixtures: '/tmp/argus/fixtures',
    dashboard: '/tmp/argus/dashboard',
    demoApp: '/tmp/argus/demo-app',
    triageLog: '/tmp/argus/data/triage.log',
  },
};

describe('createProvider', () => {
  it('returns a MockAiClient when provider is "mock"', () => {
    const provider = createProvider({ ...baseConfig, aiProvider: 'mock' });
    expect(provider).toBeInstanceOf(MockAiClient);
    expect(provider.mode).toBe('mock');
    expect(provider.id).toBe('mock');
  });

  it('returns a ClaudeProvider when provider is claude and key is set', () => {
    const provider = createProvider({
      ...baseConfig,
      aiProvider: 'claude',
      anthropicApiKey: 'sk-ant-test-key',
    });
    expect(provider).toBeInstanceOf(ClaudeProvider);
    expect(provider.mode).toBe('live');
    expect(provider.id).toBe('claude');
  });

  it('throws when claude key is missing', () => {
    expect(() =>
      createProvider({
        ...baseConfig,
        aiProvider: 'claude',
        anthropicApiKey: undefined,
      }),
    ).toThrow();
  });

  it('returns an OpenAICompatibleProvider for openai-compatible', () => {
    const provider = createProvider({
      ...baseConfig,
      aiProvider: 'openai-compatible',
      openaiCompatible: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        apiKeyEnv: 'OPENAI_API_KEY',
        model: 'gpt-4o',
        requireApiKey: true,
      },
    });
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(provider.id).toBe('openai-compatible');
    expect(provider.mode).toBe('live');
  });

  it('returns MockAiClient for Ollama without requiring a key', () => {
    const provider = createProvider({
      ...baseConfig,
      aiProvider: 'openai-compatible',
      openaiCompatible: {
        baseUrl: 'http://localhost:11434/v1',
        apiKey: 'ollama',
        apiKeyEnv: 'OPENAI_API_KEY',
        model: 'llama3.1:latest',
        requireApiKey: false,
      },
    });
    expect(provider.id).toBe('openai-compatible');
    expect(provider.mode).toBe('live');
  });
});

describe('MockAiClient', () => {
  it('counts calls and returns canned responses', async () => {
    const mock = new MockAiClient('', { 'planner-test': '[{"title": "sample"}]' });
    expect(mock.callCount).toBe(0);
    const result = await mock.complete({
      system: '',
      user: '',
      purpose: 'planner-test',
      mockFixture: 'planner-test',
    });
    expect(mock.callCount).toBe(1);
    expect(result).toBe('[{"title": "sample"}]');
  });
});
