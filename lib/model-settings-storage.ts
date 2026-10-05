import { storage } from '#imports';
import { uid } from 'radash';
import {
  DEFAULT_MODEL_ID_V2_STORAGE_KEY,
  MODEL_CONFIGS_V2_STORAGE_KEY,
  createDefaultModelDraft,
  getModelProviderDefinition,
  isModelApiMode,
  isModelProviderId,
  normalizeOllamaBaseURL,
  type ModelConfigItem,
  type ModelDraft,
} from '@/constants/model-settings';
import { createLogger } from '@/lib/logger';

const logger = createLogger('lib:model-settings-storage');

export type ModelSettings = {
  defaultModelId: string | null;
  models: ModelConfigItem[];
};

export type ModelMoveDirection = 'down' | 'up';

export type RemoteModelInfo = {
  id: string;
  label: string;
};

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, headerValue]) => [key.trim(), cleanString(headerValue)])
      .filter(([key, headerValue]) => key && headerValue),
  );
}

function cleanExtraBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function cleanModelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    const id = cleanString(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

function cleanNonNegativeNumber(value: unknown) {
  const numberValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : 0;

  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function normalizeApiMode(value: unknown, providerId: ModelConfigItem['providerId']) {
  const provider = getModelProviderDefinition(providerId);

  if (providerId === 'open-responses') {
    return 'responses';
  }

  return provider.supportsApiMode && isModelApiMode(value) ? value : 'chat';
}

function isModelConfigItem(value: unknown): value is ModelConfigItem {
  if (!value || typeof value !== 'object') return false;

  const model = value as Record<string, unknown>;

  return (
    typeof model.id === 'string' &&
    typeof model.name === 'string' &&
    isModelProviderId(model.providerId) &&
    typeof model.modelId === 'string'
  );
}

function normalizeBaseURL(
  providerId: ModelConfigItem['providerId'],
  provider: { supportsBaseURL: boolean; defaultBaseURL: string },
  value: unknown,
) {
  if (!provider.supportsBaseURL) return '';

  const baseURL = cleanString(value) || provider.defaultBaseURL;

  // Ollama's row moved from the native `/api` to the OpenAI-compatible `/v1`
  // (see normalizeOllamaBaseURL), so a base URL stored by an earlier version is
  // rewritten on load and persisted as `/v1` on the next write.
  return providerId === 'ollama' ? normalizeOllamaBaseURL(baseURL) : baseURL;
}

function normalizeModel(value: ModelConfigItem): ModelConfigItem | null {
  const provider = getModelProviderDefinition(value.providerId);
  const name = cleanString(value.name);
  const modelId = cleanString(value.modelId);

  if (!value.id || !name || !modelId) {
    return null;
  }

  return {
    apiKey: cleanString(value.apiKey),
    apiMode: normalizeApiMode(value.apiMode, value.providerId),
    at: typeof value.at === 'number' ? value.at : Date.now(),
    baseURL: normalizeBaseURL(value.providerId, provider, value.baseURL),
    extraBody: cleanExtraBody(value.extraBody),
    headers: cleanHeaders(value.headers),
    iconPath: cleanString(value.iconPath),
    id: value.id,
    inputTokenPrice: cleanNonNegativeNumber(value.inputTokenPrice),
    maxInputTokens: cleanNonNegativeNumber(value.maxInputTokens),
    modelId,
    modelIds: cleanModelIds(value.modelIds),
    name,
    outputTokenPrice: cleanNonNegativeNumber(value.outputTokenPrice),
    priceUnit: cleanString(value.priceUnit) || '$',
    providerId: value.providerId,
  };
}

/**
 * Split a stored list into the rows this version understands and everything
 * else.
 *
 * Loaders are deliberately tolerant: a row written by a newer version, a
 * hand-edited file, or a provider id that no longer exists is skipped with a
 * warning rather than crashing the settings page. Writes must not turn that
 * tolerance into deletion, so the unparsed rows travel with the write (see
 * `writeModelSettings`) instead of being dropped on the floor.
 */
function splitModelRows(value: unknown): {
  models: ModelConfigItem[];
  unparsed: unknown[];
} {
  if (!Array.isArray(value)) return { models: [], unparsed: [] };

  const models: ModelConfigItem[] = [];
  const unparsed: unknown[] = [];

  for (const item of value) {
    if (!isModelConfigItem(item)) {
      const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      logger.warn('[parseModels] Keeping an unparsed model row with an invalid shape or unknown providerId', {
        id: typeof record.id === 'string' ? record.id : undefined,
        providerId: record.providerId,
      });
      unparsed.push(item);
      continue;
    }

    const normalized = normalizeModel(item);
    if (!normalized) {
      logger.warn('[parseModels] Keeping an unparsed model row missing a required field (name/modelId)', {
        id: item.id,
        providerId: item.providerId,
      });
      unparsed.push(item);
      continue;
    }

    models.push(normalized);
  }

  return { models, unparsed };
}

function parseModels(value: unknown) {
  return splitModelRows(value).models;
}

/**
 * The rows of an external list (an import file, a hand-edited backup) that this
 * build can actually persist, validated by the same code the write path uses.
 */
export function filterPersistableModelRows(rows: unknown[]): ModelConfigItem[] {
  return splitModelRows(rows).models;
}

function normalizeDefaultModelId(
  defaultModelId: unknown,
  models: ModelConfigItem[],
) {
  return typeof defaultModelId === 'string' &&
    models.some((model) => model.id === defaultModelId)
    ? defaultModelId
    : models[0]?.id ?? null;
}

function isDuplicateName(
  models: ModelConfigItem[],
  name: string,
  excludedId?: string,
) {
  return models.some(
    (model) =>
      model.id !== excludedId &&
      model.name.localeCompare(name, undefined, { sensitivity: 'accent' }) ===
        0,
  );
}

function validateDraft(draft: ModelDraft): ModelDraft {
  const provider = getModelProviderDefinition(draft.providerId);
  const name = cleanString(draft.name);
  const modelId = cleanString(draft.modelId);
  const baseURL = normalizeBaseURL(draft.providerId, provider, draft.baseURL);

  if (!name || !modelId) {
    throw new Error('请填写模型名称与模型 ID。');
  }

  if (provider.supportsBaseURL && !baseURL) {
    throw new Error('请填写 Base URL。');
  }

  return {
    apiKey: cleanString(draft.apiKey),
    apiMode: normalizeApiMode(draft.apiMode, draft.providerId),
    baseURL,
    extraBody: cleanExtraBody(draft.extraBody),
    headers: cleanHeaders(draft.headers),
    iconPath: cleanString(draft.iconPath),
    inputTokenPrice: cleanNonNegativeNumber(draft.inputTokenPrice),
    maxInputTokens: cleanNonNegativeNumber(draft.maxInputTokens),
    modelId,
    modelIds: cleanModelIds(draft.modelIds),
    name,
    outputTokenPrice: cleanNonNegativeNumber(draft.outputTokenPrice),
    priceUnit: cleanString(draft.priceUnit) || '$',
    providerId: draft.providerId,
  };
}

function normalizeFetchDraft(draft: ModelDraft) {
  const provider = getModelProviderDefinition(draft.providerId);

  if (!provider.supportsModelFetch || !provider.modelsPath) {
    throw new Error('该提供商没有可用的模型列表接口。');
  }

  const baseURL = normalizeBaseURL(draft.providerId, provider, draft.baseURL);

  if (provider.supportsBaseURL && !baseURL) {
    throw new Error('请填写 Base URL。');
  }

  return { baseURL, providerId: draft.providerId };
}

/** Raw rows currently in storage that this version cannot parse. */
async function readPreservedRows(): Promise<unknown[]> {
  const raw = await storage.getItem<unknown>(MODEL_CONFIGS_V2_STORAGE_KEY);

  return splitModelRows(raw).unparsed;
}

/** De-duplicate preserved rows (they are carried across writes verbatim). */
function uniqueRows(rows: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];

  for (const row of rows) {
    let key: string;
    try {
      key = JSON.stringify(row) ?? String(row);
    } catch {
      key = String(row);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }

  return result;
}

export type ModelSettingsWriteResult = {
  defaultModelId: string | null;
  models: ModelConfigItem[];
  /** Rows the caller supplied that this version cannot treat as a model. */
  rejected: number;
  /** Unparsed rows kept in storage (from this write and from before it). */
  preserved: number;
};

async function writeModelSettings(settings: ModelSettings): Promise<ModelSettingsWriteResult> {
  const { models, unparsed } = splitModelRows(settings.models);
  // Anything this version cannot parse is written back untouched, after the
  // managed rows. Without this, editing one model would silently delete a row
  // an older/newer build wrote -- together with its API key.
  const preserved = uniqueRows([...(await readPreservedRows()), ...unparsed]);
  const defaultModelId = normalizeDefaultModelId(settings.defaultModelId, models);

  await storage.setItems([
    {
      key: MODEL_CONFIGS_V2_STORAGE_KEY,
      value: [...models, ...preserved],
    },
    {
      key: DEFAULT_MODEL_ID_V2_STORAGE_KEY,
      value: defaultModelId,
    },
  ]);

  return { defaultModelId, models, rejected: unparsed.length, preserved: preserved.length };
}

/**
 * Replace the whole model list, e.g. when importing an exported file. Rows go
 * through the same normalization as every other write, so a hand-edited or
 * partially-shaped file cannot put data into storage the loader would drop.
 *
 * An import that parses to nothing is refused outright: the caller asked to
 * replace the list, and wiping every model because the file was shaped
 * differently than expected is not a useful outcome.
 */
export async function replaceModelSettings(settings: ModelSettings) {
  if (settings.models.length > 0 && splitModelRows(settings.models).models.length === 0) {
    throw new Error('导入的模型配置都无法识别，已保留原有配置。');
  }

  return writeModelSettings(settings);
}

export async function loadModelSettings(): Promise<ModelSettings> {
  const [modelsItem, defaultModelItem] = await storage.getItems([
    {
      key: MODEL_CONFIGS_V2_STORAGE_KEY,
      options: { fallback: [] },
    },
    {
      key: DEFAULT_MODEL_ID_V2_STORAGE_KEY,
      options: { fallback: null },
    },
  ]);
  const models = parseModels(modelsItem?.value);

  return {
    defaultModelId: normalizeDefaultModelId(defaultModelItem?.value, models),
    models,
  };
}

export async function getDefaultModelConfig() {
  const settings = await loadModelSettings();

  return (
    settings.models.find((model) => model.id === settings.defaultModelId) ??
    settings.models[0] ??
    null
  );
}

export async function getModelConfigById(id: string | null | undefined) {
  const settings = await loadModelSettings();

  if (!id) {
    return (
      settings.models.find((model) => model.id === settings.defaultModelId) ??
      settings.models[0] ??
      null
    );
  }

  return settings.models.find((model) => model.id === id) ?? null;
}

export async function createModelConfig(draft: ModelDraft) {
  const settings = await loadModelSettings();
  const normalizedDraft = validateDraft(draft);

  let finalName = normalizedDraft.name;
  if (isDuplicateName(settings.models, finalName)) {
    let suffix = 1;
    while (isDuplicateName(settings.models, `${normalizedDraft.name} (${suffix})`)) {
      suffix++;
    }
    finalName = `${normalizedDraft.name} (${suffix})`;
  }

  const model: ModelConfigItem = {
    ...normalizedDraft,
    name: finalName,
    at: Date.now(),
    id: uid(16),
  };

  settings.models.push(model);

  await writeModelSettings({
    defaultModelId: settings.defaultModelId ?? model.id,
    models: settings.models,
  });

  return model;
}

export async function updateModelConfig(id: string, draft: ModelDraft) {
  const settings = await loadModelSettings();
  const index = settings.models.findIndex((model) => model.id === id);

  if (index === -1) {
    throw new Error('未找到该模型配置。');
  }

  const normalizedDraft = validateDraft(draft);

  if (isDuplicateName(settings.models, normalizedDraft.name, id)) {
    throw new Error('模型名称已存在。');
  }

  settings.models[index] = {
    ...settings.models[index],
    ...normalizedDraft,
  };

  await writeModelSettings(settings);

  return settings.models[index];
}

export async function deleteModelConfig(id: string) {
  const settings = await loadModelSettings();
  const models = settings.models.filter((model) => model.id !== id);

  if (models.length === settings.models.length) {
    return false;
  }

  await writeModelSettings({
    defaultModelId:
      settings.defaultModelId === id ? models[0]?.id ?? null : settings.defaultModelId,
    models,
  });

  return true;
}

export async function moveModelConfig(id: string, direction: ModelMoveDirection) {
  const settings = await loadModelSettings();
  const index = settings.models.findIndex((model) => model.id === id);
  const nextIndex = direction === 'up' ? index - 1 : index + 1;

  if (
    index === -1 ||
    nextIndex < 0 ||
    nextIndex >= settings.models.length
  ) {
    return false;
  }

  const models = [...settings.models];
  [models[index], models[nextIndex]] = [models[nextIndex], models[index]];

  await writeModelSettings({
    defaultModelId: settings.defaultModelId,
    models,
  });

  return true;
}

export async function setDefaultModelConfig(id: string) {
  const settings = await loadModelSettings();

  if (!settings.models.some((model) => model.id === id)) {
    return false;
  }

  await writeModelSettings({
    defaultModelId: id,
    models: settings.models,
  });

  return true;
}

/**
 * Switch which of a config's pooled models is in use, without touching any
 * other field. The panel and popup pickers call this; going through
 * `updateModelConfig()` instead would require a full draft and would re-run
 * the duplicate-name and base-URL validation for a one-field change.
 *
 * `modelId` only has to be non-empty — a value typed by hand and absent from
 * the pool is legitimate, and switching to it must not rewrite the pool.
 */
export async function setModelConfigModelId(configId: string, modelId: string) {
  const settings = await loadModelSettings();
  const index = settings.models.findIndex((model) => model.id === configId);
  const nextModelId = cleanString(modelId);

  if (index === -1 || !nextModelId) {
    return false;
  }

  if (settings.models[index].modelId === nextModelId) {
    return true;
  }

  const models = [...settings.models];
  models[index] = { ...models[index], modelId: nextModelId };

  await writeModelSettings({
    defaultModelId: settings.defaultModelId,
    models,
  });

  return true;
}

export function createEmptyModelDraft() {
  return createDefaultModelDraft('openai-compatible');
}

/**
 * How long the settings page waits for a remote model list before giving up.
 * Without it a server that accepts the connection and then never responds
 * (stalled local model, wedged proxy) left the Fetch button disabled and
 * reading "Fetching" forever, with no way to cancel.
 */
export const REMOTE_MODEL_FETCH_TIMEOUT_MS = 15_000;

export async function fetchRemoteModels(
  draft: ModelDraft,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<RemoteModelInfo[]> {
  const normalized = normalizeFetchDraft(draft);
  const provider = getModelProviderDefinition(normalized.providerId);

  let endpoint: URL;
  try {
    endpoint = new URL(
      provider.modelsPath!.replace(/^\/+/, ''),
      normalized.baseURL.endsWith('/')
        ? normalized.baseURL
        : `${normalized.baseURL}/`,
    );
  } catch {
    // `new URL` throws a bare TypeError for a malformed base URL; surface
    // something the settings page can show as-is.
    throw new Error('Base URL 格式不正确，无法拼接模型列表地址。');
  }

  const headers: Record<string, string> = cleanHeaders(draft.headers);
  const apiKey = cleanString(draft.apiKey);

  if (apiKey) {
    headers.Authorization = headers.Authorization || `Bearer ${apiKey}`;
  }

  const timeoutMs = options.timeoutMs ?? REMOTE_MODEL_FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await fetch(endpoint, {
      headers,
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new Error(extractErrorMessage(payload) || `${response.status} ${response.statusText}`);
    }

    return extractRemoteModels(payload);
  } catch (error) {
    if (timedOut) {
      throw new Error(
        `获取模型列表超时（${Math.round(timeoutMs / 1000)} 秒），请检查 Base URL 是否可达。`,
      );
    }
    if (options.signal?.aborted) {
      throw new Error('已取消获取模型列表。');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

function extractErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';

  const data = payload as Record<string, unknown>;
  const error = data.error;

  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;

    if (typeof message === 'string') return message;
  }

  return '';
}

export function extractRemoteModels(payload: unknown): RemoteModelInfo[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const data = payload as Record<string, unknown>;
  const list = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.models)
      ? data.models
      : Array.isArray(payload)
        ? payload
        : [];

  return list
    .map((item) => {
      if (typeof item === 'string') {
        return { id: item, label: item };
      }

      if (!item || typeof item !== 'object') {
        return null;
      }

      const model = item as Record<string, unknown>;
      const id = cleanString(model.id) || cleanString(model.name) || cleanString(model.model);

      if (!id) {
        return null;
      }

      return {
        id,
        label: cleanString(model.name) || id,
      };
    })
    .filter((model): model is RemoteModelInfo => model !== null);
}
