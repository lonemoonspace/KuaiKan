import { beforeEach, describe, expect, it, vi } from 'vitest';

// lib/model-settings-storage.ts reads/writes through `storage` from '#imports'
// (aliased in vitest.config.ts to test/mocks/imports.ts, whose getItems/setItems
// are no-op stubs). To exercise normalization of data actually coming out of
// storage (rows written by older versions, invalid stored values, etc.) this
// file replaces that stub with a tiny in-memory store, following the pattern
// already used for the wxt/browser mock in test/lib/migration.test.ts.
const { mockStore } = vi.hoisted(() => ({ mockStore: new Map<string, unknown>() }));

vi.mock('#imports', () => ({
  storage: {
    getItems: async (
      specs: Array<{ key: string; options?: { fallback?: unknown } }>,
    ) =>
      specs.map((spec) => ({
        key: spec.key,
        value: mockStore.has(spec.key) ? mockStore.get(spec.key) : spec.options?.fallback,
      })),
    setItems: async (items: Array<{ key: string; value: unknown }>) => {
      for (const item of items) mockStore.set(item.key, item.value);
    },
    // lib/model-settings-storage.ts now imports lib/logger.ts (for the
    // parseModels() warn logging below), which calls storage.watch/getItem
    // at module load time; stub them like test/mocks/imports.ts does.
    watch: (_key: string, _callback: (newValue: unknown, oldValue: unknown) => void) => () => {},
    getItem: async (_key: string) => null,
  },
}));

import {
  MODEL_CONFIGS_V2_STORAGE_KEY,
  DEFAULT_MODEL_ID_V2_STORAGE_KEY,
} from '@/constants/model-settings';
import {
  extractRemoteModels,
  loadModelSettings,
} from '@/lib/model-settings-storage';

const LEGACY_BASE = {
  id: 'm1',
  name: 'Legacy Model',
  providerId: 'openai-compatible' as const,
  modelId: 'gpt-4o',
  apiMode: 'chat' as const,
  apiKey: '',
  baseURL: 'https://api.example.com/v1',
  extraBody: {},
  headers: {},
  inputTokenPrice: 0,
  outputTokenPrice: 0,
  maxInputTokens: 0,
  priceUnit: '$',
  at: 1,
};

describe('normalizeModel via loadModelSettings', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('keeps a row written by an older version without dropping it', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);

    const settings = await loadModelSettings();

    expect(settings.models).toHaveLength(1);
    expect(settings.models[0].id).toBe('m1');
    expect(settings.models[0].baseURL).toBe('https://api.example.com/v1');
    expect(settings.defaultModelId).toBe('m1');
  });

  it('drops leftover keys the current shape no longer defines', async () => {
    // 2.1.0 and earlier stored a reasoning-effort pair on every row. Those keys
    // are gone now; a row carrying them must still load and come back clean.
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE, reasoningEffort: 'HIGH', reasoningEffortLevels: ['low', 'high'] },
    ]);

    const settings = await loadModelSettings();

    expect(settings.models).toHaveLength(1);
    expect(settings.models[0]).not.toHaveProperty('reasoningEffort');
    expect(settings.models[0]).not.toHaveProperty('reasoningEffortLevels');
  });

  it('falls back to the first row when the stored default id points nowhere', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);
    mockStore.set(DEFAULT_MODEL_ID_V2_STORAGE_KEY, 'missing-id');

    const settings = await loadModelSettings();

    expect(settings.defaultModelId).toBe('m1');
  });
});

describe('extractRemoteModels', () => {
  it('reads the OpenAI-style data list', () => {
    const payload = {
      data: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner' },
      ],
    };

    expect(extractRemoteModels(payload)).toEqual([
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner' },
    ]);
  });

  it('accepts a bare list of model ids', () => {
    expect(extractRemoteModels({ models: ['gpt-4o', 'gpt-4o-mini'] })).toEqual([
      { id: 'gpt-4o', label: 'gpt-4o' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini' },
    ]);
  });

  it('ignores reasoning metadata a provider may still return', () => {
    const payload = {
      data: [
        {
          id: 'kimi-k3',
          reasoning: {
            effort_levels: [{ value: 'low' }, { value: 'high' }],
            default_effort_level: 'high',
          },
        },
      ],
    };

    expect(extractRemoteModels(payload)).toEqual([
      { id: 'kimi-k3', label: 'kimi-k3' },
    ]);
  });

  it('returns nothing for a payload with no usable list', () => {
    expect(extractRemoteModels(null)).toEqual([]);
    expect(extractRemoteModels({ error: 'nope' })).toEqual([]);
  });
});
