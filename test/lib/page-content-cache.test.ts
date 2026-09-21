import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebpageContent } from '@/lib/page-extraction';

// The cache puts an expensive extraction behind a cheap freshness check against
// the live page text (`document.body.innerText`). These tests pin the contract
// of that check: what counts as unchanged, and what must invalidate.
//
// `document` is injected rather than provided by jsdom: `readSignature` only
// ever reads `document.body.innerText`, and the project's vitest environment is
// plain Node.

const HREF = 'https://example.test/article';
const OTHER_HREF = 'https://example.test/other';

function setPageText(text: string) {
  (globalThis as { document?: unknown }).document = { body: { innerText: text } };
}

/** Fresh module instance per test, so the module-level cache starts empty. */
async function loadCache() {
  vi.resetModules();
  return await import('@/lib/page-content-cache');
}

function makeContent(textContent: string): WebpageContent {
  return {
    articleUrl: HREF,
    byline: '',
    content: '',
    dir: 'ltr',
    excerpt: '',
    extractMethod: 'readability',
    inputTextLength: textContent.length,
    lang: 'zh',
    length: textContent.length,
    publishedTime: '',
    siteName: 'example.test',
    textContent,
    title: '示例文章',
  };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe('getCachedPageContent', () => {
  it('returns nothing when the URL was never cached', async () => {
    setPageText('正文'.repeat(500));
    const cache = await loadCache();

    expect(cache.getCachedPageContent(HREF)).toBeNull();
  });

  it('hits while the page text is unchanged', async () => {
    setPageText('正文'.repeat(500));
    const cache = await loadCache();
    cache.cachePageContent(HREF, makeContent('提取到的正文'));

    expect(cache.getCachedPageContent(HREF)?.content.textContent).toBe('提取到的正文');
  });

  it('misses once the page text grows', async () => {
    setPageText('a'.repeat(1200));
    const cache = await loadCache();
    cache.cachePageContent(HREF, makeContent('stale'));

    setPageText('a'.repeat(1201));

    expect(cache.getCachedPageContent(HREF)).toBeNull();
  });

  it('misses when an equal-length page swaps text at the tail', async () => {
    setPageText('a'.repeat(2000) + 'tail-A');
    const cache = await loadCache();
    cache.cachePageContent(HREF, makeContent('stale'));

    setPageText('a'.repeat(2000) + 'tail-B');

    expect(cache.getCachedPageContent(HREF)).toBeNull();
  });

  it('misses when an equal-length page swaps text at the head', async () => {
    setPageText('head-A' + 'b'.repeat(2000));
    const cache = await loadCache();
    cache.cachePageContent(HREF, makeContent('stale'));

    setPageText('head-B' + 'b'.repeat(2000));

    expect(cache.getCachedPageContent(HREF)).toBeNull();
  });

  it('keeps one entry per URL instead of sharing content across URLs', async () => {
    setPageText('正文'.repeat(500));
    const cache = await loadCache();
    cache.cachePageContent(HREF, makeContent('first'));

    expect(cache.getCachedPageContent(OTHER_HREF)).toBeNull();
  });
});

describe('cachePageContentTokenCount', () => {
  it('attaches a token count to an existing entry and no-ops on a missing one', async () => {
    setPageText('正文'.repeat(500));
    const cache = await loadCache();
    cache.cachePageContent(HREF, makeContent('body'));
    cache.cachePageContentTokenCount(HREF, 42);

    expect(cache.getCachedPageContent(HREF)?.tokenCount).toBe(42);

    cache.cachePageContentTokenCount(OTHER_HREF, 7);
    expect(cache.getCachedPageContent(OTHER_HREF)).toBeNull();
  });
});

describe('cache eviction', () => {
  it('keeps only the most recent entries', async () => {
    setPageText('same text');
    const { cachePageContent, getCachedPageContent } = await loadCache();

    for (let i = 0; i < 25; i += 1) {
      cachePageContent(`${HREF}/${i}`, makeContent('same text'));
    }

    expect(getCachedPageContent(`${HREF}/0`)).toBeNull();
    expect(getCachedPageContent(`${HREF}/4`)).toBeNull();
    expect(getCachedPageContent(`${HREF}/5`)).not.toBeNull();
    expect(getCachedPageContent(`${HREF}/24`)).not.toBeNull();
  });
});
