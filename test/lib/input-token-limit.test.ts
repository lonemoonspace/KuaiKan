import { describe, expect, it } from 'vitest';
import { getEffectiveInputTokenLimit } from '@/lib/input-token-limit';
import type { ModelProviderId } from '@/constants/model-settings';

/**
 * The parameter is `Pick<ModelConfigItem, 'providerId' | 'maxInputTokens'>`.
 * Building the object explicitly (instead of `as never`) keeps the field names
 * checked: a rename in the config type would fail here rather than silently
 * pass a test that no longer exercises anything.
 */
function model(providerId: ModelProviderId, maxInputTokens: number) {
  return { providerId, maxInputTokens };
}

describe('getEffectiveInputTokenLimit', () => {
  it('uses the full limit for the providers that share the bundled tokenizer', () => {
    expect(getEffectiveInputTokenLimit(model('openai', 1000))).toBe(1000);
    expect(getEffectiveInputTokenLimit(model('open-responses', 1000))).toBe(1000);
  });

  // `openai-compatible` is a protocol, not a tokenizer: the bucket holds
  // OpenRouter, llama.cpp, LM Studio and Ollama-through-the-compatible-client,
  // none of which tokenize like the bundled gpt-5 vocabulary. It used to get
  // zero headroom — the exact opposite of what those providers need.
  it('leaves 10% headroom for openai-compatible endpoints', () => {
    expect(getEffectiveInputTokenLimit(model('openai-compatible', 1000))).toBe(900);
  });

  it('leaves 10% headroom for other providers', () => {
    expect(getEffectiveInputTokenLimit(model('anthropic', 1000))).toBe(900);
  });

  it('returns 0 when no limit is configured', () => {
    expect(getEffectiveInputTokenLimit(model('openai', 0))).toBe(0);
  });

  it('never rounds the headroom down to "no limit"', () => {
    // 0 means "unlimited" to every caller, so a tiny configured budget must not
    // collapse into it.
    expect(getEffectiveInputTokenLimit(model('anthropic', 1))).toBe(1);
    expect(getEffectiveInputTokenLimit(model('google', 5))).toBe(4);
  });
});
