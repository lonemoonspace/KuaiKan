// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  FLATTEN_CONTAINER_LIMIT,
  FLATTEN_DEPTH_LIMIT,
  FLATTENED_CONTAINER_ATTRIBUTE,
  flattenShadowAndIframeContent,
  MIN_EXTRACTED_TEXT_LENGTH,
  needsFlattenedRetry,
} from '@/lib/page-flatten';

function createDocument(html: string): Document {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function attachArticleShadow(host: Element, text: string): ShadowRoot {
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<article><p>${text}</p></article>`;
  return shadow;
}

const containerSelector = `[${FLATTENED_CONTAINER_ATTRIBUTE}]`;

describe('needsFlattenedRetry', () => {
  it('asks for a retry when the extraction found nothing', () => {
    expect(needsFlattenedRetry(undefined)).toBe(true);
    expect(needsFlattenedRetry(null)).toBe(true);
    expect(needsFlattenedRetry('')).toBe(true);
    expect(needsFlattenedRetry('   \n  ')).toBe(true);
  });

  it('asks for a retry below the minimum length', () => {
    expect(needsFlattenedRetry('a'.repeat(MIN_EXTRACTED_TEXT_LENGTH - 1))).toBe(true);
  });

  it('accepts an extraction at the minimum length', () => {
    expect(needsFlattenedRetry('a'.repeat(MIN_EXTRACTED_TEXT_LENGTH))).toBe(false);
  });

  it('ignores surrounding whitespace when measuring', () => {
    expect(needsFlattenedRetry(`  ${'a'.repeat(MIN_EXTRACTED_TEXT_LENGTH)}  `)).toBe(false);
  });
});

// Readability clones a document to parse it, but `cloneNode` never copies a
// shadow root (the DOM spec makes shadow roots unclonable), and the DOM
// heuristic only ever walks the light tree — so an article rendered by a web
// component extracted as nothing at all.
describe('flattenShadowAndIframeContent', () => {
  it('reports nothing to inline for a plain page', () => {
    expect(flattenShadowAndIframeContent(createDocument('<p>light text</p>'))).toBeUndefined();
  });

  it('inlines an open shadow root without touching the live page', () => {
    const document = createDocument('<div id="host"></div>');
    const host = document.querySelector('#host');
    attachArticleShadow(host!, 'shadow article text');

    const flattened = flattenShadowAndIframeContent(document);

    expect(flattened).toBeDefined();
    expect(flattened!.querySelector('#host')!.textContent).toContain('shadow article text');
    expect(flattened!.querySelector(containerSelector)).not.toBeNull();

    // The live page keeps its shadow root, and the wrapper only ever exists in
    // the clone (mutating the page would trip every MutationObserver on it).
    expect(host!.shadowRoot!.querySelector('article')).not.toBeNull();
    expect(host!.querySelector(containerSelector)).toBeNull();
  });

  it('inlines shadow roots nested inside shadow roots', () => {
    const document = createDocument('<div id="outer"></div>');
    const outerShadow = document.querySelector('#outer')!.attachShadow({ mode: 'open' });
    outerShadow.innerHTML = '<div id="inner"></div>';
    const innerShadow = outerShadow.querySelector('#inner')!.attachShadow({ mode: 'open' });
    innerShadow.innerHTML = '<p>deep shadow text</p>';

    const flattened = flattenShadowAndIframeContent(document);

    expect(flattened!.documentElement.textContent).toContain('deep shadow text');
  });

  it('inlines a same-origin iframe body', () => {
    const document = createDocument('<iframe id="frame"></iframe>');
    const frame = document.querySelector('#frame') as HTMLIFrameElement;
    frame.contentDocument!.body.innerHTML = '<article><p>framed article text</p></article>';

    const flattened = flattenShadowAndIframeContent(document);

    expect(flattened!.documentElement.textContent).toContain('framed article text');
  });

  it('skips an empty shadow root', () => {
    const document = createDocument('<div id="host"></div>');
    document.querySelector('#host')!.attachShadow({ mode: 'open' });

    expect(flattenShadowAndIframeContent(document)).toBeUndefined();
  });

  it('stops inlining once the container budget is exhausted', () => {
    const hosts = Array.from(
      { length: FLATTEN_CONTAINER_LIMIT + 5 },
      (_, index) => `<div class="host" data-index="${index}"></div>`,
    ).join('');
    const document = createDocument(hosts);
    document.querySelectorAll('.host').forEach((host, index) => {
      attachArticleShadow(host, `shadow text ${index}`);
    });

    const flattened = flattenShadowAndIframeContent(document);

    expect(flattened!.querySelectorAll(containerSelector)).toHaveLength(FLATTEN_CONTAINER_LIMIT);
  });

  it('stops descending past the depth limit', () => {
    const document = createDocument('<div id="level-0"></div>');
    let host: Element = document.querySelector('#level-0')!;
    const depth = FLATTEN_DEPTH_LIMIT + 2;

    for (let level = 1; level <= depth; level += 1) {
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<div id="level-${level}">深 ${level}</div>`;
      host = shadow.querySelector(`#level-${level}`)!;
    }

    const flattened = flattenShadowAndIframeContent(document);

    // Every level up to the limit is inlined; the ones past it are not.
    for (let level = 1; level <= FLATTEN_DEPTH_LIMIT + 1; level += 1) {
      expect(flattened!.documentElement.textContent).toContain(`深 ${level}`);
    }
    expect(flattened!.documentElement.textContent).not.toContain(`深 ${depth}`);
  });
});
