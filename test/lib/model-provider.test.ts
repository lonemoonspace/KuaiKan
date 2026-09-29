import { describe, expect, it } from 'vitest';
import {
  buildBodyOverrides,
  createLanguageModelFromConfig,
} from '@/lib/model-provider';
import type { ModelConfigItem } from '@/constants/model-settings';

function modelConfig(overrides: Partial<ModelConfigItem>): ModelConfigItem {
  return {
    apiKey: '',
    apiMode: 'chat',
    at: 0,
    baseURL: '',
    extraBody: {},
    headers: {},
    iconPath: '',
    id: 'cfg-1',
    inputTokenPrice: 0,
    maxInputTokens: 0,
    modelId: 'llama3.2',
    modelIds: [],
    name: 'ollama',
    outputTokenPrice: 0,
    priceUnit: '$',
    providerId: 'ollama',
    ...overrides,
  };
}

describe('buildBodyOverrides', () => {
  it('injects nothing when extraBody is empty', () => {
    expect(buildBodyOverrides({ extraBody: {} })).toEqual({});
  });

  it('passes extraBody through verbatim', () => {
    expect(
      buildBodyOverrides({ extraBody: { thinking: { type: 'disabled' } } }),
    ).toEqual({ thinking: { type: 'disabled' } });
  });

  it('keeps unrelated keys alongside a reasoning-control key', () => {
    expect(
      buildBodyOverrides({
        extraBody: { reasoning_effort: 'low', enable_search: true },
      }),
    ).toEqual({ reasoning_effort: 'low', enable_search: true });
  });
});

// The ollama row used to be built with `ollama-ai-provider`, whose models still
// declare specification version v1; AI SDK 6 rejects those at runtime, so every
// Ollama summary failed. It is now built with the OpenAI-compatible client, and
// these tests pin the runtime-visible shape that failure depended on.
describe('createLanguageModelFromConfig', () => {
  it('returns an ollama model the AI SDK will accept instead of a v1 cast', () => {
    const model = createLanguageModelFromConfig(
      modelConfig({ baseURL: 'http://localhost:11434/api' }),
    ) as unknown as { specificationVersion?: string; modelId?: string; provider?: string };

    expect(model.specificationVersion).not.toBe('v1');
    expect(['v2', 'v3']).toContain(model.specificationVersion);
    expect(model.modelId).toBe('llama3.2');
  });

  it('builds an OpenAI-compatible model for the compatible providers', () => {
    const model = createLanguageModelFromConfig(
      modelConfig({
        providerId: 'openai-compatible',
        baseURL: 'https://api.example.com/v1',
        modelId: 'gpt-oss:20b',
      }),
    ) as unknown as { specificationVersion?: string };

    expect(['v2', 'v3']).toContain(model.specificationVersion);
  });
});
