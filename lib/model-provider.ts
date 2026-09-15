import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenResponses } from '@ai-sdk/open-responses';
import { createOllama } from 'ollama-ai-provider';
import type { LanguageModel } from 'ai';
import { supportsReasoningEffort, type ModelConfigItem } from '@/constants/model-settings';

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
      return createOllama(settings).languageModel(config.modelId) as unknown as LanguageModel;
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
 * Config-derived body overrides: the reasoning effort param (if the provider
 * supports it and a non-default effort is configured) plus the user's own
 * extraBody. extraBody is spread last so a same-named key the user wrote by
 * hand always wins over the effort param this feature injects.
 */
export function buildBodyOverrides(
  config: Pick<ModelConfigItem, 'apiMode' | 'extraBody' | 'providerId' | 'reasoningEffort'>,
): Record<string, unknown> {
  const usesResponsesShape =
    config.providerId === 'open-responses' ||
    (config.providerId === 'openai' && config.apiMode === 'responses');

  const effortBody: Record<string, unknown> =
    config.reasoningEffort === '' || !supportsReasoningEffort(config.providerId)
      ? {}
      : usesResponsesShape
        ? { reasoning: { effort: config.reasoningEffort } }
        : { reasoning_effort: config.reasoningEffort };

  return { ...effortBody, ...config.extraBody };
}

function createFetchWithExtraBody(
  config: Pick<ModelConfigItem, 'apiMode' | 'extraBody' | 'providerId' | 'reasoningEffort'>,
) {
  const overrides = buildBodyOverrides(config);

  if (Object.keys(overrides).length === 0) {
    return undefined;
  }

  return (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;

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
