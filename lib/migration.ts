import { MODEL_PROVIDER_DEFINITIONS } from '@/constants/model-settings';

import { createLogger } from '@/lib/logger';

const logger = createLogger('lib:migration');

export function migrateModelConfigs(models: Record<string, any>[]): { models: Record<string, any>[]; updated: boolean } {
  let updated = false;

  const migratedModels = models.map((originalModel) => {
    const model = { ...originalModel };
    // Remember the V1 shape BEFORE the fields that identify it are deleted
    // below; the preset backfill further down needs to know whether this row
    // came from legacy data, and by then `providerType` is already gone.
    const isLegacyRow = 'providerType' in model || !model.providerId;
    // V1 to V2 mapping
    if (model.providerType) {
      let type = model.providerType;
      let iconToAssign: string | undefined = undefined;

      // Fix typos or legacy names
      if (type === 'google geneative' || type === 'google generative' || type === 'google-generative') {
        type = 'google';
      } else if (type === 'openai-compitable') {
        type = 'openai-compatible';
      }

      // If it's not a standard provider, map to openai-compatible
      const standardProviders = ['openai', 'anthropic', 'google', 'ollama', 'open-responses', 'openai-compatible'];
      if (!standardProviders.includes(type)) {
        let urlToAssign: string | undefined = undefined;

        // Use the original type to determine icon before overwriting
        const lowerType = type.toLowerCase();
        if (lowerType.includes('deepseek')) { iconToAssign = '/llm-icons/deepseek.svg'; urlToAssign = 'https://api.deepseek.com'; }
        else if (lowerType.includes('moonshot') || lowerType.includes('kimi')) { iconToAssign = '/llm-icons/kimi-web.svg'; urlToAssign = 'https://api.moonshot.ai/v1'; }
        else if (lowerType.includes('xai')) { iconToAssign = '/llm-icons/xAI.svg'; urlToAssign = 'https://api.x.ai/v1'; }
        else if (lowerType.includes('openrouter')) { iconToAssign = '/llm-icons/openrouter.svg'; urlToAssign = 'https://openrouter.ai/api/v1'; }
        else if (lowerType.includes('perplexity')) { iconToAssign = '/llm-icons/perplexity.svg'; urlToAssign = 'https://api.perplexity.ai/v1'; }
        else if (lowerType.includes('siliconflow')) { iconToAssign = '/llm-icons/siliconflow.svg'; urlToAssign = 'https://api.siliconflow.cn/v1'; }
        else if (lowerType.includes('together')) { iconToAssign = '/llm-icons/together.svg'; urlToAssign = 'https://api.together.xyz/v1'; }
        else if (lowerType.includes('cohere')) { iconToAssign = '/llm-icons/cohere.svg'; urlToAssign = 'https://api.cohere.com/v1'; }
        else if (lowerType.includes('deepinfra')) { iconToAssign = '/llm-icons/deepinfra.svg'; urlToAssign = 'https://api.deepinfra.com/v1/openai'; }
        else if (lowerType.includes('groq')) { iconToAssign = '/llm-icons/groq.svg'; urlToAssign = 'https://api.groq.com/openai/v1'; }
        else if (lowerType.includes('zhipu') || lowerType.includes('glm')) { iconToAssign = '/llm-icons/zhipu.svg'; urlToAssign = 'https://open.bigmodel.cn/api/paas/v4'; }
        else if (lowerType.includes('minimax')) { iconToAssign = '/llm-icons/minimax.svg'; urlToAssign = 'https://api.minimax.io/v1'; }
        else if (lowerType.includes('mistral')) { iconToAssign = '/llm-icons/mistral.svg'; urlToAssign = 'https://api.mistral.ai/v1'; }
        else if (lowerType.includes('qwen') || lowerType.includes('aliyun') || lowerType.includes('dashscope')) { iconToAssign = '/llm-icons/aliyun.svg'; urlToAssign = 'https://dashscope.aliyuncs.com/compatible-mode/v1'; }
        else if (lowerType.includes('baidu') || lowerType.includes('qianfan')) { iconToAssign = '/llm-icons/baidu.svg'; urlToAssign = 'https://qianfan.baidubce.com/v2'; }
        else if (lowerType.includes('byteplus')) { iconToAssign = '/llm-icons/byteplus.svg'; urlToAssign = 'https://ark.ap-southeast.bytepluses.com/api/v3'; }
        else if (lowerType.includes('volcengine') || lowerType.includes('ark')) { iconToAssign = '/llm-icons/volcengine.svg'; urlToAssign = 'https://ark.cn-beijing.volces.com/api/v3'; }
        else if (lowerType.includes('cerebras')) { iconToAssign = '/llm-icons/cerebras.svg'; urlToAssign = 'https://api.cerebras.ai/v1'; }

        if (urlToAssign && !model.baseURL) {
          model.baseURL = urlToAssign;
        }

        type = 'openai-compatible';
      }

      model.providerId = type;
      if (iconToAssign && !model.iconPath) {
        model.iconPath = iconToAssign;
      }
      delete model.providerType;
      updated = true;
    }
    if (model.modelName) {
      model.modelId = model.modelName;
      delete model.modelName;
      updated = true;
    }
    
    // Fill in required V2 fields
    const defaultFields: Partial<any> = {
      apiMode: 'chat',
      apiKey: '',
      extraBody: {},
      headers: {},
      inputTokenPrice: 0,
      outputTokenPrice: 0,
      maxInputTokens: 0,
      priceUnit: '$',
      baseURL: model.baseURL || ''
    };
    
    for (const [key, value] of Object.entries(defaultFields)) {
      if (typeof model[key] === 'undefined') {
        model[key] = value;
        updated = true;
      }
    }

    const provider = MODEL_PROVIDER_DEFINITIONS.find((p) => p.id === model.providerId);
    if (provider) {
      if (!model.baseURL && provider.supportsBaseURL) {
        model.baseURL = provider.defaultBaseURL;
        updated = true;
      }

      // Preset merges (icon/baseURL backfill) must only apply to rows that
      // actually came from legacy V1 data (captured above, before the V1
      // marker fields were deleted). A V2 row whose display name merely
      // matches a preset label ("DeepSeek", "Groq", …) but points at a custom
      // endpoint must never have its baseURL silently rewritten.
      if (isLegacyRow) {
        // Find if this model matches one of the provider's presets exactly on baseURL
        // and if it's lacking an icon or needs other fields updated, we can merge them.
        const preset = provider.baseURLPresets.find(p => p.url === model.baseURL || p.label === model.name);

        if (preset) {
          // Only ever FILL an empty baseURL from the preset. A legacy row that
          // already points somewhere (custom endpoint, or a preset URL that has
          // since changed upstream) keeps whatever the user had.
          if (model.name === preset.label && !model.baseURL) {
            model.baseURL = preset.url;
            updated = true;
          }
          // If the preset has an icon and the model doesn't
          if (preset.iconPath && !model.iconPath) {
            model.iconPath = preset.iconPath;
            updated = true;
          }
        } else if (model.baseURL === provider.defaultBaseURL && !model.iconPath) {
          model.iconPath = provider.iconPath;
          updated = true;
        }
      }
    }
    return model;
  });

  return { models: migratedModels, updated };
}

// Idempotency marker so the migration only rewrites storage after an actual
// upgrade instead of on every extension update.
export const MIGRATION_VERSION_STORAGE_KEY = 'local:migration-version';
// v3: the marker itself moved from the raw key `local:migration-version` to the
// correct raw key `migration-version`, and the migration no longer relocates
// live keys. Bumping forces one repair pass on installs damaged by v2.
// v4: drops the two storage keys orphaned by the removed floating-ball feature.
export const CURRENT_MIGRATION_VERSION = 4;

// WXT storage keys are written as `area:key`, and @wxt-dev/storage strips the
// area prefix before touching browser.storage. So `storage.getItem(
// 'local:model-configs')` reads the RAW key `model-configs` — the `local:`
// part never reaches browser.storage.local at all.
//
// An earlier version of this file assumed the opposite and "migrated" every
// raw key onto a `local:`-prefixed copy of itself. Because the raw key is the
// live one, that deleted the user's real models/prompts/site rules and wrote
// them to names nothing ever reads. Keys are addressed raw here, and the only
// thing this migration does is rewrite the model list in place.
function rawKey(storageKey: string): string {
  const separatorIndex = storageKey.indexOf(':');
  return separatorIndex === -1 ? storageKey : storageKey.slice(separatorIndex + 1);
}

const MODEL_CONFIGS_RAW_KEY = rawKey('local:model-configs');
const MIGRATION_VERSION_RAW_KEY = rawKey(MIGRATION_VERSION_STORAGE_KEY);

// Keys that were written by builds that really did use a `local:`-prefixed raw
// key (i.e. storage damaged by the buggy migration described above) plus a
// genuinely obsolete setting. These are dead weight and safe to delete.
const OBSOLETE_RAW_KEYS = [
  'content-samples-position',
  'local:content-samples-position',
  // Left behind by the removed floating-ball feature (v3.1.2+). Nothing reads
  // them any more, so drop them on the next migration instead of carrying two
  // dead keys forever.
  'enable-floating-ball',
  'local:enable-floating-ball',
  'right-floating-ball-top-page',
  'local:right-floating-ball-top-page',
];

export type MigrationResult = { ok: boolean; logs: string[] };

export async function runFullMigration(): Promise<MigrationResult> {
  const { browser } = await import('wxt/browser');
  const logs: string[] = [];
  let ok = true;

  try {
    const data = await browser.storage.local.get(null);
    logs.push(`Found ${Object.keys(data).length} raw configuration keys in storage.`);

    if (data[MIGRATION_VERSION_RAW_KEY] === CURRENT_MIGRATION_VERSION) {
      logs.push('Storage is already at the current migration version, skipping.');
      return { ok, logs };
    }

    const keysToSet: Record<string, unknown> = {};
    const keysToRemove: string[] = [];

    for (const obsoleteKey of OBSOLETE_RAW_KEYS) {
      if (obsoleteKey in data) keysToRemove.push(obsoleteKey);
    }

    // Recover data stranded by the older, broken migration: if a
    // `local:`-prefixed duplicate exists and the real key is gone, move it
    // back. The real key always wins when both are present.
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('local:')) continue;
      if (OBSOLETE_RAW_KEYS.includes(key)) continue;

      const realKey = rawKey(key);
      if (realKey === MIGRATION_VERSION_RAW_KEY) {
        keysToRemove.push(key);
        continue;
      }

      if (realKey in data) {
        logs.push(`Dropping stranded duplicate "${key}" ("${realKey}" is present).`);
      } else {
        keysToSet[realKey] = value;
        logs.push(`Recovered stranded key: ${key} -> ${realKey}`);
      }
      keysToRemove.push(key);
    }

    // V1 -> V2 model config conversion, written back to the same key it was
    // read from. `keysToSet` may already hold a recovered list, so prefer that.
    const modelConfigs = keysToSet[MODEL_CONFIGS_RAW_KEY] ?? data[MODEL_CONFIGS_RAW_KEY];
    if (Array.isArray(modelConfigs)) {
      const { models: migratedModels, updated } = migrateModelConfigs(modelConfigs);
      if (updated) {
        keysToSet[MODEL_CONFIGS_RAW_KEY] = migratedModels;
        logs.push('Successfully upgraded model configurations.');
      } else {
        logs.push('No model updates needed.');
      }
    }

    // Self-heal installs the v2 migration already emptied: the prompt list was
    // deleted but `prompt-library-seeded` survived, so the seeder short-circuits
    // and the user is left with no prompts and no way back. Clearing the flag
    // lets the background re-create the sample prompt on next start.
    const promptsRawKey = rawKey('local:prompt-configs');
    const seededRawKey = rawKey('local:prompt-library-seeded');
    const prompts = keysToSet[promptsRawKey] ?? data[promptsRawKey];
    const hasPrompts = Array.isArray(prompts) && prompts.length > 0;

    if (data[seededRawKey] === true && !hasPrompts) {
      keysToSet[seededRawKey] = false;
      logs.push('Prompt library is empty but marked seeded; clearing the flag to re-seed.');
    }

    // Everything else stays exactly where it is — no full-store rewrite.

    // Write before removing. The recovered keys above only exist in memory
    // until this `set` lands, and MV3 can recycle the worker at any await; if
    // the removal ran first and the write then failed (a storage quota error is
    // not far-fetched for a 10MB store with no `unlimitedStorage`), the data
    // that was just recovered would be gone for good. The version marker rides
    // along with the same write, so a crash after the write and before the
    // removal only leaves harmless duplicate `local:` keys behind.
    keysToSet[MIGRATION_VERSION_RAW_KEY] = CURRENT_MIGRATION_VERSION;
    await browser.storage.local.set(keysToSet);
    logs.push(`Saved migrated keys: ${Object.keys(keysToSet).join(', ')}`);

    if (keysToRemove.length > 0) {
      try {
        await browser.storage.local.remove(keysToRemove);
        logs.push(`Cleaned up obsolete keys: ${keysToRemove.join(', ')}`);
      } catch (error) {
        // The user's data is already safe; a leftover key is cosmetic.
        logs.push(`Failed to clean up obsolete keys: ${String(error)}`);
        logger.warn('Migration could not remove obsolete keys:', error);
      }
    }
  } catch (error) {
    ok = false;
    logs.push(`Migration error: ${String(error)}`);
    logger.error('Migration error:', error);
  }

  return { ok, logs };
}
