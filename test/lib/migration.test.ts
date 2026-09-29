import { beforeEach, describe, expect, it } from 'vitest';
import {
  migrateModelConfigs,
  MIGRATION_VERSION_STORAGE_KEY,
  CURRENT_MIGRATION_VERSION,
  runFullMigration,
} from '@/lib/migration';
import { __resetMockStorage, __getMockStorage, __failNextStorageRemove } from '../mocks/wxt-browser';

describe('migrateModelConfigs (pure V1 -> V2 model config conversion)', () => {
  it('is a no-op for an already-V2 model', () => {
    const v2Model = {
      providerId: 'openai',
      modelId: 'gpt-4.1-mini',
      apiMode: 'chat',
      apiKey: 'sk-x',
      extraBody: {},
      headers: {},
      inputTokenPrice: 0,
      outputTokenPrice: 0,
      maxInputTokens: 0,
      priceUnit: '$',
      baseURL: 'https://api.openai.com/v1',
    };
    const { models, updated } = migrateModelConfigs([v2Model]);
    expect(updated).toBe(false);
    expect(models).toEqual([v2Model]);
  });

  it('renames modelName -> modelId and fixes known providerType typos', () => {
    const { models, updated } = migrateModelConfigs([
      { providerType: 'openai-compitable', modelName: 'gpt-4o' },
    ]);
    expect(updated).toBe(true);
    expect(models[0].providerId).toBe('openai-compatible');
    expect(models[0].providerType).toBeUndefined();
    expect(models[0].modelId).toBe('gpt-4o');
    expect(models[0].modelName).toBeUndefined();
  });

  it('maps an unrecognized legacy providerType to openai-compatible and backfills icon + baseURL from the name heuristics', () => {
    const { models } = migrateModelConfigs([
      { providerType: 'deepseek', name: 'My DeepSeek', modelName: 'deepseek-chat' },
    ]);
    expect(models[0].providerId).toBe('openai-compatible');
    expect(models[0].baseURL).toBe('https://api.deepseek.com');
    expect(models[0].iconPath).toBe('/llm-icons/deepseek.svg');
  });

  it('fills in required V2 fields with defaults without touching existing values', () => {
    const { models, updated } = migrateModelConfigs([
      { providerId: 'openai', modelId: 'gpt-4.1-mini', apiKey: 'sk-existing' },
    ]);
    expect(updated).toBe(true);
    expect(models[0].apiKey).toBe('sk-existing'); // not clobbered
    expect(models[0].apiMode).toBe('chat');
    expect(models[0].extraBody).toEqual({});
    expect(models[0].headers).toEqual({});
    expect(models[0].maxInputTokens).toBe(0);
  });

  it('backfills baseURL/icon from a matching preset only for legacy (V1) rows, by exact name match', () => {
    const { models } = migrateModelConfigs([
      { providerType: 'openai-compatible', name: 'DeepSeek', modelName: 'deepseek-chat' },
    ]);
    // Legacy row (had providerType) whose display name exactly matches a
    // known preset label and has no baseURL of its own -> preset fills it in.
    expect(models[0].baseURL).toBe('https://api.deepseek.com');
    expect(models[0].iconPath).toBe('/llm-icons/deepseek.svg');
  });

  it('never overwrites a custom baseURL on a legacy row even if the name matches a preset label', () => {
    const { models } = migrateModelConfigs([
      {
        providerType: 'openai-compatible',
        name: 'DeepSeek',
        modelName: 'deepseek-chat',
        baseURL: 'https://my-custom-proxy.example.com/v1',
      },
    ]);
    expect(models[0].baseURL).toBe('https://my-custom-proxy.example.com/v1');
  });

  it('does not apply preset backfill to a V2 row whose name merely coincides with a preset label', () => {
    // Give it a non-empty baseURL so the separate (legacy-independent)
    // "fill empty baseURL from provider.defaultBaseURL" branch doesn't also
    // fire and confound the assertion -- this test targets specifically the
    // isLegacyRow-gated preset-by-name backfill.
    const { models, updated } = migrateModelConfigs([
      {
        providerId: 'openai-compatible',
        modelId: 'x',
        name: 'DeepSeek',
        apiMode: 'chat',
        apiKey: '',
        extraBody: {},
        headers: {},
        inputTokenPrice: 0,
        outputTokenPrice: 0,
        maxInputTokens: 0,
        priceUnit: '$',
        baseURL: 'https://custom-endpoint.example.com',
      },
    ]);
    // Not a legacy row (no providerType, has providerId) -> preset backfill
    // must not silently rewrite baseURL/icon even though the name matches.
    expect(updated).toBe(false);
    expect(models[0].baseURL).toBe('https://custom-endpoint.example.com');
    expect(models[0].iconPath).toBeUndefined();
  });
});

describe('runFullMigration (storage key handling)', () => {
  beforeEach(() => {
    __resetMockStorage();
  });

  it('addresses storage with the RAW key, never with a literal "local:" prefix', async () => {
    // This is the exact invariant whose violation caused the 1.4.0 incident:
    // `local:model-configs` is a WXT-storage *address*, but the raw key
    // actually touched in browser.storage.local is `model-configs` (no
    // prefix). Seed the raw key and confirm the migration reads/writes it,
    // and that the version marker also ends up under its raw key.
    __resetMockStorage({
      'model-configs': [{ providerType: 'openai-compitable', modelName: 'gpt-4o' }],
    });

    await runFullMigration();

    const finalStore = __getMockStorage();
    const migrated = finalStore['model-configs'] as Array<Record<string, unknown>>;
    expect(Array.isArray(migrated)).toBe(true);
    expect(migrated[0].providerId).toBe('openai-compatible');

    // Version marker lives under the RAW key `migration-version`, not the
    // literal storage-key string `local:migration-version`.
    expect(finalStore['migration-version']).toBe(CURRENT_MIGRATION_VERSION);
    expect(finalStore[MIGRATION_VERSION_STORAGE_KEY]).toBeUndefined();
  });

  it('writes recovered data before removing the stranded keys, so a failed cleanup cannot lose it', async () => {
    // Recovery keeps the rescued rows in memory until the write lands. If the
    // removal ran first and the write then failed (a quota error, or the worker
    // being recycled), the reclaimed data would be gone for good.
    __resetMockStorage({
      'local:model-configs': [{ providerId: 'openai', modelId: 'gpt-4.1-mini' }],
    });
    __failNextStorageRemove();

    const result = await runFullMigration();

    expect(result.ok).toBe(true);
    expect(result.logs.join('\n')).toMatch(/Failed to clean up obsolete keys/);

    const finalStore = __getMockStorage();
    // The recovery is safely in place, and the marker with it...
    const recovered = finalStore['model-configs'] as Array<Record<string, unknown>>;
    expect(recovered[0].modelId).toBe('gpt-4.1-mini');
    expect(recovered[0].providerId).toBe('openai');
    expect(finalStore['migration-version']).toBe(CURRENT_MIGRATION_VERSION);
    // ...which is also why the stale copy still being present is harmless.
    expect(finalStore['local:model-configs']).toBeDefined();
  });

  it('is idempotent: running twice does not re-touch storage once the version marker matches', async () => {
    __resetMockStorage({
      'model-configs': [{ providerId: 'openai', modelId: 'gpt-4.1-mini' }],
      'migration-version': CURRENT_MIGRATION_VERSION,
    });

    const { ok, logs } = await runFullMigration();

    expect(ok).toBe(true);
    expect(logs.some((l) => l.includes('already at the current migration version'))).toBe(true);
    // Storage must be untouched (no rewrite of an already-current install).
    expect(__getMockStorage()).toEqual({
      'model-configs': [{ providerId: 'openai', modelId: 'gpt-4.1-mini' }],
      'migration-version': CURRENT_MIGRATION_VERSION,
    });
  });

  it('recovers data stranded under a wrongly `local:`-prefixed raw key when the real key is missing', async () => {
    __resetMockStorage({
      'local:model-configs': [{ providerId: 'openai', modelId: 'gpt-4.1-mini' }],
    });

    await runFullMigration();

    const finalStore = __getMockStorage();
    // Recovered rows are also run through migrateModelConfigs, so beyond the
    // fields we seeded, expect the V2 defaults (incl. baseURL backfilled
    // from the 'openai' provider) to have been filled in too.
    const recovered = (finalStore['model-configs'] as any[])[0];
    expect(recovered.providerId).toBe('openai');
    expect(recovered.modelId).toBe('gpt-4.1-mini');
    expect(recovered.baseURL).toBe('https://api.openai.com/v1');
    expect(finalStore['local:model-configs']).toBeUndefined();
  });

  it('drops a stranded `local:`-prefixed duplicate and keeps the real key when both are present', async () => {
    __resetMockStorage({
      'model-configs': [{ providerId: 'openai', modelId: 'real' }],
      'local:model-configs': [{ providerId: 'openai', modelId: 'stale-duplicate' }],
    });

    await runFullMigration();

    const finalStore = __getMockStorage();
    const kept = (finalStore['model-configs'] as any[])[0];
    expect(kept.modelId).toBe('real');
    expect(finalStore['local:model-configs']).toBeUndefined();
  });

  it('clears prompt-library-seeded when the prompt list is empty but marked seeded, so re-seeding can happen', async () => {
    __resetMockStorage({
      'prompt-library-seeded': true,
      'prompt-configs': [],
    });

    await runFullMigration();

    expect(__getMockStorage()['prompt-library-seeded']).toBe(false);
  });
});
