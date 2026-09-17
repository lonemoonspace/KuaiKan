import type { StorageItemKey } from '#imports';

export const MODEL_CONFIGS_V2_STORAGE_KEY: StorageItemKey =
  'local:model-configs';
export const DEFAULT_MODEL_ID_V2_STORAGE_KEY: StorageItemKey =
  'local:default-model-id';

export const MODEL_API_MODES = ['chat', 'responses'] as const;
export type ModelApiMode = (typeof MODEL_API_MODES)[number];

export const AVAILABLE_ICONS = [
  // 御四家
  '/llm-icons/openai.svg',
  '/llm-icons/anthropic.svg',
  '/llm-icons/gemini.svg',
  '/llm-icons/xAI.svg',

  // 中转站第二梯队
  '/llm-icons/openrouter.svg',
  '/llm-icons/vercel.svg',
  '/llm-icons/groq.svg',
  '/llm-icons/cerebras.svg',

  // 模型商
  '/llm-icons/minimax.svg',
  '/llm-icons/zai.svg',
  '/llm-icons/zhipu.svg',
  '/llm-icons/kimi-web.svg',
  '/llm-icons/mistral.svg',
  '/llm-icons/stepfun.svg',
  '/llm-icons/xiaomimimo.svg',
  '/llm-icons/aliyun.svg',
  '/llm-icons/volcengine.svg',

  // 剩余的
  '/llm-icons/baidu.svg',
  '/llm-icons/byteplus.svg',
  '/llm-icons/cohere.svg',
  '/llm-icons/deepinfra.svg',
  '/llm-icons/deepseek.svg',
  '/llm-icons/fireworks.svg',
  '/llm-icons/google.svg',
  '/llm-icons/huggingface.svg',
  '/llm-icons/kilocode.svg',
  '/llm-icons/lmstudio.svg',
  '/llm-icons/nvidia.svg',
  '/llm-icons/ollama.svg',
  '/llm-icons/openai-comp.svg',
  '/llm-icons/openresponses.svg',
  '/llm-icons/perplexity.svg',
  '/llm-icons/qwen.svg',
  '/llm-icons/siliconflow.svg',
  '/llm-icons/together.svg',
  '/llm-icons/venice.svg',
];

export type BaseURLPreset = {
  label: string;
  url: string;
  iconPath?: string;
};

export const MODEL_PROVIDER_DEFINITIONS: {
  baseURLPresets: BaseURLPreset[];
  defaultBaseURL: string;
  /**
   * Body overrides a new config starts with. Only set this for providers whose
   * API tolerates (or expects) the extra fields: an unknown top-level parameter
   * is a 400 on OpenAI, Anthropic and Google.
   */
  defaultExtraBody?: Record<string, unknown>;
  defaultModelId: string;
  desc: string;
  docsUrl: string;
  iconPath: string;
  id: string;
  label: string;
  modelsPath: string;
  requiresApiKey: boolean;
  supportsApiMode: boolean;
  supportsBaseURL: boolean;
  supportsModelFetch: boolean;
}[] = [
  {
    baseURLPresets: [
      // 御四家排名前4
      { label: 'xAI Grok', url: 'https://api.x.ai/v1', iconPath: '/llm-icons/xAI.svg' },

      // 中转站第二梯队
      { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', iconPath: '/llm-icons/openrouter.svg' },
      { label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh/v1', iconPath: '/llm-icons/vercel.svg' },
      { label: 'Groq', url: 'https://api.groq.com/openai/v1', iconPath: '/llm-icons/groq.svg' },
      { label: 'Cerebras', url: 'https://api.cerebras.ai/v1', iconPath: '/llm-icons/cerebras.svg' },

      // 模型商
      { label: 'MiniMax Global', url: 'https://api.minimax.io/v1', iconPath: '/llm-icons/minimax.svg' },
      { label: 'MiniMax China', url: 'https://api.minimaxi.com/v1', iconPath: '/llm-icons/minimax.svg' },
      { label: 'Z.AI GLM', url: 'https://api.z.ai/api/paas/v4', iconPath: '/llm-icons/zai.svg' },
      { label: 'Zhipu BigModel', url: 'https://open.bigmodel.cn/api/paas/v4', iconPath: '/llm-icons/zhipu.svg' },
      { label: 'Kimi Global', url: 'https://api.moonshot.ai/v1', iconPath: '/llm-icons/kimi-web.svg' },
      { label: 'Kimi China', url: 'https://api.moonshot.cn/v1', iconPath: '/llm-icons/kimi-web.svg' },
      { label: 'Mistral', url: 'https://api.mistral.ai/v1', iconPath: '/llm-icons/mistral.svg' },
      { label: 'StepFun', url: 'https://api.stepfun.ai/v1', iconPath: '/llm-icons/stepfun.svg' },
      { label: 'Xiaomi MiMo', url: 'https://api.xiaomimimo.com/v1', iconPath: '/llm-icons/xiaomimimo.svg' },
      {
        label: 'DashScope',
        url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        iconPath: '/llm-icons/aliyun.svg'
      },
      {
        label: 'DashScope Intl',
        url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        iconPath: '/llm-icons/aliyun.svg'
      },
      { label: 'Volcengine Ark', url: 'https://ark.cn-beijing.volces.com/api/v3', iconPath: '/llm-icons/volcengine.svg' },

      // 剩余的保持原顺序
      { label: 'DeepSeek', url: 'https://api.deepseek.com', iconPath: '/llm-icons/deepseek.svg' },
      {
        label: 'BytePlus ModelArk',
        url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
        iconPath: '/llm-icons/byteplus.svg'
      },
      { label: 'Qianfan', url: 'https://qianfan.baidubce.com/v2', iconPath: '/llm-icons/baidu.svg' },
      { label: 'SiliconFlow', url: 'https://api.siliconflow.cn/v1', iconPath: '/llm-icons/siliconflow.svg' },
      { label: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1', iconPath: '/llm-icons/nvidia.svg' },
      { label: 'Perplexity', url: 'https://api.perplexity.ai/v1', iconPath: '/llm-icons/perplexity.svg' },
      { label: 'DeepInfra', url: 'https://api.deepinfra.com/v1/openai', iconPath: '/llm-icons/deepinfra.svg' },
      { label: 'Hugging Face', url: 'https://router.huggingface.co/v1', iconPath: '/llm-icons/huggingface.svg' },
      { label: 'Fireworks', url: 'https://api.fireworks.ai/inference/v1', iconPath: '/llm-icons/fireworks.svg' },
      { label: 'Together AI', url: 'https://api.together.xyz/v1', iconPath: '/llm-icons/together.svg' },
      { label: 'Venice AI', url: 'https://api.venice.ai/api/v1', iconPath: '/llm-icons/venice.svg' },
      { label: 'Kilo Gateway', url: 'https://api.kilo.ai/api/gateway', iconPath: '/llm-icons/kilocode.svg' },
      { label: 'LM Studio', url: 'http://localhost:1234/v1', iconPath: '/llm-icons/lmstudio.svg' },
      { label: 'Ollama OpenAI', url: 'http://localhost:11434/v1', iconPath: '/llm-icons/ollama.svg' },
    ],
    defaultBaseURL: '',
    // Third-party compatible endpoints (DeepSeek & co.) accept this switch and
    // reasoning models spend most of their latency on thinking the user did
    // not ask for; official OpenAI/Anthropic/Google reject the field outright.
    defaultExtraBody: { thinking: { type: 'disabled' } },
    defaultModelId: '',
    desc: 'Generic OpenAI-compatible Chat Completions provider for compatible /v1 APIs such as DashScope, SiliconFlow, OpenRouter, LM Studio, or local proxies.',
    docsUrl: 'https://ai-sdk.dev/providers/openai-compatible-providers',
    iconPath: '/llm-icons/openai-comp.svg',
    id: 'openai-compatible',
    label: 'OpenAI Compatible',
    modelsPath: '/models',
    requiresApiKey: true,
    supportsApiMode: false,
    supportsBaseURL: true,
    supportsModelFetch: true,
  },
  {
    baseURLPresets: [
      { label: 'OpenAI', url: 'https://api.openai.com/v1', iconPath: '/llm-icons/openai.svg' },
    ],
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModelId: 'gpt-4.1-mini',
    desc: 'Official OpenAI provider. Supports Chat Completions and OpenAI Responses through the AI SDK OpenAI package.',
    docsUrl: 'https://ai-sdk.dev/providers/ai-sdk-providers/openai',
    iconPath: '/llm-icons/openai.svg',
    id: 'openai',
    label: 'OpenAI',
    modelsPath: '/models',
    requiresApiKey: true,
    supportsApiMode: true,
    supportsBaseURL: true,
    supportsModelFetch: true,
  },
  {
    baseURLPresets: [
      { label: 'Anthropic', url: 'https://api.anthropic.com/v1', iconPath: '/llm-icons/anthropic.svg' },
    ],
    defaultBaseURL: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-3-5-sonnet-latest',
    desc: 'Anthropic Claude provider through the official AI SDK Anthropic package.',
    docsUrl: 'https://ai-sdk.dev/providers/ai-sdk-providers/anthropic',
    iconPath: '/llm-icons/anthropic.svg',
    id: 'anthropic',
    label: 'Anthropic',
    modelsPath: '',
    requiresApiKey: true,
    supportsApiMode: false,
    supportsBaseURL: true,
    supportsModelFetch: false,
  },
  {
    baseURLPresets: [
      {
        label: 'Google',
        url: 'https://generativelanguage.googleapis.com/v1beta',
        iconPath: '/llm-icons/google.svg'
      },
    ],
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModelId: 'gemini-2.0-flash',
    desc: 'Google Generative AI provider for Gemini models.',
    docsUrl: 'https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai',
    iconPath: '/llm-icons/google.svg',
    id: 'google',
    label: 'Google Generative AI',
    modelsPath: '',
    requiresApiKey: true,
    supportsApiMode: false,
    supportsBaseURL: true,
    supportsModelFetch: false,
  },
  {
    baseURLPresets: [
      { label: 'Ollama Native', url: 'http://localhost:11434/api', iconPath: '/llm-icons/ollama.svg' },
    ],
    defaultBaseURL: 'http://localhost:11434/api',
    defaultModelId: 'llama3.2',
    desc: 'Local Ollama native API provider.',
    docsUrl: 'https://ai-sdk.dev/providers/community-providers/ollama',
    iconPath: '/llm-icons/ollama.svg',
    id: 'ollama',
    label: 'Ollama',
    modelsPath: '/tags',
    requiresApiKey: false,
    supportsApiMode: false,
    supportsBaseURL: true,
    supportsModelFetch: true,
  },
  {
    baseURLPresets: [
      // { label: 'OpenAI', url: 'https://api.openai.com/v1/responses' },
    ],
    defaultBaseURL: '',
    defaultModelId: '',
    desc: 'Open Responses provider. This is a Responses API POST endpoint only, not a Chat Completions provider.',
    docsUrl: 'https://ai-sdk.dev/providers/ai-sdk-providers/open-responses',
    iconPath: '/llm-icons/openresponses.svg',
    id: 'open-responses',
    label: 'Open Responses',
    modelsPath: '',
    requiresApiKey: true,
    supportsApiMode: false,
    supportsBaseURL: true,
    supportsModelFetch: false,
  },
] as const;

export type ModelProviderId = (typeof MODEL_PROVIDER_DEFINITIONS)[number]['id'];

export type ModelProviderDefinition = Extract<
  (typeof MODEL_PROVIDER_DEFINITIONS)[number],
  { id: ModelProviderId }
>;

export type ModelConfigItem = {
  apiKey: string;
  apiMode: ModelApiMode;
  at: number;
  baseURL: string;
  extraBody: Record<string, unknown>;
  headers: Record<string, string>;
  iconPath?: string;
  id: string;
  inputTokenPrice: number;
  maxInputTokens: number;
  modelId: string;
  /**
   * Model pool fetched from the provider's `/models` endpoint and kept on the
   * config so the model can be switched without re-fetching. `modelId` is the
   * entry currently in use; this list is only the set of choices. Empty for
   * configs that were never fetched (and for rows written by older versions).
   */
  modelIds: string[];
  name: string;
  outputTokenPrice: number;
  priceUnit: string;
  providerId: ModelProviderId;
};

export type ModelDraft = Omit<ModelConfigItem, 'at' | 'id'>;

export function getModelProviderDefinition(providerId: ModelProviderId) {
  return (
    MODEL_PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId) ??
    MODEL_PROVIDER_DEFINITIONS[0]
  );
}

export function isModelProviderId(value: unknown): value is ModelProviderId {
  return MODEL_PROVIDER_DEFINITIONS.some((provider) => provider.id === value);
}

export function isModelApiMode(value: unknown): value is ModelApiMode {
  return MODEL_API_MODES.includes(value as ModelApiMode);
}

export function createDefaultModelDraft(
  providerId: ModelProviderId = 'openai-compatible',
): ModelDraft {
  const provider = getModelProviderDefinition(providerId);

  return {
    apiKey: '',
    apiMode: provider.id === 'open-responses' ? 'responses' : 'chat',
    baseURL: provider.defaultBaseURL,
    extraBody: { ...(provider.defaultExtraBody ?? {}) },
    headers: {},
    iconPath: '',
    inputTokenPrice: 0,
    maxInputTokens: 0,
    modelId: provider.defaultModelId,
    modelIds: [],
    name: provider.label,
    outputTokenPrice: 0,
    priceUnit: '$',
    providerId,
  };
}

function stripTrailingSlashes(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

type ParsedPresetURL = { host: string; path: string };

function parsePresetURL(url: string): ParsedPresetURL | null {
  try {
    const parsed = new URL(url);
    // `URL#host` is already lower-cased; strip trailing slashes from the
    // path so `/v1` and `/v1/` compare equal.
    return { host: parsed.host, path: parsed.pathname.replace(/\/+$/, '') };
  } catch {
    return null;
  }
}

function pathIsSegmentPrefix(shorter: string[], longer: string[]): boolean {
  return shorter.length <= longer.length && shorter.every((seg, i) => seg === longer[i]);
}

/**
 * Match a (providerId, baseURL) pair to the vendor's base-URL preset, if any.
 * Grouping/icon lookups both funnel through this so a custom base URL that
 * merely differs in trailing slash, `/v1` suffix, or protocol/case still
 * resolves to the same vendor.
 *
 * Empty `baseURL` falls back to the provider's `defaultBaseURL`. Matching is
 * host-based (case-insensitive, protocol ignored): among presets sharing the
 * input's host, an exact path match wins; otherwise the preset whose path is
 * the longest shared path-segment prefix with the input wins; if exactly one
 * preset shares the host, it is returned regardless of path (same host means
 * same vendor); if several share the host but none prefix-relates, the first
 * one is returned. If the input URL fails to parse, falls back to a plain
 * trimmed/trailing-slash-stripped string comparison against each preset.
 */
export function findBaseURLPreset(
  providerId: ModelProviderId,
  baseURL: string | undefined,
): BaseURLPreset | undefined {
  const provider = getModelProviderDefinition(providerId);
  const presets = provider.baseURLPresets;
  if (!presets || presets.length === 0) return undefined;

  const input = baseURL || provider.defaultBaseURL;
  if (!input) return undefined;

  const inputParsed = parsePresetURL(input);
  if (!inputParsed) {
    const normalizedInput = stripTrailingSlashes(input);
    return presets.find((preset) => stripTrailingSlashes(preset.url) === normalizedInput);
  }

  const candidates = presets
    .map((preset) => ({ preset, parsed: parsePresetURL(preset.url) }))
    .filter(
      (candidate): candidate is { preset: BaseURLPreset; parsed: ParsedPresetURL } =>
        candidate.parsed !== null && candidate.parsed.host === inputParsed.host,
    );

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0].preset;

  const exact = candidates.find((candidate) => candidate.parsed.path === inputParsed.path);
  if (exact) return exact.preset;

  const inputSegments = inputParsed.path.split('/').filter(Boolean);
  let best: { preset: BaseURLPreset; sharedSegments: number } | null = null;
  for (const candidate of candidates) {
    const presetSegments = candidate.parsed.path.split('/').filter(Boolean);
    const isPrefix =
      pathIsSegmentPrefix(inputSegments, presetSegments) ||
      pathIsSegmentPrefix(presetSegments, inputSegments);
    if (!isPrefix) continue;
    const sharedSegments = Math.min(inputSegments.length, presetSegments.length);
    if (!best || sharedSegments > best.sharedSegments) {
      best = { preset: candidate.preset, sharedSegments };
    }
  }
  if (best) return best.preset;

  return candidates[0].preset;
}

/**
 * Human-facing vendor name for grouping models. The provider id alone is too
 * coarse ("OpenAI Compatible" covers DeepSeek, OpenRouter, DashScope ...), so
 * prefer the base-URL preset label, then the custom base URL's host, and only
 * then the provider label.
 */
export function getModelVendorLabel(model: Pick<ModelConfigItem, 'baseURL' | 'providerId'>): string {
  const provider = getModelProviderDefinition(model.providerId);
  const preset = findBaseURLPreset(model.providerId, model.baseURL);
  if (preset) return preset.label;

  const baseURL = stripTrailingSlashes(model.baseURL || provider.defaultBaseURL);
  if (baseURL) {
    try {
      return new URL(baseURL).host;
    } catch {
      // Not a parseable URL; fall back to the provider label.
    }
  }
  return provider.label;
}

/** Custom name plus the real model id, e.g. "快速总结（deepseek-chat）". */
export function getModelOptionLabel(model: Pick<ModelConfigItem, 'name' | 'modelId'>): string {
  const name = model.name.trim();
  const modelId = model.modelId.trim();
  if (!name) return modelId;
  if (!modelId || name === modelId) return name;
  return `${name}（${modelId}）`;
}

export function getModelDisplayIcon(model: Pick<ModelConfigItem, 'iconPath' | 'baseURL' | 'providerId'>): string {
  if (model.iconPath) {
    return model.iconPath;
  }

  const provider = getModelProviderDefinition(model.providerId);
  const preset = findBaseURLPreset(model.providerId, model.baseURL);

  if (preset?.iconPath) {
    return preset.iconPath;
  }

  return provider.iconPath;
}
