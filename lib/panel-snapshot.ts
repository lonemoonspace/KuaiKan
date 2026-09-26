import type { UIMessage } from 'ai';
import type { StorageItemKey } from '#imports';

/**
 * What the in-page panel remembers about one page of one tab: whether it was
 * open, and the summary it showed. Only assistant messages are kept — the
 * system and user messages carry the rendered prompt with the full page text,
 * which is large and never rendered.
 */
export type PanelSnapshot = {
  open: boolean;
  messages: UIMessage[];
  updatedAt: number;
};

export type PanelSnapshotPatch = Partial<Pick<PanelSnapshot, 'open' | 'messages'>>;

export type PanelSnapshotMap = Record<string, PanelSnapshot>;

// A long browsing session in one tab visits many pages; keep only the most
// recently touched ones.
export const MAX_PANEL_SNAPSHOTS_PER_TAB = 20;

/**
 * One key per tab in `browser.storage.session`: in memory only, cleared when
 * the browser restarts, and removed by the background when the tab closes.
 */
export function getPanelSnapshotStorageKey(tabId: number): StorageItemKey {
  return `session:panel-snapshots-${tabId}`;
}

/**
 * Identifies "the same page" for snapshot purposes. The fragment is dropped so
 * in-page anchor jumps (tables of contents, footnotes) do not count as leaving
 * the page — except hash-router routes (`#/…`, `#!…`), where the fragment is
 * the page.
 */
export function getPageKey(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }

  const isHashRoute = url.hash.startsWith('#/') || url.hash.startsWith('#!');
  if (!isHashRoute) url.hash = '';
  return url.href;
}

export function persistableMessages(messages: UIMessage[]): UIMessage[] {
  return messages.filter((message) => message.role === 'assistant');
}

/**
 * Merge a patch into one page's snapshot and prune the least recently updated
 * pages beyond the per-tab cap. Returns a new map.
 */
export function applyPanelSnapshotPatch(
  snapshots: PanelSnapshotMap,
  pageKey: string,
  patch: PanelSnapshotPatch,
  now: number,
): PanelSnapshotMap {
  const previous = snapshots[pageKey];
  const next: PanelSnapshotMap = {
    ...snapshots,
    [pageKey]: {
      open: patch.open ?? previous?.open ?? false,
      messages:
        patch.messages !== undefined
          ? persistableMessages(patch.messages)
          : (previous?.messages ?? []),
      updatedAt: now,
    },
  };

  const keys = Object.keys(next);
  if (keys.length <= MAX_PANEL_SNAPSHOTS_PER_TAB) return next;

  const evicted = keys
    .sort((a, b) => next[a].updatedAt - next[b].updatedAt)
    .slice(0, keys.length - MAX_PANEL_SNAPSHOTS_PER_TAB);
  for (const key of evicted) delete next[key];
  return next;
}
