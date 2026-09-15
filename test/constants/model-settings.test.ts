import { describe, expect, it } from 'vitest';
import {
  getModelOptionLabel,
  getModelVendorLabel,
  getReasoningEffortOptions,
  supportsReasoningEffort,
  REASONING_EFFORT_PRESETS,
} from '@/constants/model-settings';

describe('getModelVendorLabel', () => {
  it('uses the base-URL preset label so OpenAI-compatible vendors are told apart', () => {
    expect(
      getModelVendorLabel({ providerId: 'openai-compatible', baseURL: 'https://api.deepseek.com' }),
    ).toBe('DeepSeek');
    expect(
      getModelVendorLabel({ providerId: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1/' }),
    ).toBe('OpenRouter');
  });

  it('falls back to the host of a custom base URL', () => {
    expect(
      getModelVendorLabel({ providerId: 'openai-compatible', baseURL: 'https://proxy.example.com/v1' }),
    ).toBe('proxy.example.com');
  });

  it('resolves an empty base URL through the provider default', () => {
    expect(getModelVendorLabel({ providerId: 'anthropic', baseURL: '' })).toBe('Anthropic');
    expect(getModelVendorLabel({ providerId: 'open-responses', baseURL: '' })).toBe('Open Responses');
  });
});

describe('getModelOptionLabel', () => {
  it('appends the model id to a custom name', () => {
    expect(getModelOptionLabel({ name: '快速总结', modelId: 'deepseek-chat' })).toBe('快速总结（deepseek-chat）');
  });

  it('does not repeat the id when the name already is the id, or when either is empty', () => {
    expect(getModelOptionLabel({ name: 'gpt-5', modelId: 'gpt-5' })).toBe('gpt-5');
    expect(getModelOptionLabel({ name: '', modelId: 'gpt-5' })).toBe('gpt-5');
    expect(getModelOptionLabel({ name: '我的模型', modelId: '' })).toBe('我的模型');
  });
});

describe('supportsReasoningEffort', () => {
  it('is true only for the OpenAI-shaped providers', () => {
    expect(supportsReasoningEffort('openai-compatible')).toBe(true);
    expect(supportsReasoningEffort('openai')).toBe(true);
    expect(supportsReasoningEffort('open-responses')).toBe(true);
  });

  it('is false for anthropic, google and ollama', () => {
    expect(supportsReasoningEffort('anthropic')).toBe(false);
    expect(supportsReasoningEffort('google')).toBe(false);
    expect(supportsReasoningEffort('ollama')).toBe(false);
  });
});

describe('getReasoningEffortOptions', () => {
  it('uses the model-specific levels when known', () => {
    expect(
      getReasoningEffortOptions({ reasoningEffort: '', reasoningEffortLevels: ['low', 'high'] }),
    ).toEqual(['low', 'high']);
  });

  it('falls back to the generic presets when levels are unknown', () => {
    expect(getReasoningEffortOptions({ reasoningEffort: '', reasoningEffortLevels: [] })).toEqual([
      ...REASONING_EFFORT_PRESETS,
    ]);
  });

  it('appends an already-stored value that is not in the known/preset list, so it still displays', () => {
    expect(
      getReasoningEffortOptions({ reasoningEffort: 'ultra', reasoningEffortLevels: ['low', 'high'] }),
    ).toEqual(['low', 'high', 'ultra']);
  });

  it('does not duplicate a stored value that is already in the list', () => {
    expect(
      getReasoningEffortOptions({ reasoningEffort: 'high', reasoningEffortLevels: ['low', 'high'] }),
    ).toEqual(['low', 'high']);
  });
});
