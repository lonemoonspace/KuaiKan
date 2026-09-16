import { describe, expect, it } from 'vitest';
import {
  findBaseURLPreset,
  getModelDisplayIcon,
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

describe('findBaseURLPreset', () => {
  it('matches host regardless of a /v1 suffix or trailing slash', () => {
    expect(findBaseURLPreset('openai-compatible', 'https://api.deepseek.com/v1')?.label).toBe(
      'DeepSeek',
    );
    expect(findBaseURLPreset('openai-compatible', 'https://api.deepseek.com/')?.label).toBe(
      'DeepSeek',
    );
  });

  it('matches host case-insensitively', () => {
    expect(findBaseURLPreset('openai-compatible', 'HTTPS://API.DEEPSEEK.COM')?.label).toBe(
      'DeepSeek',
    );
  });

  it('does not confuse OpenRouter with a bare-host preset on the same provider', () => {
    expect(findBaseURLPreset('openai-compatible', 'https://openrouter.ai/api/v1/')?.label).toBe(
      'OpenRouter',
    );
  });

  it('returns undefined when the host matches no preset', () => {
    expect(findBaseURLPreset('openai-compatible', 'https://proxy.example.com/v1')).toBeUndefined();
  });
});

describe('getModelDisplayIcon', () => {
  it('resolves the preset icon for a base URL that only differs by trailing slash', () => {
    expect(
      getModelDisplayIcon({ providerId: 'openai-compatible', baseURL: 'https://api.deepseek.com/', iconPath: '' }),
    ).toBe('/llm-icons/deepseek.svg');
  });

  it('falls back to the provider icon when the host matches no preset', () => {
    expect(
      getModelDisplayIcon({
        providerId: 'openai-compatible',
        baseURL: 'https://proxy.example.com/v1',
        iconPath: '',
      }),
    ).toBe('/llm-icons/openai-comp.svg');
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
