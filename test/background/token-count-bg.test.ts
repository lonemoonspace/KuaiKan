import { describe, expect, it } from 'vitest';
import {
  MAX_TOKEN_PIECES,
  MIDDLE_TRUNCATION_MARKER,
  INPUT_TOKEN_COUNT_MODEL,
  countInputTokens,
  countInputTokensWithTiming,
  splitTokensWithTiming,
  truncateByTokens,
  truncateByTokensWithTiming,
} from '@/entrypoints/background/token-count-bg';

// These exercise the real `truncateByTokens`/`applyTruncationStrategy` logic
// against the actual gpt-tokenizer package (no mocking needed - it's pure JS
// and has no browser-only dependency). This is where the truncation
// strategies (front/back/middle/nothing) actually live -- NOT in
// lib/token-count.ts, which (on the content-script side) is just an RPC
// wrapper around this module's message handler.

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

  // A negative budget used to reach `tokens.slice(0, maxTokens)`, which keeps
  // everything *except* the last few tokens -- the opposite of truncating --
  // and a fractional budget produced a fractional slice index.
  it('returns empty text for a negative budget instead of keeping everything but the tail', async () => {
    await expect(truncateByTokens(LONG_TEXT, -3, 'front')).resolves.toBe('');
    await expect(truncateByTokens(LONG_TEXT, -3, 'back')).resolves.toBe('');
    await expect(truncateByTokens(LONG_TEXT, -3, 'middle')).resolves.toBe('');
  });

  it('returns empty text for a zero budget rather than the middle marker alone', async () => {
    await expect(truncateByTokens(LONG_TEXT, 0, 'middle')).resolves.toBe('');
    await expect(truncateByTokens(LONG_TEXT, Number.NaN, 'front')).resolves.toBe('');
  });

  it('floors a fractional budget instead of slicing on a fraction', async () => {
    const fractional = await truncateByTokens(LONG_TEXT, 10.9, 'front');
    const floored = await truncateByTokens(LONG_TEXT, 10, 'front');
    expect(fractional).toBe(floored);
  });

  // The marker costs ~12 tokens. A budget below that used to be clamped to
  // zero and then ignored, so the bare marker was returned -- a "truncated"
  // result *longer* than the budget it was supposed to fit into. Returning ''
  // instead sent the prompt with no page text at all; the head is kept.
  it('"middle" keeps the head when only the marker would fit', async () => {
    const { countTokens } = await import('gpt-tokenizer/model/gpt-5');
    const markerTokens = countTokens(MIDDLE_TRUNCATION_MARKER);

    for (const budget of [1, Math.floor(markerTokens / 2), markerTokens]) {
      const [middle, front] = await Promise.all([
        truncateByTokens(LONG_TEXT, budget, 'middle'),
        truncateByTokens(LONG_TEXT, budget, 'front'),
      ]);
      expect(middle).toBe(front);
      expect(middle.length).toBeGreaterThan(0);
      expect(countTokens(middle)).toBeLessThanOrEqual(budget);
    }

    // A budget that can hold the marker plus real content still truncates.
    const result = await truncateByTokens(LONG_TEXT, markerTokens + 20, 'middle');
    expect(result).toContain(MIDDLE_TRUNCATION_MARKER.trim());
  });
});

// The token viewer renders one span per piece and ships the whole array over
// the RPC channel, so an uncapped 100k-token article meant a 100k-element
// message plus 100k React nodes in a single commit. The window is capped, but
// the footer/slider still need the real total.
describe('splitTokensWithTiming', () => {
  it('caps the returned pieces while still reporting the real token count', async () => {
    const longText = 'word '.repeat(MAX_TOKEN_PIECES + 100);
    const result = await splitTokensWithTiming(longText);

    expect(result.pieces).toHaveLength(MAX_TOKEN_PIECES);
    expect(result.totalTokenCount).toBeGreaterThan(MAX_TOKEN_PIECES);
    expect(result.pieces[0]).toEqual({
      id: expect.any(Number),
      text: expect.any(String),
    });
  });

  it('returns every piece when the input fits in the window', async () => {
    const result = await splitTokensWithTiming('hello world');

    expect(result.totalTokenCount).toBeGreaterThan(0);
    expect(result.pieces).toHaveLength(result.totalTokenCount);
  });

  it('reports what the middle-truncation marker costs, so the viewer can mirror it', async () => {
    const [short, long] = await Promise.all([
      splitTokensWithTiming('hello world'),
      splitTokensWithTiming('word '.repeat(500)),
    ]);

    // The marker is a fixed string measured on its own, so its cost is a small
    // positive constant -- not something the content script can guess for
    // itself, and not proportional to the input.
    expect(short.middleMarkerTokenCount).toBeGreaterThan(0);
    expect(short.middleMarkerTokenCount).toBe(long.middleMarkerTokenCount);
  });
});

describe('countInputTokensWithTiming', () => {
  it('reports the model, the token count and finite timings', async () => {
    const result = await countInputTokensWithTiming('hello world');

    expect(result.model).toBe(INPUT_TOKEN_COUNT_MODEL);
    expect(result.tokenCount).toBe(await countInputTokens('hello world'));
    expect(Number.isFinite(result.timing.loadMs)).toBe(true);
    expect(Number.isFinite(result.timing.calculateMs)).toBe(true);
    expect(result.timing.loadMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.calculateMs).toBeGreaterThanOrEqual(0);
  });
});

// `truncateByTokensWithTiming` is the RPC the content script actually calls
// (lib/token-count.ts); the plain `truncateByTokens` above is the older entry
// used by the background-side callers. They share `applyTruncationStrategy`,
// and this suite pins that they stay in step.
describe('truncateByTokensWithTiming', () => {
  it('agrees with truncateByTokens on text and token counts', async () => {
    for (const behaviour of ['front', 'back', 'middle', 'nothing'] as const) {
      const [timed, plain] = await Promise.all([
        truncateByTokensWithTiming(LONG_TEXT, 20, behaviour),
        truncateByTokens(LONG_TEXT, 20, behaviour),
      ]);

      expect(timed.truncatedText).toBe(plain);
      expect(timed.model).toBe(INPUT_TOKEN_COUNT_MODEL);
      expect(timed.originalTokenCount).toBeGreaterThan(20);
      if (behaviour === 'nothing') {
        // The whole text was deliberately kept, so the "after" count describes
        // the whole text rather than the budget that was ignored.
        expect(timed.truncatedTokenCount).toBe(timed.originalTokenCount);
      } else {
        expect(timed.truncatedTokenCount).toBeLessThanOrEqual(20);
      }
      expect(Number.isFinite(timed.timing.calculateMs)).toBe(true);
      expect(Number.isFinite(timed.timing.loadMs)).toBe(true);
    }
  });

  it('leaves the text and the reported count untouched for the "nothing" strategy', async () => {
    const result = await truncateByTokensWithTiming(LONG_TEXT, 5, 'nothing');

    expect(result.truncatedText).toBe(LONG_TEXT);
    // Nothing was cut, so the "after" count must still describe the whole text
    // rather than the budget that was deliberately ignored.
    expect(result.truncatedTokenCount).toBe(result.originalTokenCount);
  });
});
