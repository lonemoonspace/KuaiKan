import { describe, expect, it } from 'vitest';
import { cleanExtractedText } from '@/lib/page-extraction';

describe('cleanExtractedText', () => {
  it('strips carriage returns', () => {
    expect(cleanExtractedText('a\r\nb\r\n')).toBe('a\nb');
  });

  it('normalizes non-breaking spaces to regular spaces', () => {
    expect(cleanExtractedText('a b')).toBe('a b');
  });

  it('collapses runs of spaces/tabs into a single space', () => {
    expect(cleanExtractedText('a    b\t\tc')).toBe('a b c');
  });

  it('collapses a whitespace-only line between two blank-separated paragraphs', () => {
    expect(cleanExtractedText('a\n   \nb')).toBe('a\n\nb');
  });

  it('collapses 3+ consecutive newlines down to a single blank line', () => {
    expect(cleanExtractedText('a\n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('trims each line individually', () => {
    expect(cleanExtractedText('  a  \n  b  ')).toBe('a\nb');
  });

  it('trims leading/trailing whitespace from the whole result', () => {
    expect(cleanExtractedText('\n\n  hello  \n\n')).toBe('hello');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(cleanExtractedText('   \n\t\n   ')).toBe('');
  });

  it('is idempotent (running it twice gives the same result)', () => {
    const once = cleanExtractedText('a\r\n\r\n\r\n  b   c\n\n\n\nd');
    const twice = cleanExtractedText(once);
    expect(twice).toBe(once);
  });
});
