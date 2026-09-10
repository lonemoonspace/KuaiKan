function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Scroll to (and, when supported, highlight) a phrase extracted from the
 * prompt/summary inside the underlying page.
 *
 * `window.find` is tried first because it does not touch URL/history and works
 * with the DOM's rendered text. If it fails, fall back to Chrome's
 * Scroll-to-Text Fragment (`:~:text=...`).
 */
export function scrollToPhrase(phrase: string): boolean {
  const needle = normalize(phrase).slice(0, 160);
  if (!needle) return false;

  try {
    // `window.find` is a non-standard (but universally supported in Chromium)
    // API, so it is not part of TypeScript's lib.dom Window typings.
    const findWindow = window as Window & {
      find?: (
        text: string,
        caseSensitive: boolean,
        backwards: boolean,
        wrapAround: boolean,
        wholeWord: boolean,
        searchInFrames: boolean,
        showDialog: boolean,
      ) => boolean;
    };
    if (findWindow.find?.(needle, false, false, true, false, false, false)) {
      return true;
    }
  } catch {
    // Fall through to the text-fragment approach.
  }

  try {
    const bodyText = normalize(document.body?.innerText ?? '');
    if (!bodyText.includes(needle)) return false;

    // Append the text directive to any existing hash (#section + :~:text=…)
    // instead of replacing it. Hash-routed SPAs would break when their route
    // hash is clobbered, so refuse to touch a non-empty, non-fragment hash.
    const url = new URL(window.location.href);
    const existingHash = url.hash.replace(/^#/, '');
    if (existingHash && !existingHash.startsWith(':~:')) {
      return false;
    }
    // existingHash is '' or a pure `:~:` directive chain — either way it must
    // be replaced, since a fragment may contain only one directive group.
    const fragment = `:~:text=${encodeURIComponent(needle)}`;
    url.hash = existingHash.startsWith(':~:') ? fragment : `${existingHash}${fragment}`;
    window.location.assign(url.toString());
    return true;
  } catch {
    return false;
  }
}