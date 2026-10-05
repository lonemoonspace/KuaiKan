import type { ModelConfigItem } from '@/constants/model-settings';
import { filterPersistableModelRows } from '@/lib/model-settings-storage';
import { migrateModelConfigs } from '@/lib/migration';

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

export type ModelExportOptions = {
  /**
   * Include `apiKey`, per-endpoint `headers` and the raw `extraBody` JSON. Off
   * by default: an export is a plain file that ends up in ~/Downloads, a synced
   * folder or a chat message, and re-importing a credential-free row backfills
   * the local key as long as the endpoint still matches
   * (`mergeImportedModels`). `extraBody` is user-authored JSON that the rest of
   * the code treats as sensitive (`toPublicModelConfig` strips it), so it has to
   * be cleared together with the two obvious fields.
   */
  includeSecrets?: boolean;
};

/** Refuse an oversized import before parsing it, not after. */
export const MAX_MODEL_IMPORT_FILE_BYTES = 8 * 1024 * 1024;
/** A hard cap on rows: every row is normalized and validated below. */
export const MAX_MODEL_IMPORT_ROWS = 1000;

/**
 * How long a download keeps its blob URL alive. Revoking synchronously after
 * `anchor.click()` can abort the download before the browser reads the blob.
 */
const DOWNLOAD_URL_REVOKE_DELAY_MS = 1000;

export function buildModelExportFile(
  models: ModelConfigItem[],
  defaultModelId: string | null,
  appVersion?: string,
  options: ModelExportOptions = {},
): ModelExportFile {
  const includeSecrets = options.includeSecrets === true;

  return {
    type: MODEL_EXPORT_FILE_TYPE,
    version: MODEL_EXPORT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    ...(appVersion ? { appVersion } : {}),
    defaultModelId,
    // A shallow copy per row: the caller's array is the one React is rendering.
    models: models.map((model) => ({
      ...model,
      ...(includeSecrets ? {} : { apiKey: '', headers: {}, extraBody: {} }),
    })),
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
  // A version bump must fail loudly. Without this check a future v2 file would
  // be parsed as v1: the rows look plausible, so the mis-read would be silent.
  // Legacy whole-storage backups carry no `type` marker and skip this.
  if (isRecord(raw) && raw.type === MODEL_EXPORT_FILE_TYPE) {
    const version = raw.version;
    if (
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > MODEL_EXPORT_FILE_VERSION
    ) {
      return {
        ok: false,
        error: `该导出文件的版本（${String(version)}）不是当前扩展支持的版本（${MODEL_EXPORT_FILE_VERSION}），请升级扩展后再导入。`,
      };
    }
  }

  const rows = extractModelRows(raw);

  if (!rows) {
    return { ok: false, error: '文件不是 KuaiKan 的模型导出，或内容缺少 models 列表。' };
  }

  // The import runs migration + validation over every row, so an absurd file
  // must be rejected up front instead of locking the options tab.
  if (rows.length > MAX_MODEL_IMPORT_ROWS) {
    return {
      ok: false,
      error: `文件中的模型配置过多（${rows.length} 条，最多 ${MAX_MODEL_IMPORT_ROWS} 条）。`,
    };
  }

  // Rows from a backup taken before the V1 -> V2 migration carry
  // `providerType` / `modelName` instead of `providerId` / `modelId`, so they
  // go through the same migration the storage layer runs. Without this the
  // legacy whole-storage export path accepted below would reject the very rows
  // it exists to rescue.
  const { models: migratedRows } = migrateModelConfigs(
    rows.filter(isRecord) as Record<string, unknown>[],
  );

  // Exactly the validation the write path uses, so "the file has models" and
  // "those models can be persisted" can never disagree -- the import used to
  // report a count of rows that storage then silently dropped.
  const models = filterPersistableModelRows(migratedRows);

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
  // Revoking in the same task can cancel the download before the browser has
  // read the blob (Firefox does exactly that), so release the URL a beat later.
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
}
