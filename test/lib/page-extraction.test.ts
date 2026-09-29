import { describe, expect, it } from 'vitest';
import {
  cleanExtractedText,
  pickExtraction,
  type WebpageContent,
} from '@/lib/page-extraction';

function extraction(textContent: string): WebpageContent {
  return {
    articleUrl: 'https://example.com',
    byline: '',
    content: '',
    dir: '',
    excerpt: '',
    extractMethod: 'dom-heuristic',
    inputTextLength: textContent.length,
    lang: '',
    length: textContent.length,
    publishedTime: '',
    siteName: 'example.com',
    textContent,
    title: 't',
  };
}

// The dom-heuristic strategy used to return an empty `WebpageContent` when it
// found no text. Callers treat a truthy result as "the page was extracted", so
// that empty object got cached and sent to the model as an empty article.
describe('pickExtraction', () => {
  it('reports nothing when both strategies came back empty', () => {
    expect(pickExtraction(extraction(''), extraction(''))).toBeUndefined();
  });

  it('reports nothing when both strategies found no content at all', () => {
    expect(pickExtraction(undefined, undefined)).toBeUndefined();
  });

  it('prefers the primary result when it has text', () => {
    const primary = extraction('article text');

    expect(pickExtraction(primary, extraction('other'))).toBe(primary);
  });

  it('falls back to the other strategy when the primary is empty', () => {
    const fallback = extraction('fallback text');

    expect(pickExtraction(extraction(''), fallback)).toBe(fallback);
  });
});

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
