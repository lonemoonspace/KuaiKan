import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    getItem: async (key: string) => (mockStore.has(key) ? mockStore.get(key) : null),
  },
}));

import {
  MODEL_CONFIGS_V2_STORAGE_KEY,
  DEFAULT_MODEL_ID_V2_STORAGE_KEY,
  createDefaultModelDraft,
} from '@/constants/model-settings';
import {
  extractRemoteModels,
  fetchRemoteModels,
  loadModelSettings,
  replaceModelSettings,
  setModelConfigModelId,
  updateModelConfig,
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

describe('model pool normalization', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('defaults a row written before the pool existed to an empty list', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);

    const settings = await loadModelSettings();

    expect(settings.models[0].modelIds).toEqual([]);
  });

  it('keeps a fetched pool, dropping blanks and duplicates', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      {
        ...LEGACY_BASE,
        modelIds: ['deepseek-chat', '', '  ', 'deepseek-chat', 'deepseek-reasoner'],
      },
    ]);

    const settings = await loadModelSettings();

    expect(settings.models[0].modelIds).toEqual([
      'deepseek-chat',
      'deepseek-reasoner',
    ]);
  });

  it('ignores a stored pool that is not an array', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE, modelIds: 'deepseek-chat' },
    ]);

    const settings = await loadModelSettings();

    expect(settings.models[0].modelIds).toEqual([]);
  });

  it('keeps the pool when the config is saved through updateModelConfig', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);

    await updateModelConfig('m1', {
      ...createDefaultModelDraft('openai-compatible'),
      baseURL: 'https://api.example.com/v1',
      modelId: 'gpt-4o-mini',
      modelIds: ['gpt-4o', 'gpt-4o-mini'],
      name: 'Renamed',
    });

    const settings = await loadModelSettings();

    expect(settings.models[0].modelIds).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(settings.models[0].modelId).toBe('gpt-4o-mini');
    expect(settings.models[0].name).toBe('Renamed');
  });
});

describe('setModelConfigModelId', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('switches the model while leaving the pool and the default config alone', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE, modelIds: ['gpt-4o', 'gpt-4o-mini'] },
      {
        ...LEGACY_BASE,
        id: 'm2',
        modelId: 'claude-3-5-sonnet-latest',
        name: 'Second',
      },
    ]);
    mockStore.set(DEFAULT_MODEL_ID_V2_STORAGE_KEY, 'm2');

    expect(await setModelConfigModelId('m1', 'gpt-4o-mini')).toBe(true);

    const settings = await loadModelSettings();

    expect(settings.models[0].modelId).toBe('gpt-4o-mini');
    expect(settings.models[0].modelIds).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(settings.defaultModelId).toBe('m2');
  });

  it('accepts an id outside the pool without rewriting the pool', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE, modelIds: ['gpt-4o'] },
    ]);

    expect(await setModelConfigModelId('m1', 'hand-typed-model')).toBe(true);

    const settings = await loadModelSettings();

    expect(settings.models[0].modelId).toBe('hand-typed-model');
    expect(settings.models[0].modelIds).toEqual(['gpt-4o']);
  });

  it('refuses an unknown config and an empty model id', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE, modelIds: ['gpt-4o'] },
    ]);

    expect(await setModelConfigModelId('nope', 'gpt-4o')).toBe(false);
    expect(await setModelConfigModelId('m1', '   ')).toBe(false);

    const settings = await loadModelSettings();

    expect(settings.models[0].modelId).toBe('gpt-4o');
  });
});

// The loader is tolerant by design: a row from a newer build, a hand-edited
// backup or a provider id this version does not know is skipped with a warning.
// A write used to turn that tolerance into deletion -- editing one model
// dropped every row the loader could not parse, API key included.
describe('unparsed rows survive a write', () => {
  const UNKNOWN_PROVIDER_ROW = {
    id: 'future-1',
    name: 'From a newer version',
    providerId: 'provider-that-does-not-exist-yet',
    modelId: 'future-model',
    apiKey: 'sk-must-not-be-deleted',
  };

  beforeEach(() => {
    mockStore.clear();
  });

  it('keeps an unknown-provider row when another model is edited', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE },
      { ...UNKNOWN_PROVIDER_ROW },
    ]);

    await updateModelConfig('m1', {
      ...createDefaultModelDraft('openai-compatible'),
      baseURL: 'https://api.example.com/v1',
      modelId: 'gpt-4o-mini',
      name: 'Renamed',
    });

    const raw = mockStore.get(MODEL_CONFIGS_V2_STORAGE_KEY) as unknown[];

    expect(raw).toHaveLength(2);
    expect(raw).toContainEqual(UNKNOWN_PROVIDER_ROW);
    // The managed row is still first; the unparsed one is carried at the end.
    expect((raw[0] as { id: string }).id).toBe('m1');
  });

  it('keeps an unknown-provider row when a model is deleted', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      { ...LEGACY_BASE },
      { ...LEGACY_BASE, id: 'm2', name: 'Second' },
      { ...UNKNOWN_PROVIDER_ROW },
    ]);

    const { deleteModelConfig } = await import('@/lib/model-settings-storage');
    expect(await deleteModelConfig('m2')).toBe(true);

    const raw = mockStore.get(MODEL_CONFIGS_V2_STORAGE_KEY) as unknown[];

    expect(raw).toHaveLength(2);
    expect(raw).toContainEqual(UNKNOWN_PROVIDER_ROW);
  });

  it('carries an unparsed row supplied by an import instead of dropping it', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);

    const result = await replaceModelSettings({
      defaultModelId: 'm1',
      models: [
        { ...LEGACY_BASE, modelIds: [] },
        UNKNOWN_PROVIDER_ROW as never,
      ],
    });

    expect(result.models).toHaveLength(1);
    expect(result.rejected).toBe(1);
    expect(mockStore.get(MODEL_CONFIGS_V2_STORAGE_KEY)).toContainEqual(
      UNKNOWN_PROVIDER_ROW,
    );
  });

  it('refuses an import that parses to nothing instead of wiping the list', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [{ ...LEGACY_BASE }]);

    await expect(
      replaceModelSettings({
        defaultModelId: null,
        models: [
          { id: 'x', name: 'y', modelId: 'z', providerId: 'nope' } as never,
        ],
      }),
    ).rejects.toThrow();

    // Storage is untouched: the user's models are still there.
    expect(mockStore.get(MODEL_CONFIGS_V2_STORAGE_KEY)).toEqual([{ ...LEGACY_BASE }]);
  });
});

describe('legacy ollama base URLs', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('rewrites a stored /api base URL to the OpenAI-compatible /v1 on load', async () => {
    mockStore.set(MODEL_CONFIGS_V2_STORAGE_KEY, [
      {
        ...LEGACY_BASE,
        providerId: 'ollama',
        baseURL: 'http://localhost:11434/api',
        modelId: 'llama3.2',
      },
    ]);

    const settings = await loadModelSettings();

    expect(settings.models[0].baseURL).toBe('http://localhost:11434/v1');
  });
});

describe('fetchRemoteModels', () => {
  const draft = (overrides: Partial<ReturnType<typeof createDefaultModelDraft>> = {}) => ({
    ...createDefaultModelDraft('openai-compatible'),
    baseURL: 'https://api.example.com/v1',
    ...overrides,
  });

  // Resolves only when the request is aborted, which is the "server accepted
  // the connection and then went quiet" case the timeout exists for.
  const neverRespondingFetch = (_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fetches the model list from the provider path with the API key', async () => {
    const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.example.com/v1/models');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchRemoteModels(draft({ apiKey: 'sk-test' }))).resolves.toEqual([
      { id: 'gpt-4o', label: 'gpt-4o' },
    ]);
  });

  it('reports a malformed base URL instead of throwing a bare TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn());

    await expect(fetchRemoteModels(draft({ baseURL: 'not a url' }))).rejects.toThrow(
      'Base URL 格式不正确',
    );
  });

  it('gives up after the timeout instead of hanging forever', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', neverRespondingFetch);

    const promise = fetchRemoteModels(draft(), { timeoutMs: 1_000 });
    const rejection = expect(promise).rejects.toThrow('获取模型列表超时');

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
  });

  it('honours a caller-provided abort signal', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', neverRespondingFetch);

    const promise = fetchRemoteModels(draft(), { signal: controller.signal });
    const rejection = expect(promise).rejects.toThrow('已取消获取模型列表');

    controller.abort();
    await rejection;
  });
});
