import { beforeEach, describe, expect, it, vi } from 'vitest';

// lib/model-settings-storage.ts reads/writes through `storage` from '#imports'
// (aliased in vitest.config.ts to test/mocks/imports.ts, whose getItems/setItems
// are no-op stubs). To exercise normalization of data actually coming out of
// storage (old rows missing the new reasoning-effort fields, invalid stored
// values, etc.) this file replaces that stub with a tiny in-memory store,
// following the pattern already used for the wxt/browser mock in
// test/lib/migration.test.ts.
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
  },
}));

import {
  MODEL_CONFIGS_V2_STORAGE_KEY,
  DEFAULT_MODEL_ID_V2_STORAGE_KEY,
} from '@/constants/model-settings';
import {
  extractRemoteModels,
  loadModelSettings,
  setModelReasoningEffort,
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

describe('normalizeModel via loadModelSettings (reasoning effort fields)', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('gives old rows missing reasoningEffort/reasoningEffortLevels the empty defaults, without dropping the row', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);

    const settings = await loadModelSettings();

    expect(settings.models).toHaveLength(1);
    expect(settings.models[0].reasoningEffort).toBe('');
    expect(settings.models[0].reasoningEffortLevels).toEqual([]);
  });

  it('clears a reasoningEffort value that is not a plain lowercase-able word', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE, reasoningEffort: 'HIGH!!' },
    ]);

    const settings = await loadModelSettings();

    expect(settings.models[0].reasoningEffort).toBe('');
  });

  it('lowercases a valid reasoningEffort value', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE, reasoningEffort: 'HIGH' }]);

    const settings = await loadModelSettings();

    expect(settings.models[0].reasoningEffort).toBe('high');
  });

  it('filters out invalid entries and de-duplicates reasoningEffortLevels', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE, reasoningEffortLevels: ['Low', 'bad one!', 'HIGH', 'low'] },
    ]);

    const settings = await loadModelSettings();

    expect(settings.models[0].reasoningEffortLevels).toEqual(['low', 'high']);
  });

  it('treats a non-array reasoningEffortLevels as unknown (empty array)', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE, reasoningEffortLevels: 'high' },
    ]);

    const settings = await loadModelSettings();

    expect(settings.models[0].reasoningEffortLevels).toEqual([]);
  });
});

describe('setModelReasoningEffort', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('updates and normalizes the reasoning effort of an existing model', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);
    mockStore.set(DEFAULT_MODEL_ID_V2_STORAGE_KEY, 'm1');

    const ok = await setModelReasoningEffort('m1', 'HIGH');
    expect(ok).toBe(true);

    const settings = await loadModelSettings();
    expect(settings.models[0].reasoningEffort).toBe('high');
  });

  it('returns false for an unknown model id', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);

    const ok = await setModelReasoningEffort('does-not-exist', 'high');
    expect(ok).toBe(false);
  });
});

describe('extractRemoteModels', () => {
  it('parses the Hyper shape: effort_levels as {value} objects plus default_effort_level', () => {
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

    const models = extractRemoteModels(payload);

    expect(models).toEqual([
      {
        id: 'kimi-k3',
        label: 'kimi-k3',
        reasoningEffortLevels: ['low', 'high'],
        defaultReasoningEffort: 'high',
      },
    ]);
  });

  it('also accepts effort_levels as plain strings', () => {
    const payload = {
      data: [{ id: 'gpt-oss-120b', reasoning: { effort_levels: ['none', 'low', 'max'] } }],
    };

    const models = extractRemoteModels(payload);

    expect(models[0].reasoningEffortLevels).toEqual(['none', 'low', 'max']);
    expect(models[0].defaultReasoningEffort).toBeUndefined();
  });

  it('leaves reasoning fields unset for a plain model with no reasoning info', () => {
    const payload = { data: [{ id: 'deepseek-chat' }] };

    const models = extractRemoteModels(payload);

    expect(models).toEqual([{ id: 'deepseek-chat', label: 'deepseek-chat' }]);
    expect(models[0].reasoningEffortLevels).toBeUndefined();
    expect(models[0].defaultReasoningEffort).toBeUndefined();
  });
});
