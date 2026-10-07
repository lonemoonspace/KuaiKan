import { Readability } from '@mozilla/readability';
import type { PageTextExtractMethod } from '@/constants/page-extraction';
import { flattenShadowAndIframeContent, needsFlattenedRetry } from '@/lib/page-flatten';

export {
  PAGE_TEXT_EXTRACT_METHODS,
  isPageTextExtractMethod,
} from '@/constants/page-extraction';
export type { PageTextExtractMethod } from '@/constants/page-extraction';

/**
 * What the panel actually needs from an extraction. Readability's other outputs
 * (`content` — the article as HTML, `excerpt`, `byline`, `siteName`, `length`,
 * `readabilityTextLength`, …) had no reader: `content` in particular duplicated
 * the article inside every cache entry, doubling what a long SPA session holds.
 * Anything the panel shows has to be listed here.
 */
export type WebpageContent = {
  articleUrl: string;
  textContent: string;
  title: string;
};

const CONTENT_HINT_RE =
  /article|content|entry|main|markdown|post|prose|readme|doc|documentation|story|text|body/i;
const NOISE_HINT_RE =
  /comment|footer|header|menu|nav|related|share|sidebar|subscribe|toolbar|breadcrumb|toc|search|banner|cookie/i;
const SEMANTIC_CANDIDATE_SELECTOR = [
  'article',
  'main',
  '[role="main"]',
  '[itemprop="articleBody"]',
  '[data-testid*="article"]',
  '[data-testid*="content"]',
  '[class*="article"]',
  '[class*="content"]',
  '[class*="markdown"]',
  '[class*="prose"]',
  '[class*="documentation"]',
  '[id*="article"]',
  '[id*="content"]',
  '[id*="main"]',
].join(', ');
const NOISE_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'header',
  'footer',
  'nav',
  'form',
  'dialog',
  'button',
  '[role="navigation"]',
  '[aria-hidden="true"]',
  '[hidden]',
  '.sr-only',
  '.visually-hidden',
].join(', ');
const CANDIDATE_TAGS = new Set(['ARTICLE', 'MAIN', 'SECTION', 'DIV']);

// Block boundaries used to rebuild paragraph breaks when the winner's text is
// read without `innerText` (see `getWinnerText`).
const BLOCK_SEPARATOR_SELECTOR = [
  'p',
  'div',
  'section',
  'article',
  'li',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'pre',
  'blockquote',
  'tr',
  'dd',
  'dt',
  'figcaption',
].join(', ');

type CandidateMetrics = {
  bodyShare: number;
  calloutCount: number;
  headingCount: number;
  headingToParagraphRatio: number;
  hintText: string;
  interactiveCount: number;
  isSemanticRoot: boolean;
  linkTextLength: number;
  listItemCount: number;
  paragraphCount: number;
  textLength: number;
};

export function cleanExtractedText(input: string) {
  return input
    .replaceAll('\r', '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n[ \t]+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function getBaseMetadata(sourceDocument: Document) {
  return {
    articleUrl: sourceDocument.location?.href ?? location.href,
    title: sourceDocument.title || '',
  };
}

function toWebpageContent(
  sourceDocument: Document,
  textContent: string,
  overrides: Partial<WebpageContent> = {},
): WebpageContent {
  const normalizedText = cleanExtractedText(textContent);

  return {
    ...getBaseMetadata(sourceDocument),
    textContent: normalizedText,
    ...overrides,
  };
}

function getReadabilityArticle(sourceDocument: Document) {
  const documentClone = sourceDocument.cloneNode(true);
  return new Readability(documentClone as Document).parse();
}

// Set only for the duration of a single domHeuristicParseRead() call: within
// that call the same element's innerText is read repeatedly (candidacy
// check, metrics, link text), and innerText forces a layout reflow, so we
// cache per element for that call and drop the cache afterwards.
let textCache: WeakMap<Element, string> | null = null;

function getElementText(element: Element) {
  const cached = textCache?.get(element);
  if (cached !== undefined) return cached;
  const rawText = (element as HTMLElement).innerText || element.textContent || '';
  const cleaned = cleanExtractedText(rawText);
  textCache?.set(element, cleaned);
  return cleaned;
}

function isNoiseElement(element: HTMLElement) {
  if (element.matches(NOISE_SELECTOR)) {
    return true;
  }

  const hintText = `${element.id} ${element.className}`;
  return NOISE_HINT_RE.test(hintText) && !CONTENT_HINT_RE.test(hintText);
}

type VisibilityCheckable = Element & {
  checkVisibility?: (options?: {
    checkOpacity?: boolean;
    checkVisibilityCSS?: boolean;
  }) => boolean;
};

function isInvisibleElement(element: Element): boolean {
  const checkable = element as VisibilityCheckable;
  // `checkVisibility()` answers "does this element have a rendered box", which
  // is false for two kinds of element that are perfectly readable:
  //   - documents without a browsing context (the flattened clone from
  //     lib/page-flatten.ts) never lay anything out, so *every* element there
  //     would count as hidden and the winner's text would come back empty;
  //   - `display: contents` wrappers have no box of their own by definition,
  //     and dropping one removed its whole (visible) subtree.
  // Both fall through to the inline checks; the children of a `contents`
  // wrapper are still tested one by one.
  const view = element.ownerDocument.defaultView;

  if (view && typeof checkable.checkVisibility === 'function') {
    try {
      if (checkable.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) {
        return false;
      }
      return view.getComputedStyle(element).display !== 'contents';
    } catch {
      // Older engines: fall back to the inline checks below.
    }
  }

  const htmlElement = element as HTMLElement;
  return Boolean(
    htmlElement.hidden ||
      htmlElement.style.display === 'none' ||
      htmlElement.style.visibility === 'hidden',
  );
}

/**
 * The winning candidate's text, with the elements that were only ever used to
 * *disqualify* a candidate removed for real.
 *
 * `NOISE_SELECTOR` pruning in `collectCandidateElements` decides which elements
 * may win; it never stripped header/footer/nav/button/form text out of the
 * winning subtree, so a page's navigation and cookie-banner copy was appended
 * to `{{textContent}}`. Cloning the winner (and skipping its invisible
 * children) keeps the paragraph breaks `textContentToHtml` relies on without
 * mutating the live page — which would invalidate every MutationObserver on it,
 * including this extension's own text index.
 */
function getWinnerText(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;

  // Live and clone trees have the same document order until something is
  // removed, so pairing the two NodeLists by index identifies each counterpart.
  const liveNodes = Array.from(element.querySelectorAll('*'));
  const cloneNodes = Array.from(clone.querySelectorAll('*'));
  const removable: Element[] = [];

  liveNodes.forEach((liveNode, nodeIndex) => {
    const cloneNode = cloneNodes[nodeIndex];
    if (!cloneNode) return;
    if (cloneNode.matches(NOISE_SELECTOR) || isInvisibleElement(liveNode)) {
      removable.push(cloneNode);
    }
  });

  removable.forEach((node) => node.remove());
  clone.querySelectorAll(BLOCK_SEPARATOR_SELECTOR).forEach((node) => node.after('\n'));

  return cleanExtractedText(clone.textContent ?? '');
}

function isCandidateElement(element: HTMLElement) {
  if (isNoiseElement(element) || element.childElementCount === 0) {
    return false;
  }

  // Candidacy is tested for every visited DIV/SECTION/ARTICLE/MAIN, and the
  // walker re-tests each ancestor level, so this runs O(depth) times over the
  // whole page. `getElementText` cleans the subtree text with five global regex
  // passes (and used to force a reflow through `innerText`), while a raw length
  // already answers "is there enough text here to be worth scoring" — the
  // cleaned length is still what the scorer and the winner use.
  const textLength = (element.textContent ?? '').length;
  if (textLength < 280) {
    return false;
  }

  const blockCount = element.querySelectorAll(
    'p, li, pre, blockquote',
  ).length;
  return blockCount >= 2 || textLength >= 700;
}

function collectCandidateElements(sourceDocument: Document) {
  const body = sourceDocument.body;
  if (!body) {
    return [] as HTMLElement[];
  }

  const candidates = new Set<HTMLElement>();

  sourceDocument
    .querySelectorAll<HTMLElement>(SEMANTIC_CANDIDATE_SELECTOR)
    .forEach((element) => {
      if (isCandidateElement(element)) {
        candidates.add(element);
      }
    });

  const walker = sourceDocument.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (!(node instanceof HTMLElement)) {
        return NodeFilter.FILTER_SKIP;
      }
      if (isNoiseElement(node)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!CANDIDATE_TAGS.has(node.tagName)) {
        return NodeFilter.FILTER_SKIP;
      }
      return isCandidateElement(node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });

  while (walker.nextNode()) {
    candidates.add(walker.currentNode as HTMLElement);
  }

  return Array.from(candidates);
}

function getCandidateMetrics(
  element: HTMLElement,
  bodyTextLength: number,
): CandidateMetrics {
  const textLength = getElementText(element).length;
  const paragraphCount = element.querySelectorAll('p').length;
  const listItemCount = element.querySelectorAll('li').length;
  const headingCount = element.querySelectorAll(
    'h1, h2, h3, h4, h5, h6',
  ).length;
  const calloutCount = element.querySelectorAll(
    'aside, blockquote, [role="note"], [data-callout], [class*="callout"], [class*="notice"], [class*="important"]',
  ).length;
  const linkTextLength = Array.from(element.querySelectorAll('a')).reduce(
    (total, link) => total + getElementText(link).length,
    0,
  );
  const interactiveCount = element.querySelectorAll(
    'button, input, select, textarea, [role="button"]',
  ).length;
  const hintText = `${element.id} ${element.className}`;
  const bodyShare = bodyTextLength > 0 ? textLength / bodyTextLength : 0;

  return {
    bodyShare,
    calloutCount,
    headingCount,
    headingToParagraphRatio: headingCount / Math.max(paragraphCount, 1),
    hintText,
    interactiveCount,
    isSemanticRoot: element.matches(
      'article, main, [role="main"], [itemprop="articleBody"]',
    ),
    linkTextLength,
    listItemCount,
    paragraphCount,
    textLength,
  };
}

function isHeadingHeavyComposite(metrics: CandidateMetrics) {
  return (
    metrics.paragraphCount >= 5 &&
    metrics.headingCount >= 4 &&
    metrics.headingToParagraphRatio > 0.4
  );
}

function scoreCandidate(element: HTMLElement, bodyTextLength: number) {
  const metrics = getCandidateMetrics(element, bodyTextLength);
  const {
    bodyShare,
    calloutCount,
    headingCount,
    hintText,
    interactiveCount,
    isSemanticRoot,
    linkTextLength,
    listItemCount,
    paragraphCount,
    textLength,
  } = metrics;

  if (textLength < 280) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = textLength;
  score += paragraphCount * 140;
  score += Math.min(listItemCount, 30) * 35;
  score += Math.min(headingCount, 12) * 50;
  score += Math.min(calloutCount, 8) * 90;

  if (element.matches('article')) {
    score += 260;
  }
  if (element.matches('main, [role="main"], [itemprop="articleBody"]')) {
    score += 220;
  }
  if (CONTENT_HINT_RE.test(hintText)) {
    score += 180;
  }
  if (NOISE_HINT_RE.test(hintText)) {
    score -= 260;
  }

  const linkDensity = textLength === 0 ? 1 : linkTextLength / textLength;
  score -= linkDensity * 1200;
  score -= interactiveCount * 25;

  if (bodyShare > 0.92) {
    score -= isSemanticRoot ? 900 : 1200;
  } else if (bodyShare > 0.85 && !isSemanticRoot) {
    score -= 1000;
  }

  if (isHeadingHeavyComposite(metrics)) {
    score -= 450;
  }

  if (paragraphCount === 0 && listItemCount === 0) {
    score -= 250;
  }

  return score;
}

export function readabilityParseRead(sourceDocument: Document = document) {
  const article = getReadabilityArticle(sourceDocument);
  const articleTextContent = article?.textContent ?? '';

  if (!article || !articleTextContent) {
    return undefined;
  }

  return toWebpageContent(sourceDocument, articleTextContent, {
    title: article.title || getBaseMetadata(sourceDocument).title,
  });
}

export function domHeuristicParseRead(sourceDocument: Document = document) {
  textCache = new WeakMap();
  try {
    const body = sourceDocument.body;

    if (!body) {
      return undefined;
    }

    const bodyText = getElementText(body);
    const bestCandidate = collectCandidateElements(sourceDocument)
      .map((element) => ({
        element,
        score: scoreCandidate(element, bodyText.length),
      }))
      .sort((left, right) => right.score - left.score)[0];
    const bestText = bestCandidate ? getWinnerText(bestCandidate.element) : '';
    // The body fallback gets the same noise stripping, otherwise a page that
    // defeats both heuristics sends its navigation and footer instead of an
    // article.
    const text = bestText || getWinnerText(body);

    // No text at all is "no content", not an empty article. Returning an empty
    // `WebpageContent` here made the callers treat the page as extracted (and
    // cache it), so the summary went out with an empty `{{textContent}}`.
    if (!text) return undefined;

    return toWebpageContent(sourceDocument, text);
  } finally {
    textCache = null;
  }
}

/**
 * Choose between the two strategies' results.
 *
 * A result whose `textContent` is empty carries no article: returning it would
 * make the callers treat the page as extracted (caching it, then sending an
 * empty `{{textContent}}` to the model), so "nothing usable" is reported as
 * `undefined` instead. Exported for tests, which cannot construct a Document
 * but can pin this decision.
 */
export function pickExtraction(
  primary: WebpageContent | undefined,
  fallback: WebpageContent | undefined,
): WebpageContent | undefined {
  if (primary?.textContent) return primary;
  if (fallback?.textContent) return fallback;
  return undefined;
}

/**
 * Run the chosen strategy first and the other one only if needed.
 *
 * `pickExtraction(primary(doc), fallback(doc))` evaluated BOTH extractors on
 * every call, so each panel mount, SPA refresh and popup "copy page" paid for a
 * full Readability clone+parse *and* the whole DOM-heuristic walk even when the
 * first result was usable. Passing thunks keeps the same "complement each
 * other" behaviour without the second pass.
 */
export function pickExtractionLazily(
  primary: () => WebpageContent | undefined,
  fallback: () => WebpageContent | undefined,
): WebpageContent | undefined {
  const first = primary();
  if (first?.textContent) return first;
  return pickExtraction(first, fallback());
}

export function parsePageContent(
  extractMethod: PageTextExtractMethod = 'readability',
  sourceDocument: Document = document,
) {
  // The two strategies complement each other, so when the chosen one yields
  // nothing usable the other gets one attempt. The user's setting still
  // decides which runs first.
  const primary = extractMethod === 'dom-heuristic' ? domHeuristicParseRead : readabilityParseRead;
  const fallback = extractMethod === 'dom-heuristic' ? readabilityParseRead : domHeuristicParseRead;

  const extracted = pickExtractionLazily(
    () => primary(sourceDocument),
    () => fallback(sourceDocument),
  );

  // Neither strategy can see an article rendered inside an open shadow root or a
  // same-origin frame (see lib/page-flatten.ts). Inlining costs a document clone,
  // so it is only paid for when the normal pass came back empty-ish — which is
  // exactly the case that used to surface "没有内容".
  if (!needsFlattenedRetry(extracted?.textContent)) {
    return extracted;
  }

  const flattened = flattenShadowAndIframeContent(sourceDocument);
  if (!flattened) {
    return extracted;
  }

  const retried = pickExtractionLazily(
    () => primary(flattened),
    () => fallback(flattened),
  );

  return retried?.textContent?.trim() ? retried : extracted;
}
