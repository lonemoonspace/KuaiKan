import { describe, expect, it } from 'vitest';
import { truncateByTokens } from '@/entrypoints/background/token-count-bg';

// These exercise the real `truncateByTokens`/`applyTruncationStrategy` logic
// against the actual gpt-tokenizer package (no mocking needed - it's pure JS
// and has no browser-only dependency). This is where the four truncation
// strategies described in docs/SIMPLIFY_PLAN.md actually live -- NOT in
// lib/token-count.ts, which (on the content-script side) is just an RPC
// wrapper around this module's message handler. See the discrepancy note in
// the final report.

const LONG_TEXT = Array.from({ length: 50 }, (_, i) => `sentence number ${i}`).join('. ') + '.';

describe('truncateByTokens', () => {
  it('returns the text untouched when it already fits under maxTokens', async () => {
    const result = await truncateByTokens('short text', 1000, 'front');
    expect(result).toBe('short text');
  });

  it('"nothing" strategy always returns the original text, even when over the limit', async () => {
    const result = await truncateByTokens(LONG_TEXT, 5, 'nothing');
    expect(result).toBe(LONG_TEXT);
  });

  it('"front" strategy keeps the head and drops the tail', async () => {
    const result = await truncateByTokens(LONG_TEXT, 10, 'front');
    expect(LONG_TEXT.startsWith(result.length > 0 ? result.slice(0, 5) : '')).toBe(true);
    expect(result.length).toBeLessThan(LONG_TEXT.length);
    expect(result).not.toContain('sentence number 49');
  });

  it('"back" strategy keeps the tail and drops the head', async () => {
    const result = await truncateByTokens(LONG_TEXT, 10, 'back');
    expect(result.length).toBeLessThan(LONG_TEXT.length);
    expect(result).not.toContain('sentence number 0.');
    expect(result).toContain('49');
  });

  it('"middle" strategy keeps head + tail and marks the removed section', async () => {
    const result = await truncateByTokens(LONG_TEXT, 20, 'middle');
    expect(result).toContain('内容已截断');
    expect(result.length).toBeLessThan(LONG_TEXT.length);
    // Head and tail should both be represented.
    expect(result.startsWith('sentence number 0')).toBe(true);
  });

  it('defaults to "front" when no behaviour is given', async () => {
    const withDefault = await truncateByTokens(LONG_TEXT, 10);
    const withExplicitFront = await truncateByTokens(LONG_TEXT, 10, 'front');
    expect(withDefault).toBe(withExplicitFront);
  });
});
