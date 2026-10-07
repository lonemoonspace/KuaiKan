import { describe, expect, it } from 'vitest';
import {
  buildModelExportFile,
  MAX_MODEL_IMPORT_ROWS,
  mergeImportedModels,
  MODEL_EXPORT_FILE_VERSION,
  parseModelExportFile,
} from '@/lib/model-transfer';
import {
  createDefaultModelDraft,
  type ModelConfigItem,
} from '@/constants/model-settings';

function modelRow(overrides: Partial<ModelConfigItem> = {}): ModelConfigItem {
  return {
    ...createDefaultModelDraft('openai-compatible'),
    at: 1,
    id: 'm1',
    name: 'DeepSeek',
    modelId: 'deepseek-chat',
    baseURL: 'https://api.deepseek.com/v1',
    ...overrides,
  };
}

const local: ModelConfigItem[] = [
  modelRow({ apiKey: 'local-secret', headers: { 'x-local': '1' }, modelIds: ['deepseek-chat', 'deepseek-reasoner'] }),
];

describe('mergeImportedModels', () => {
  it('backfills apiKey/headers when id, providerId and baseURL are unchanged', () => {
    const incoming = [modelRow({ apiKey: '', headers: {} })];

    const merged = mergeImportedModels(local, incoming);

    expect(merged[0].apiKey).toBe('local-secret');
    expect(merged[0].headers).toEqual({ 'x-local': '1' });
  });

  it('treats a trailing-slash-only baseURL difference as unchanged', () => {
    const incoming = [modelRow({ baseURL: 'https://api.deepseek.com/v1/', apiKey: '', headers: {} })];

    expect(mergeImportedModels(local, incoming)[0].apiKey).toBe('local-secret');
  });

  // A default export blanks extraBody along with the credentials, so a plain
  // export → import round trip used to reset every model's request parameters.
  it('backfills extraBody when the import carries none for the same endpoint', () => {
    const current = [modelRow({ extraBody: { reasoning_effort: 'high' } })];

    expect(mergeImportedModels(current, [modelRow({ extraBody: {} })])[0].extraBody).toEqual({
      reasoning_effort: 'high',
    });
    expect(
      mergeImportedModels(current, [modelRow({ extraBody: { temperature: 0.2 } })])[0].extraBody,
    ).toEqual({ temperature: 0.2 });
    expect(
      mergeImportedModels(current, [
        modelRow({ baseURL: 'https://other.example.com/v1', extraBody: {} }),
      ])[0].extraBody,
    ).toEqual({});
  });

  it('does not backfill when the baseURL changed', () => {
    const incoming = [modelRow({ baseURL: 'https://openrouter.ai/api/v1', apiKey: '', headers: {} })];

    const merged = mergeImportedModels(local, incoming);

    expect(merged[0].apiKey).toBe('');
    expect(merged[0].headers).toEqual({});
  });

  it('does not backfill when the providerId changed', () => {
    const incoming = [modelRow({ providerId: 'openai', apiKey: '', headers: {} })];

    expect(mergeImportedModels(local, incoming)[0].apiKey).toBe('');
  });

  it('keeps the imported apiKey when the import carries one', () => {
    const incoming = [modelRow({ apiKey: 'imported-secret', headers: {} })];

    expect(mergeImportedModels(local, incoming)[0].apiKey).toBe('imported-secret');
  });

  it('carries the local model pool over an import that predates the field', () => {
    const incoming = [modelRow({ modelIds: [] })];

    expect(mergeImportedModels(local, incoming)[0].modelIds).toEqual([
      'deepseek-chat',
      'deepseek-reasoner',
    ]);
  });

  it('keeps the imported model pool when the import carries one', () => {
    const incoming = [modelRow({ modelIds: ['gpt-4o', 'gpt-4o-mini'] })];

    expect(mergeImportedModels(local, incoming)[0].modelIds).toEqual([
      'gpt-4o',
      'gpt-4o-mini',
    ]);
  });

  it('keeps an imported row whose id is not present locally', () => {
    const incoming = [modelRow({ id: 'm2', apiKey: '', headers: {} })];

    const merged = mergeImportedModels(local, incoming);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('m2');
  });
});

describe('parseModelExportFile', () => {
  it('accepts the format this module writes', () => {
    const file = buildModelExportFile(local, 'm1', '2.3.0', { includeSecrets: true });

    const parsed = parseModelExportFile(JSON.parse(JSON.stringify(file)));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0].apiKey).toBe('local-secret');
    expect(parsed.defaultModelId).toBe('m1');
  });

  it('accepts the legacy whole-storage export the config manager wrote', () => {
    const legacy = {
      name: 'kuai-kan',
      version: '2.2.1',
      compatibilityVersion: 1,
      exportDate: '2026-01-01T00:00:00.000Z',
      data: { 'model-configs': local },
    };

    const parsed = parseModelExportFile(legacy);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.models[0].id).toBe('m1');
    expect(parsed.defaultModelId).toBeNull();
  });

  it('accepts V1 rows (providerType/modelName) from a pre-migration backup', () => {
    // The legacy export path exists to rescue exactly these rows, so they must
    // survive the same validation the write path applies.
    const parsed = parseModelExportFile({
      name: 'kuai-kan',
      data: {
        'model-configs': [
          {
            id: 'legacy-1',
            name: 'DeepSeek',
            providerType: 'deepseek',
            modelName: 'deepseek-chat',
            apiKey: 'sk-legacy',
          },
        ],
      },
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0].modelId).toBe('deepseek-chat');
    expect(parsed.models[0].providerId).toBe('openai-compatible');
  });

  it('rejects a file with no usable model list', () => {
    expect(parseModelExportFile(null).ok).toBe(false);
    expect(parseModelExportFile({ hello: 'world' }).ok).toBe(false);
    expect(parseModelExportFile({ type: 'kuai-kan-models', models: [] }).ok).toBe(false);
  });

  it('rejects rows the storage layer would refuse, instead of counting them as imported', () => {
    const parsed = parseModelExportFile({
      type: 'kuai-kan-models',
      models: [{ id: 'x', name: 'Unknown provider', modelId: 'm', providerId: 'not-a-provider' }],
    });

    expect(parsed.ok).toBe(false);
  });

  it('drops rows that are not model configs', () => {
    const parsed = parseModelExportFile({
      type: 'kuai-kan-models',
      version: MODEL_EXPORT_FILE_VERSION,
      models: [local[0], { id: 'broken' }, 'nope'],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.models).toHaveLength(1);
  });

  it('rejects an export written by a newer, unsupported format version', () => {
    const parsed = parseModelExportFile({
      type: 'kuai-kan-models',
      version: MODEL_EXPORT_FILE_VERSION + 1,
      models: [local[0]],
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain(String(MODEL_EXPORT_FILE_VERSION + 1));
  });

  it('rejects an export that carries the type marker but no usable version', () => {
    const parsed = parseModelExportFile({
      type: 'kuai-kan-models',
      models: [local[0]],
    });

    expect(parsed.ok).toBe(false);
  });

  it('refuses a file with more rows than the import cap', () => {
    const parsed = parseModelExportFile({
      type: 'kuai-kan-models',
      version: MODEL_EXPORT_FILE_VERSION,
      models: Array.from({ length: MAX_MODEL_IMPORT_ROWS + 1 }, (_, index) =>
        modelRow({ id: `m${index}` }),
      ),
    });

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain(String(MAX_MODEL_IMPORT_ROWS));
  });
});

describe('buildModelExportFile', () => {
  it('leaves credentials out by default and hands out copies, not the rendered rows', () => {
    const file = buildModelExportFile(local, null);

    expect(file.models[0].apiKey).toBe('');
    expect(file.models[0].headers).toEqual({});
    // `extraBody` is free-form JSON and is treated as sensitive everywhere else
    // (`toPublicModelConfig`), so it must not ride along in a "no secrets"
    // export either.
    expect(file.models[0].extraBody).toEqual({});
    expect(file.models[0]).not.toBe(local[0]);
    expect(file.type).toBe('kuai-kan-models');
    expect(file.defaultModelId).toBeNull();
    // The source rows are untouched.
    expect(local[0].apiKey).toBe('local-secret');
    expect(local[0].extraBody).toEqual({ thinking: { type: 'disabled' } });
  });

  it('includes credentials only when explicitly asked to', () => {
    const file = buildModelExportFile(local, null, '3.1.1', { includeSecrets: true });

    expect(file.models[0].apiKey).toBe('local-secret');
    expect(file.models[0].headers).toEqual({ 'x-local': '1' });
    expect(file.models[0].extraBody).toEqual({ thinking: { type: 'disabled' } });
  });
});
