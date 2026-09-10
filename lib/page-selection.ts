/**
 * In-content tracker for the page's current text selection.
 *
 * The content UI lives in a Shadow DOM and its own clicks collapse the
 * document selection, so reading `window.getSelection()` at summary time is
 * unreliable. ContentEntrance records selection changes as they happen and
 * prompt assembly reads the latest value here instead.
 */

let currentSelection = '';

export function setCurrentPageSelection(selection: string) {
  currentSelection = selection;
}

export function getCurrentPageSelection(): string {
  return currentSelection;
}
