import { describe, expect, it } from 'vitest';
import {
  buildModelExportFile,
  mergeImportedModels,
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
    const file = buildModelExportFile(local, 'm1', '2.3.0');

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

  it('rejects a file with no usable model list', () => {
    expect(parseModelExportFile(null).ok).toBe(false);
    expect(parseModelExportFile({ hello: 'world' }).ok).toBe(false);
    expect(parseModelExportFile({ type: 'kuai-kan-models', models: [] }).ok).toBe(false);
  });

  it('drops rows that are not model configs', () => {
    const parsed = parseModelExportFile({
      type: 'kuai-kan-models',
      models: [local[0], { id: 'broken' }, 'nope'],
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.models).toHaveLength(1);
  });
});

describe('buildModelExportFile', () => {
  it('includes credentials and hands out copies, not the rendered rows', () => {
    const file = buildModelExportFile(local, null);

    expect(file.models[0].apiKey).toBe('local-secret');
    expect(file.models[0]).not.toBe(local[0]);
    expect(file.type).toBe('kuai-kan-models');
    expect(file.defaultModelId).toBeNull();
  });
});
