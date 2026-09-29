import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenResponses } from '@ai-sdk/open-responses';
import type { LanguageModel } from 'ai';
import {
  normalizeOllamaBaseURL,
  type ModelConfigItem,
} from '@/constants/model-settings';

type ProviderSettings = {
  apiKey?: string;
  baseURL?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  name?: string;
};

export function createLanguageModelFromConfig(
  config: ModelConfigItem,
): LanguageModel {
  const settings = createProviderSettings(config);

  switch (config.providerId) {
    case 'openai': {
      if (config.apiMode === 'responses') {
        return createOpenAI(settings).responses(config.modelId);
      }

      return createOpenAI(settings).chat(config.modelId);
    }
    case 'open-responses':
      return createOpenResponses({
        apiKey: config.apiKey || undefined,
        fetch: settings.fetch,
        headers: config.headers,
        name: config.name || 'open-responses',
        url: config.baseURL,
      })(config.modelId);
    case 'openai-compatible': {
      return createOpenAICompatible({
        ...settings,
        baseURL: config.baseURL,
        name: config.name || 'openai-compatible',
      })(config.modelId);
    }
    case 'anthropic':
      return createAnthropic(settings).languageModel(config.modelId);
    case 'google':
      return createGoogleGenerativeAI(settings).languageModel(config.modelId);
    case 'ollama':
      // Served by the OpenAI-compatible client: `ollama-ai-provider` still
      // declares specification version v1 and AI SDK 6 rejects those models at
      // runtime (`AI_UnsupportedModelVersionError`), so the typed cast it used
      // to rely on could never work. Ollama ignores the API key, but the client
      // wants a non-empty one, hence the placeholder.
      return createOpenAICompatible({
        ...settings,
        apiKey: config.apiKey || 'ollama',
        baseURL: normalizeOllamaBaseURL(config.baseURL),
        name: config.name || 'ollama',
      })(config.modelId);
    default:
      throw new Error('Unsupported provider.');
  }
}

function createProviderSettings(config: ModelConfigItem): ProviderSettings {
  return {
    apiKey: config.apiKey || undefined,
    baseURL: config.baseURL || undefined,
    fetch: createFetchWithExtraBody(config),
    headers: config.headers,
    name: config.providerId,
  };
}

/**
 * Config-derived body overrides: the user's own extraBody, merged into every
 * request body. Whatever is written there reaches the provider verbatim
 * (e.g. `{"thinking": {"type": "disabled"}}` to turn a reasoning model's
 * chain-of-thought off).
 */
export function buildBodyOverrides(
  config: Pick<ModelConfigItem, 'extraBody'>,
): Record<string, unknown> {
  return { ...config.extraBody };
}

function createFetchWithExtraBody(
  config: Pick<ModelConfigItem, 'extraBody'>,
) {
  const overrides = buildBodyOverrides(config);

  if (Object.keys(overrides).length === 0) {
    return undefined;
  }

  return (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;

    // Only JSON string bodies are inspected. The AI SDK serializes request
    // bodies to strings, so anything else (Blob / ArrayBuffer / FormData /
    // ReadableStream) passes through untouched and the extraBody overrides are
    // intentionally not merged into it.
    if (typeof body !== 'string') {
      return fetch(input, init);
    }

    try {
      const parsedBody = JSON.parse(body) as unknown;

      if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
        return fetch(input, init);
      }

      return fetch(input, {
        ...init,
        body: JSON.stringify({
          ...parsedBody,
          ...overrides,
        }),
      });
    } catch {
      return fetch(input, init);
    }
  };
}
