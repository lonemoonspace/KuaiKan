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
  it('uses the full limit for OpenAI-like providers', () => {
    expect(getEffectiveInputTokenLimit(model('openai', 1000))).toBe(1000);
    expect(getEffectiveInputTokenLimit(model('openai-compatible', 1000))).toBe(1000);
    expect(getEffectiveInputTokenLimit(model('open-responses', 1000))).toBe(1000);
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
