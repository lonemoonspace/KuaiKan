import type { ModelConfigItem } from '@/constants/model-settings';

// Headroom kept for providers whose tokenizer differs from the bundled GPT one.
const NON_OPENAI_SAFETY_FACTOR = 0.9;

/**
 * The token budget page text is truncated to before it is sent to the model.
 * GPT tokenization is only exact for OpenAI-compatible providers; for
 * Anthropic, Gemini, Ollama, etc. leave headroom so gpt-5 estimates do not
 * push the provider over its real context limit.
 *
 * Returns 0 when the model has no configured limit (no truncation).
 */
export function getEffectiveInputTokenLimit(
  model: Pick<ModelConfigItem, 'providerId' | 'maxInputTokens'>,
): number {
  if (!(model.maxInputTokens > 0)) return 0;

  const isOpenAiLike =
    model.providerId === 'openai' ||
    model.providerId === 'open-responses' ||
    model.providerId === 'openai-compatible';

  return isOpenAiLike
    ? model.maxInputTokens
    : Math.floor(model.maxInputTokens * NON_OPENAI_SAFETY_FACTOR);
}
