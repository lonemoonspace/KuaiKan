import { describe, expect, it } from 'vitest';
import {
  getModelOptionLabel,
  getModelVendorLabel,
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
