/**
 * Open shadow roots and same-origin iframes are invisible to both extraction
 * strategies: `Document.cloneNode(true)` never copies a shadow root (the DOM
 * spec makes them unclonable), and the DOM heuristic walks the light tree only.
 * An article rendered by a web component — or nested in a same-origin frame —
 * therefore extracted as nothing and the panel reported "没有内容".
 *
 * `flattenShadowAndIframeContent` returns a clone of the document with those
 * subtrees inlined, or `undefined` when there was nothing to inline. Cloning and
 * walking a page is not free, so callers gate it behind
 * `needsFlattenedRetry(...)`: only when the normal pass came back empty-ish.
 *
 * Known limits: closed shadow roots are unreachable from outside the component;
 * cross-origin frames return `null` for `contentDocument` (touching their window
 * throws) and stay invisible. `lib/scroll-to-text.ts` descends open shadow roots
 * and same-origin iframes for citation lookup, so both features now agree on
 * what "the page" contains.
 */

/** Below this many characters the normal extraction is treated as a failure. */
export const MIN_EXTRACTED_TEXT_LENGTH = 200;

/** Guards against pathological nesting (frame → frame → frame …). */
export const FLATTEN_DEPTH_LIMIT = 3;

/** Total number of shadow roots / frames inlined into one clone. */
export const FLATTEN_CONTAINER_LIMIT = 200;

/** Marks the wrapper elements this module inserts (debugging aid). */
export const FLATTENED_CONTAINER_ATTRIBUTE = 'data-kuai-flattened';

/**
 * The panel's own host (`entrypoints/content/scope.tsx`). WXT attaches an
 * *open* shadow root to it, so without this skip every flattened retry pulled
 * the panel's buttons and the restored summary in as "page content" — and since
 * that text is never empty, it beat the honest "没有内容" result.
 */
const EXTENSION_HOST_TAG = 'WEBPAGE-SUMMARY-ENTRANCE';

export function needsFlattenedRetry(text: string | null | undefined): boolean {
  return (text ?? '').trim().length < MIN_EXTRACTED_TEXT_LENGTH;
}

type ShadowHostElement = Element & { shadowRoot: ShadowRoot | null };

function readShadowRoot(element: Element): ShadowRoot | null {
  try {
    return (element as ShadowHostElement).shadowRoot ?? null;
  } catch {
    return null;
  }
}

function readSameOriginIframeBody(element: Element): HTMLElement | null {
  if (element.tagName !== 'IFRAME') {
    return null;
  }

  try {
    return (element as HTMLIFrameElement).contentDocument?.body ?? null;
  } catch {
    // Cross-origin frame: reading its document throws a SecurityError.
    return null;
  }
}

function createContainer(ownerDocument: Document): HTMLDivElement {
  const container = ownerDocument.createElement('div');
  container.setAttribute(FLATTENED_CONTAINER_ATTRIBUTE, '');
  return container;
}

/**
 * Pairs the live and clone trees by document order. Shadow roots are not
 * clonable, so their children are cloned one by one into a wrapper element; a
 * same-origin frame's body is cloned whole.
 */
function inlineSubtrees(
  liveRoot: ParentNode,
  cloneRoot: ParentNode,
  depth: number,
  budget: { remaining: number },
  ownerDocument: Document,
): number {
  if (depth > FLATTEN_DEPTH_LIMIT || budget.remaining <= 0) {
    return 0;
  }

  // Both snapshots are taken before anything is inserted: inserting a wrapper
  // would shift the clone's element order and break the index pairing below.
  const liveElements = Array.from(liveRoot.querySelectorAll('*'));
  const cloneElements = Array.from(cloneRoot.querySelectorAll('*'));
  let inlined = 0;

  for (let index = 0; index < liveElements.length; index += 1) {
    if (budget.remaining <= 0) {
      break;
    }

    const liveElement = liveElements[index];
    const cloneElement = cloneElements[index];
    if (!cloneElement || liveElement.tagName === EXTENSION_HOST_TAG) {
      continue;
    }

    const shadowRoot = readShadowRoot(liveElement);
    if (shadowRoot && shadowRoot.childNodes.length > 0) {
      const container = createContainer(ownerDocument);
      Array.from(shadowRoot.childNodes).forEach((child) => {
        container.appendChild(child.cloneNode(true));
      });
      cloneElement.appendChild(container);
      budget.remaining -= 1;
      inlined += 1;
      inlined += inlineSubtrees(shadowRoot, container, depth + 1, budget, ownerDocument);
    }

    const frameBody = readSameOriginIframeBody(liveElement);
    if (frameBody) {
      const container = createContainer(ownerDocument);
      const bodyClone = frameBody.cloneNode(true) as HTMLElement;
      container.appendChild(bodyClone);
      cloneElement.appendChild(container);
      budget.remaining -= 1;
      inlined += 1;
      inlined += inlineSubtrees(frameBody, bodyClone, depth + 1, budget, ownerDocument);
    }
  }

  return inlined;
}

/**
 * A clone of `sourceDocument` whose open shadow roots and same-origin frames are
 * inlined as ordinary descendants, or `undefined` when the document has none.
 *
 * The clone has no browsing context, so extractors reading its `location` fall
 * back to the global `location` and still report the real page URL.
 */
export function flattenShadowAndIframeContent(sourceDocument: Document): Document | undefined {
  const liveRoot = sourceDocument.documentElement;
  if (!liveRoot) {
    return undefined;
  }

  const clone = sourceDocument.cloneNode(true) as Document;
  const cloneRoot = clone.documentElement;
  if (!cloneRoot) {
    return undefined;
  }

  const inlined = inlineSubtrees(liveRoot, cloneRoot, 0, { remaining: FLATTEN_CONTAINER_LIMIT }, sourceDocument);
  return inlined > 0 ? clone : undefined;
}
