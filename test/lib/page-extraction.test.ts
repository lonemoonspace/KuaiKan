// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  cleanExtractedText,
  domHeuristicParseRead,
  parsePageContent,
  pickExtraction,
  pickExtractionLazily,
  type WebpageContent,
} from '@/lib/page-extraction';

function extraction(textContent: string): WebpageContent {
  return {
    articleUrl: 'https://example.com',
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

// `pickExtraction(primary(doc), fallback(doc))` evaluated BOTH extractors on
// every call, so a usable Readability result still paid for the whole
// DOM-heuristic walk (and vice versa). The fallback must only be *called* when
// the primary came back without text.
describe('pickExtractionLazily', () => {
  it('never runs the fallback when the primary has text', () => {
    const primary = extraction('article text');
    const fallback = vi.fn(() => extraction('other'));

    expect(pickExtractionLazily(() => primary, fallback)).toBe(primary);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('runs the fallback when the primary came back empty', () => {
    const fallback = extraction('fallback text');

    expect(pickExtractionLazily(() => extraction(''), () => fallback)).toBe(fallback);
  });

  it('runs the fallback when the primary found nothing at all', () => {
    const fallback = extraction('fallback text');

    expect(pickExtractionLazily(() => undefined, () => fallback)).toBe(fallback);
  });

  it('reports nothing when neither strategy has text', () => {
    expect(
      pickExtractionLazily(
        () => extraction(''),
        () => undefined,
      ),
    ).toBeUndefined();
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

function createPageDocument(html: string): Document {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    url: 'https://example.com/article',
  }).window.document;
}

function articleHtml(marker: string, paragraphs = 6): string {
  return Array.from(
    { length: paragraphs },
    (_, index) => `<p>${marker} 段落 ${index}：${'正文内容。'.repeat(20)}</p>`,
  ).join('');
}

describe('domHeuristicParseRead', () => {
  // The winning candidate used to keep every descendant of its subtree, so the
  // page's navigation and footer were appended to `{{textContent}}` even though
  // those elements are what disqualifies a candidate in the first place.
  it('keeps the article and drops navigation/footer text', () => {
    const document = createPageDocument(`
      <nav><a href="/a">导航链接一</a><a href="/b">导航链接二</a></nav>
      <article><h1>标题</h1>${articleHtml('正文')}</article>
      <footer>版权所有 2026</footer>
    `);

    const content = domHeuristicParseRead(document);

    expect(content?.textContent).toContain('正文 段落 0');
    expect(content?.textContent).not.toContain('导航链接一');
    expect(content?.textContent).not.toContain('版权所有');
  });

  it('drops content that is hidden from the reader', () => {
    const document = createPageDocument(`
      <article><h1>标题</h1>${articleHtml('正文')}
        <div style="display: none">隐藏的推荐位文案</div>
      </article>
    `);

    const content = domHeuristicParseRead(document);

    expect(content?.textContent).toContain('正文 段落 0');
    expect(content?.textContent).not.toContain('隐藏的推荐位文案');
  });

  it('reports nothing for a page without text', () => {
    expect(domHeuristicParseRead(createPageDocument('<div id="app"></div>'))).toBeUndefined();
  });

  // jsdom has no `checkVisibility`. Chrome's answers "is there a rendered
  // box", which is false for `display: contents` and for every element of a
  // document without a browsing context (the flattened clone).
  describe('with a Chrome-like checkVisibility', () => {
    function stubCheckVisibility(document: Document) {
      const view = document.defaultView!;
      const proto = view.Element.prototype as Element & {
        checkVisibility?: () => boolean;
      };
      proto.checkVisibility = function checkVisibility(this: Element) {
        const ownView = this.ownerDocument.defaultView;
        if (!ownView) return false;
        for (let node: Element | null = this; node; node = node.parentElement) {
          if (ownView.getComputedStyle(node).display === 'none') return false;
        }
        return ownView.getComputedStyle(this).display !== 'contents';
      };
    }

    it('keeps an article wrapped in a display: contents element', () => {
      const document = createPageDocument(`
        <article><h1>标题</h1><div style="display: contents">${articleHtml('包裹正文')}</div>
          <div style="display: none">隐藏的推荐位文案</div>
        </article>
      `);
      stubCheckVisibility(document);

      const content = domHeuristicParseRead(document);

      expect(content?.textContent).toContain('包裹正文 段落 0');
      expect(content?.textContent).not.toContain('隐藏的推荐位文案');
    });

    it('still reads a document that has no browsing context', () => {
      const document = createPageDocument(`<article><h1>标题</h1>${articleHtml('克隆正文')}</article>`);
      stubCheckVisibility(document);
      const detached = document.cloneNode(true) as Document;
      expect(detached.defaultView).toBeNull();

      const content = domHeuristicParseRead(detached);

      expect(content?.textContent).toContain('克隆正文 段落 0');
    });
  });
});

describe('parsePageContent', () => {
  // Neither strategy can see into a shadow root (cloneNode never copies one),
  // so a web-component article used to extract as "没有内容".
  it('finds an article rendered inside an open shadow root', () => {
    const document = createPageDocument('<div id="app"></div>');
    const shadow = document.querySelector('#app')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<article><h1>影子标题</h1>${articleHtml('影子正文')}</article>`;

    const content = parsePageContent('dom-heuristic', document);

    expect(content?.textContent).toContain('影子正文 段落 0');
  });

  it('finds an article inside a same-origin iframe', () => {
    const document = createPageDocument('<iframe id="frame"></iframe>');
    const frame = document.querySelector('#frame') as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML = `<article><h1>内嵌标题</h1>${articleHtml('内嵌正文')}</article>`;

    const content = parsePageContent('readability', document);

    expect(content?.textContent).toContain('内嵌正文 段落 0');
    // The flattened clone has no browsing context, so its own `location` is
    // null and the extractor falls back to the global one — which, in the
    // content script, is the real page's URL.
    expect(content?.articleUrl).toBe(window.location.href);
  });
});
