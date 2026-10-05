/**
 * Focus management for the hand-rolled overlays (the token viewer inside the
 * content panel, the remote-model picker in the options page). Radix dialogs
 * bring their own trap; these two are plain divs, so without this Tab escaped
 * into the page behind the overlay.
 *
 * The wrap-around rule is kept pure so it can be unit-tested without a DOM.
 */

/** Elements that participate in Tab order, in DOM order. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Where focus should land on Tab / Shift+Tab inside a trap.
 *
 * `currentIndex < 0` means focus is currently outside the trap (or on the
 * container itself), which may happen right after the overlay opens; the first
 * (or last, for Shift+Tab) element is then the right target.
 */
export function nextFocusIndex(
  currentIndex: number,
  count: number,
  shiftKey: boolean,
): number {
  if (count <= 0) return -1;

  if (currentIndex < 0 || currentIndex >= count) {
    return shiftKey ? count - 1 : 0;
  }

  return shiftKey ? (currentIndex - 1 + count) % count : (currentIndex + 1) % count;
}

/** Focusable descendants of `root`, skipping anything hidden by CSS. */
export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

  return candidates.filter((element) => {
    if (element.hasAttribute('disabled')) return false;
    // jsdom has no layout, so `offsetParent` is always null there; only trust
    // it when the environment actually implements it.
    if (element.offsetParent === null && element.getClientRects().length === 0) {
      const style = element.ownerDocument.defaultView?.getComputedStyle(element);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    }

    return true;
  });
}

/**
 * The element that actually has focus, descending through shadow roots.
 * `document.activeElement` stops at the shadow host, which is not an element
 * inside the overlay — that made the trap think focus was outside and jump to
 * the first item on every Tab.
 */
export function getActiveElement(root: HTMLElement): Element | null {
  const rootNode = root.getRootNode() as Document | ShadowRoot;
  let active: Element | null = rootNode.activeElement ?? null;

  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }

  return active;
}

/**
 * Moves focus to the next (or previous) focusable element inside `root`,
 * wrapping at the ends. Returns the element it focused, if any.
 */
export function focusNextInside(
  root: HTMLElement,
  shiftKey: boolean,
): HTMLElement | null {
  const focusable = getFocusableElements(root);
  const active = getActiveElement(root);
  const currentIndex = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
  const target = focusable[nextFocusIndex(currentIndex, focusable.length, shiftKey)];

  target?.focus();
  return target ?? null;
}
