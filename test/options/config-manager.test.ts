import { describe, expect, it } from 'vitest';
import { mergeModelSecrets } from '@/entrypoints/options/pages/ConfigManagerPage';

const local = [
  {
    id: 'm1',
    providerId: 'openai-compatible',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: 'local-secret',
    headers: { 'x-local': '1' },
  },
];

describe('mergeModelSecrets', () => {
  it('backfills apiKey/headers when id, providerId, and baseURL are unchanged', () => {
    const incoming = [
      { id: 'm1', providerId: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1', apiKey: '', headers: {} },
    ];
    const merged = mergeModelSecrets(local, incoming) as any[];
    expect(merged[0].apiKey).toBe('local-secret');
    expect(merged[0].headers).toEqual({ 'x-local': '1' });
  });

  it('treats a trailing-slash-only baseURL difference as unchanged', () => {
    const incoming = [
      { id: 'm1', providerId: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1/', apiKey: '', headers: {} },
    ];
    const merged = mergeModelSecrets(local, incoming) as any[];
    expect(merged[0].apiKey).toBe('local-secret');
  });

  it('does not backfill when the baseURL changed', () => {
    const incoming = [
      { id: 'm1', providerId: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1', apiKey: '', headers: {} },
    ];
    const merged = mergeModelSecrets(local, incoming) as any[];
    expect(merged[0].apiKey).toBe('');
    expect(merged[0].headers).toEqual({});
  });

  it('does not backfill when the providerId changed', () => {
    const incoming = [
      { id: 'm1', providerId: 'openai', baseURL: 'https://api.deepseek.com/v1', apiKey: '', headers: {} },
    ];
    const merged = mergeModelSecrets(local, incoming) as any[];
    expect(merged[0].apiKey).toBe('');
  });

  it('keeps the imported apiKey when the import already carries one', () => {
    const incoming = [
      {
        id: 'm1',
        providerId: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: 'imported-secret',
        headers: {},
      },
    ];
    const merged = mergeModelSecrets(local, incoming) as any[];
    expect(merged[0].apiKey).toBe('imported-secret');
  });

  it('carries the local model pool over an import that predates the field', () => {
    const localWithPool = [
      {
        ...local[0],
        modelId: 'deepseek-chat',
        modelIds: ['deepseek-chat', 'deepseek-reasoner'],
      },
    ];
    const incoming = [
      {
        id: 'm1',
        providerId: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: '',
        headers: {},
        modelId: 'deepseek-chat',
      },
    ];

    const merged = mergeModelSecrets(localWithPool, incoming) as any[];

    expect(merged[0].modelIds).toEqual(['deepseek-chat', 'deepseek-reasoner']);
  });

  it('keeps the imported model pool when the import carries one', () => {
    const localWithPool = [
      { ...local[0], modelIds: ['deepseek-chat'] },
    ];
    const incoming = [
      {
        id: 'm1',
        providerId: 'openai-compatible',
        baseURL: 'https://api.deepseek.com/v1',
        apiKey: '',
        headers: {},
        modelIds: ['gpt-4o', 'gpt-4o-mini'],
      },
    ];

    const merged = mergeModelSecrets(localWithPool, incoming) as any[];

    expect(merged[0].modelIds).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });
});
