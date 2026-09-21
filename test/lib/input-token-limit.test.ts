import { describe, expect, it } from 'vitest';
import { getEffectiveInputTokenLimit } from '@/lib/input-token-limit';

describe('getEffectiveInputTokenLimit', () => {
  it('uses the full limit for OpenAI-like providers', () => {
    expect(getEffectiveInputTokenLimit({ providerId: 'openai', maxInputTokens: 1000 } as never)).toBe(1000);
    expect(getEffectiveInputTokenLimit({ providerId: 'openai-compatible', maxInputTokens: 1000 } as never)).toBe(1000);
  });

  it('leaves 10% headroom for other providers', () => {
    expect(getEffectiveInputTokenLimit({ providerId: 'anthropic', maxInputTokens: 1000 } as never)).toBe(900);
  });

  it('returns 0 when no limit is configured', () => {
    expect(getEffectiveInputTokenLimit({ providerId: 'openai', maxInputTokens: 0 } as never)).toBe(0);
  });
});
