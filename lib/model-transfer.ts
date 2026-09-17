import type { ModelConfigItem } from '@/constants/model-settings';

/** Marker so an arbitrary JSON file can be rejected before it is trusted. */
export const MODEL_EXPORT_FILE_TYPE = 'kuai-kan-models';
export const MODEL_EXPORT_FILE_VERSION = 1;

export type ModelExportFile = {
  type: typeof MODEL_EXPORT_FILE_TYPE;
  version: number;
  exportedAt: string;
  appVersion?: string;
  defaultModelId: string | null;
  models: ModelConfigItem[];
};

export function buildModelExportFile(
  models: ModelConfigItem[],
  defaultModelId: string | null,
  appVersion?: string,
): ModelExportFile {
  return {
    type: MODEL_EXPORT_FILE_TYPE,
    version: MODEL_EXPORT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    ...(appVersion ? { appVersion } : {}),
    defaultModelId,
    // A shallow copy per row: the caller's array is the one React is rendering.
    models: models.map((model) => ({ ...model })),
  };
}

export type ParsedModelExport =
  | { ok: true; models: ModelConfigItem[]; defaultModelId: string | null }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Accept a models export, and also the whole-storage export the removed config
 * manager used to write (`{ name: 'kuai-kan', data: { 'model-configs': [...] } }`),
 * so a backup taken before the feature moved is still usable.
 */
function extractModelRows(raw: unknown): unknown[] | null {
  if (!isRecord(raw)) return null;

  if (raw.type === MODEL_EXPORT_FILE_TYPE) {
    return Array.isArray(raw.models) ? raw.models : null;
  }

  const data = raw.data;
  if (isRecord(data)) {
    const legacy = data['model-configs'] ?? data['local:model-configs'];
    if (Array.isArray(legacy)) return legacy;
  }

  return null;
}

function normalizeBaseURL(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

export function parseModelExportFile(raw: unknown): ParsedModelExport {
  const rows = extractModelRows(raw);

  if (!rows) {
    return { ok: false, error: '文件不是 KuaiKan 的模型导出，或内容缺少 models 列表。' };
  }

  // Rows are validated in full by the storage layer on write; here we only need
  // enough shape to merge and report a count.
  const models = rows.filter(
    (row): row is ModelConfigItem =>
      isRecord(row) && typeof row.id === 'string' && typeof row.modelId === 'string',
  );

  if (models.length === 0) {
    return { ok: false, error: '文件里没有可用的模型配置。' };
  }

  const defaultModelId =
    isRecord(raw) && typeof raw.defaultModelId === 'string'
      ? raw.defaultModelId
      : null;

  return { ok: true, models: models.map((model) => ({ ...model })), defaultModelId };
}

/**
 * Merge an imported model list into the local one.
 *
 * The import wins field by field, with one exception: a row that carries no
 * `apiKey` / `headers` inherits the local ones, but only when it still points at
 * the same endpoint (`providerId` and, normalized, `baseURL`). That keeps a
 * credentials-free export from wiping every key on import, without ever handing
 * a local key to a different endpoint.
 */
export function mergeImportedModels(
  current: ModelConfigItem[],
  incoming: ModelConfigItem[],
): ModelConfigItem[] {
  const currentById = new Map(current.map((model) => [model.id, model]));

  return incoming.map((imported) => {
    const local = currentById.get(imported.id);

    if (!local) return imported;

    const sameProvider = imported.providerId === local.providerId;
    const sameBaseURL =
      normalizeBaseURL(imported.baseURL) === normalizeBaseURL(local.baseURL);

    if (!sameProvider || !sameBaseURL) return imported;

    return {
      ...imported,
      apiKey: imported.apiKey || local.apiKey,
      headers:
        imported.headers && Object.keys(imported.headers).length > 0
          ? imported.headers
          : local.headers,
      modelIds:
        imported.modelIds && imported.modelIds.length > 0
          ? imported.modelIds
          : local.modelIds,
    };
  });
}

export function downloadJsonFile(contents: string, filename: string) {
  const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
