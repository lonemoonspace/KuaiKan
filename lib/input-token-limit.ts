import type { ModelConfigItem } from '@/constants/model-settings';

// Headroom kept for providers whose tokenizer differs from the bundled GPT one.
const NON_OPENAI_SAFETY_FACTOR = 0.9;

/**
 * The token budget page text is truncated to before it is sent to the model.
 * GPT tokenization is only exact for the first-party OpenAI endpoints; for
 * Anthropic, Gemini, Ollama, and the `openai-compatible` catch-all (OpenRouter,
 * llama.cpp, LM Studio, …) leave headroom so gpt-5 estimates do not push the
 * provider over its real context limit.
 *
 * Returns 0 when the model has no configured limit (no truncation).
 */
export function getEffectiveInputTokenLimit(
  model: Pick<ModelConfigItem, 'providerId' | 'maxInputTokens'>,
): number {
  if (!(model.maxInputTokens > 0)) return 0;

  // `openai-compatible` used to count as exact too, which handed the providers
  // with the *least* reliable counts (a local llama.cpp or an OpenRouter model
  // tokenizes nothing like gpt-5) zero headroom, while Anthropic/Gemini got
  // 10%. Only the endpoints that really use the bundled vocabulary keep 100%.
  const usesBundledTokenizer =
    model.providerId === 'openai' || model.providerId === 'open-responses';

  // Never round the headroom down to zero: callers read 0 as "no limit", which
  // would silently disable truncation for a model configured with a tiny budget.
  return usesBundledTokenizer
    ? model.maxInputTokens
    : Math.max(1, Math.floor(model.maxInputTokens * NON_OPENAI_SAFETY_FACTOR));
}
