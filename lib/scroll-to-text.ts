// Scroll the underlying page back to a phrase quoted by a citation chip.
//
// The previous implementation leaned on `window.find` plus a Scroll-to-Text
// Fragment fallback, which silently failed on a lot of real pages:
//   - text inside open shadow roots or same-origin iframes is invisible to both;
//   - the LLM rarely quotes byte-for-byte (full/half-width punctuation, curly vs
//     straight quotes, whitespace between CJK and Latin, line breaks that
//     innerText inserts between blocks);
//   - same-document `:~:text=` navigations are not reliably honoured and
//     clobber hash-routed SPAs.
//
// Instead we walk the DOM ourselves, build a normalized "letters and digits
// only" view of every text node with an index map back to the source offsets,
// match the normalized phrase against it (falling back to the longest matching
// fragment when the quote was paraphrased), then scroll the real Range into
// view and paint it with the CSS Custom Highlight API. Highlighting never
// touches the page selection, so it cannot trigger the "summarize selection"
// entrance or a site's own selection popovers.
//
// When nothing plausible is found, we simply report failure — no
// `window.find` fallback, so the page selection is never touched.

const HIGHLIGHT_NAME = 'kuai-cite-target';
const HIGHLIGHT_STYLE_ID = 'kuai-cite-target-style';
const HIGHLIGHT_DURATION_MS = 4000;
// Injected into the *page's* document/shadow root, where the extension's theme
// variables do not exist, so this one colour has to be literal.
const HIGHLIGHT_STYLE_RULE = `::highlight(${HIGHLIGHT_NAME}){background-color:rgba(255,200,0,.55);color:inherit;}`;
const EXTENSION_HOST_TAG = 'webpage-summary-entrance';
const SKIPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'TEXTAREA',
  'SELECT',
  'OPTION',
  'HEAD',
  'TITLE',
]);
// A fallback fragment shorter than this is too likely to hit an unrelated
// spot. CJK chars carry far more information each than Latin letters.
const MIN_FRAGMENT_LENGTH_CJK = 6;
const MIN_FRAGMENT_LENGTH_LATIN = 16;
// ...and it must still cover a reasonable share of the quote.
const MIN_FRAGMENT_RATIO = 0.35;
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
// Hoisted: a regex literal inside the per-character loop below allocates a new
// RegExp for every character of every text node on the page.
const LETTER_OR_DIGIT_PATTERN = /[\p{L}\p{N}]/u;
const ASCII_LETTER_OR_DIGIT_PATTERN = /[a-z0-9]/;
// A fragment that recurs dozens of times across a page (e.g. a nav item) is
// not a meaningful citation target; cap collection so a pathological page
// can't make matching scan unboundedly.
const MAX_MATCH_CANDIDATES = 50;

type NormalizedText = { text: string; map: number[] };

/**
 * Reduce text to lowercase letters/digits after NFKC (full-width → half-width),
 * recording for every output char the index of the source char it came from.
 * Whitespace, punctuation, quotes and symbols are dropped, which absorbs most
 * of the cosmetic differences between an LLM quote and the page text.
 */
export function normalizeForMatch(source: string): NormalizedText {
  let text = '';
  const map: number[] = [];
  let index = 0;
  for (const char of source) {
    // Fast path: ASCII needs no NFKC pass, only case folding. This is the
    // overwhelming majority of characters on Latin pages, and `normalize` is
    // far more expensive than a character-range test.
    if (char.length === 1 && char.charCodeAt(0) < 128) {
      const lower = char.toLowerCase();
      if (ASCII_LETTER_OR_DIGIT_PATTERN.test(lower)) {
        text += lower;
        map.push(index);
      }
      index += 1;
      continue;
    }
    const folded = char.normalize('NFKC').toLowerCase();
    for (const out of folded) {
      if (LETTER_OR_DIGIT_PATTERN.test(out)) {
        text += out;
        map.push(index);
      }
    }
    index += char.length;
  }
  return { text, map };
}

export type FuzzyMatch = { start: number; end: number };

/**
 * Find `needle` (already normalized) inside `haystack` (already normalized).
 * Returns every candidate position of the best match, in document order:
 * the full needle when present, otherwise the longest fragment of it that
 * appears (sliding windows, longest first).
 */
export function findFuzzyMatches(haystack: string, needle: string): FuzzyMatch[] {
  if (!needle || !haystack) return [];

  const allOccurrences = (fragment: string): FuzzyMatch[] => {
    const results: FuzzyMatch[] = [];
    let from = 0;
    while (from <= haystack.length && results.length < MAX_MATCH_CANDIDATES) {
      const at = haystack.indexOf(fragment, from);
      if (at < 0) break;
      results.push({ start: at, end: at + fragment.length });
      from = at + 1;
    }
    return results;
  };

  const exact = allOccurrences(needle);
  if (exact.length) return exact;

  const baseMin = CJK_PATTERN.test(needle) ? MIN_FRAGMENT_LENGTH_CJK : MIN_FRAGMENT_LENGTH_LATIN;
  const minLength = Math.max(baseMin, Math.ceil(needle.length * MIN_FRAGMENT_RATIO));
  if (needle.length <= minLength) return [];

  // Sliding windows from longest to shortest; the first length that hits wins.
  // Step sizes keep this to a few hundred indexOf calls even for a 160-char
  // quote, which is negligible next to the DOM walk.
  for (let length = needle.length - 1; length >= minLength; ) {
    const step = Math.max(1, Math.floor(length / 4));
    for (let start = 0; start + length <= needle.length; start += step) {
      const hits = allOccurrences(needle.slice(start, start + length));
      if (hits.length) return hits;
    }
    // Always try the tail window, which the stepping may have skipped.
    const tailHits = allOccurrences(needle.slice(needle.length - length));
    if (tailHits.length) return tailHits;
    length = length > 24 ? Math.floor(length * 0.8) : length - 1;
  }
  return [];
}

type Segment = { node: Text; normalizedStart: number; map: number[] };

type PageIndex = { text: string; segments: Segment[] };

function isSkippedElement(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName)) return true;
  if (element.tagName.toLowerCase() === EXTENSION_HOST_TAG) return true;
  return false;
}

function collectTextNodes(root: Node, into: Text[]) {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE && isSkippedElement(node as Element)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node as Text).data.trim()) into.push(node as Text);
      continue;
    }
    const element = node as Element;
    if (element.shadowRoot) collectTextNodes(element.shadowRoot, into);
    if (element.tagName === 'IFRAME' || element.tagName === 'FRAME') {
      try {
        const frameDoc = (element as HTMLIFrameElement).contentDocument;
        if (frameDoc?.body) collectTextNodes(frameDoc.body, into);
      } catch {
        // Cross-origin frame: not reachable from here.
      }
    }
  }
}

function buildPageIndex(): PageIndex {
  const nodes: Text[] = [];
  if (document.body) collectTextNodes(document.body, nodes);

  let text = '';
  const segments: Segment[] = [];
  for (const node of nodes) {
    const normalized = normalizeForMatch(node.data);
    if (!normalized.text) continue;
    segments.push({ node, normalizedStart: text.length, map: normalized.map });
    text += normalized.text;
  }
  return { text, segments };
}

// Building the page index is a full DOM walk, which is wasteful to repeat for
// every citation chip click on an unchanged page. Cache it across calls and
// drop the cache on the first DOM mutation observed afterwards — cheap to set
// up, and the observer only exists while a cached index is outstanding.
let cachedIndex: PageIndex | null = null;
let indexObserver: MutationObserver | null = null;

function invalidatePageIndex() {
  cachedIndex = null;
  indexObserver?.disconnect();
  indexObserver = null;
}

function getPageIndex(): PageIndex {
  if (cachedIndex) return cachedIndex;

  invalidatePageIndex();
  const index = buildPageIndex();
  // Guard for test environments without MutationObserver: skip caching
  // rather than risk ever serving a stale index.
  if (typeof MutationObserver !== 'undefined' && document.body) {
    cachedIndex = index;
    indexObserver = new MutationObserver(invalidatePageIndex);
    indexObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  return index;
}

/** Map a normalized offset back to (text node, source offset). */
function locate(index: PageIndex, offset: number, edge: 'start' | 'end') {
  const { segments } = index;
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (segments[mid].normalizedStart <= offset) low = mid;
    else high = mid - 1;
  }
  const segment = segments[low];
  const local = offset - segment.normalizedStart;
  if (edge === 'start') {
    return { node: segment.node, offset: segment.map[local] };
  }
  // `offset` is the last matched char (inclusive); end right after its source char.
  const lastSource = segment.map[local];
  const lastChar = String.fromCodePoint(segment.node.data.codePointAt(lastSource) ?? 0);
  return { node: segment.node, offset: lastSource + lastChar.length };
}

function toRange(index: PageIndex, match: FuzzyMatch): Range | null {
  try {
    const start = locate(index, match.start, 'start');
    let end = locate(index, match.end - 1, 'end');
    // A Range cannot span different shadow trees or documents; clamp to the
    // start node in that case, which is still the right place to scroll to.
    if (
      start.node.getRootNode() !== end.node.getRootNode() ||
      start.node.ownerDocument !== end.node.ownerDocument
    ) {
      end = { node: start.node, offset: start.node.data.length };
    }
    const range = start.node.ownerDocument.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  } catch {
    return null;
  }
}

function isRangeVisible(range: Range): boolean {
  const element = range.startContainer.parentElement;
  if (!element) return false;
  if (range.getClientRects().length === 0) return false;
  // `checkVisibility` walks the ancestor chain, so an ancestor with
  // `opacity: 0` is rejected too -- computed opacity is not inherited, so
  // reading only this element's style used to let those matches through.
  const checkVisibility = (
    element as Element & {
      checkVisibility?: (options?: {
        checkOpacity?: boolean;
        checkVisibilityCSS?: boolean;
      }) => boolean;
    }
  ).checkVisibility;
  if (typeof checkVisibility === 'function') {
    try {
      return checkVisibility.call(element, { checkOpacity: true, checkVisibilityCSS: true });
    } catch {
      // Fall through to the style probe below.
    }
  }
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  return !style || (style.visibility !== 'hidden' && style.opacity !== '0');
}

/** Open collapsed <details> ancestors so hidden matches become reachable. */
function revealRange(range: Range) {
  let node: Node | null = range.startContainer;
  while (node) {
    // nodeType checks rather than instanceof: nodes from same-origin iframes
    // belong to a different realm's Element/ShadowRoot constructors.
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'DETAILS') {
      (node as HTMLDetailsElement).open = true;
    }
    node = node.parentNode ?? (node as Partial<ShadowRoot>).host ?? null;
  }
}

let clearHighlightTimer: ReturnType<typeof setTimeout> | null = null;
let clearHighlight: (() => void) | null = null;
// Every style element this module injected for the *current* highlight, so the
// rules can be removed again when it ends. Leaving them in the page (as the
// first version did) permanently modified a document we do not own.
let injectedHighlightStyles: HTMLElement[] = [];

function ensureHighlightStyle(root: Document | ShadowRoot) {
  const isDocument = root.nodeType === Node.DOCUMENT_NODE;
  const doc = isDocument ? (root as Document) : root.ownerDocument;
  if (!doc) return;
  const container = isDocument ? doc.head ?? doc.documentElement : root;
  if (!container) return;
  let style = container.querySelector<HTMLElement>(`#${HIGHLIGHT_STYLE_ID}`);
  if (!style) {
    style = doc.createElement('style');
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = HIGHLIGHT_STYLE_RULE;
    container.appendChild(style);
  }
  if (!injectedHighlightStyles.includes(style)) injectedHighlightStyles.push(style);
}

function removeHighlightStyles() {
  for (const style of injectedHighlightStyles) style.remove();
  injectedHighlightStyles = [];
}

function highlightRange(range: Range) {
  clearHighlight?.();
  if (clearHighlightTimer !== null) clearTimeout(clearHighlightTimer);

  const doc = range.startContainer.ownerDocument;
  const view = doc?.defaultView as (Window & typeof globalThis) | null;
  const registry = view?.CSS?.highlights;
  const HighlightCtor = view?.Highlight;
  if (!doc || !registry || !HighlightCtor) return;

  try {
    const root = range.startContainer.getRootNode();
    ensureHighlightStyle(doc);
    // `::highlight()` rules do not cross shadow boundaries.
    if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) ensureHighlightStyle(root as ShadowRoot);
    registry.set(HIGHLIGHT_NAME, new HighlightCtor(range));
    clearHighlight = () => {
      registry.delete(HIGHLIGHT_NAME);
      removeHighlightStyles();
      clearHighlight = null;
    };
    clearHighlightTimer = setTimeout(() => {
      clearHighlightTimer = null;
      clearHighlight?.();
    }, HIGHLIGHT_DURATION_MS);
  } catch {
    // Highlighting is cosmetic; scrolling already happened.
  }
}

function scrollRangeIntoView(range: Range) {
  const element = range.startContainer.parentElement;
  // scrollIntoView walks every scrollable ancestor (inner SPA scrollers and
  // parent frames included), which `window.scrollTo` math would not.
  element?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
}

/**
 * Scroll to (and highlight) a phrase extracted from the summary inside the
 * underlying page. Returns false when nothing plausible was found.
 */
export function scrollToPhrase(phrase: string): boolean {
  const raw = phrase.replace(/\s+/g, ' ').trim();
  const needle = normalizeForMatch(raw).text;
  if (!needle) return false;

  let index = getPageIndex();
  let matches = findFuzzyMatches(index.text, needle);

  // A cached index can go stale without the MutationObserver noticing: DOM
  // changes inside a shadow root or a same-origin iframe are not observed
  // from `document.body`. Rebuild once and re-match when the cached text is
  // unusable — either the top match points at a node that has since been
  // detached, or the stale text yields no match at all (an article mounted
  // after the index was built, which the observer never saw). Without the
  // second case the user is told "没有在页面中找到这段原文" for text that is
  // visibly on the page.
  const topMatchDetached =
    matches.length > 0 && !locate(index, matches[0].start, 'start').node.isConnected;

  if (!matches.length || topMatchDetached) {
    invalidatePageIndex();
    index = getPageIndex();
    matches = findFuzzyMatches(index.text, needle);
  }

  let fallback: Range | null = null;
  for (const match of matches) {
    const range = toRange(index, match);
    if (!range) continue;
    if (isRangeVisible(range)) {
      scrollRangeIntoView(range);
      highlightRange(range);
      return true;
    }
    fallback ??= range;
  }

  if (fallback) {
    revealRange(fallback);
    scrollRangeIntoView(fallback);
    highlightRange(fallback);
    return true;
  }

  return false;
}
