import { describe, expect, it } from 'vitest';
import { findFuzzyMatches, normalizeForMatch } from '@/lib/scroll-to-text';

// The DOM walk/scroll/highlight half of scroll-to-text needs a real browser;
// these cover the pure matching half, which decides whether a citation chip
// lands anywhere at all.
const locate = (page: string, quote: string) => {
  const hay = normalizeForMatch(page);
  const [match] = findFuzzyMatches(hay.text, normalizeForMatch(quote).text);
  if (!match) return null;
  return page.slice(hay.map[match.start], hay.map[match.end - 1] + 1);
};

describe('normalizeForMatch', () => {
  it('drops whitespace/punctuation, folds width and case, and maps back to source offsets', () => {
    const { text, map } = normalizeForMatch('Ａ b，“C”');
    expect(text).toBe('abc');
    expect(map).toEqual([0, 2, 5]);
  });

  it('keeps source offsets correct across astral characters', () => {
    const { text, map } = normalizeForMatch('😀x');
    expect(text).toBe('x');
    expect(map).toEqual([2]);
  });
});

describe('findFuzzyMatches', () => {
  it('matches despite full/half-width punctuation and whitespace differences', () => {
    const page = '根据报告，2025 年营收增长了 30%，主要来自海外市场。';
    expect(locate(page, '2025年营收增长了30%, 主要来自海外市场')).toBe(
      '2025 年营收增长了 30%，主要来自海外市场',
    );
  });

  it('matches across what were separate text nodes / line breaks', () => {
    expect(locate('The quick brown\n  fox jumps', 'quick brown fox')).toBe('quick brown\n  fox');
  });

  it('falls back to the longest shared fragment when the quote was lightly paraphrased', () => {
    const page = '本研究发现，长期睡眠不足会显著降低注意力和工作记忆能力。';
    expect(locate(page, '长期睡眠不足会显著降低人的注意力')).toBe('长期睡眠不足会显著降低');
  });

  it('refuses tiny Latin fragments that would land on an unrelated spot', () => {
    expect(locate('the cat sat on the mat and the dog barked', 'the zebra sat quietly nearby')).toBeNull();
  });

  it('returns every occurrence of the match in order', () => {
    const hay = normalizeForMatch('关键结论 abc 关键结论').text;
    expect(findFuzzyMatches(hay, normalizeForMatch('关键结论').text)).toHaveLength(2);
  });
});
