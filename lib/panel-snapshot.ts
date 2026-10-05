import type { UIMessage } from 'ai';
import type { StorageItemKey } from '#imports';

/**
 * What the in-page panel remembers about one page of one tab: whether it was
 * open, and the summary it showed. Only assistant messages are kept — the
 * system and user messages carry the rendered prompt with the full page text,
 * which is large and never rendered.
 *
 * `open` is recorded only when the user opens or closes the panel; while it is
 * undefined the "open the panel by default" setting decides.
 */
export type PanelSnapshot = {
  open?: boolean;
  messages: UIMessage[];
  updatedAt: number;
};

export type PanelSnapshotPatch = Partial<Pick<PanelSnapshot, 'open' | 'messages'>>;

/**
 * A long browsing session in one tab visits many pages; keep only the most
 * recently touched ones.
 */
export const MAX_PANEL_SNAPSHOTS_PER_TAB = 20;

/**
 * Characters one page's snapshot may occupy. `storage.session` is capped at
 * ~10 MB in Chrome, and every page key survives until the tab closes, so
 * without a per-page cap a handful of reasoning-heavy summaries could fill it
 * and make `setItem` fail — losing snapshots silently.
 */
export const MAX_PANEL_SNAPSHOT_CHARS = 128 * 1024;

/**
 * Characters kept per text/reasoning part. Only the restored copy is trimmed
 * (the live panel keeps the full text); the marker makes the trim visible, and
 * counts against the cap so the trimmed part never exceeds it.
 */
export const MAX_PANEL_MESSAGE_PART_CHARS = 32 * 1024;

export const PANEL_SNAPSHOT_TRUNCATION_MARKER = '\n\n[… 内容过长，保存时已截断 …]';

const KEPT_PART_CHARS =
  MAX_PANEL_MESSAGE_PART_CHARS - PANEL_SNAPSHOT_TRUNCATION_MARKER.length;

export type PanelSnapshotIndexEntry = {
  pageKey: string;
  updatedAt: number;
};

/** Which pages of a tab have a snapshot, and when each was last written. */
export type PanelSnapshotIndex = {
  pages: PanelSnapshotIndexEntry[];
};

/**
 * The per-tab *index* key. The summaries themselves live under one key each
 * (see `getPanelPageSnapshotStorageKey`), so saving one page no longer rewrites
 * every other page's summary: the previous single-map layout rewrote the whole
 * per-tab history on every throttled streaming save.
 */
export function getPanelSnapshotStorageKey(tabId: number): StorageItemKey {
  return `session:panel-snapshots-${tabId}`;
}

/**
 * One key per (tab, page). The whole page key (a normalised URL) is embedded in
 * the storage key, so no hashing — and no hash collisions — are involved.
 */
export function getPanelPageSnapshotStorageKey(
  tabId: number,
  pageKey: string,
): StorageItemKey {
  return `session:panel-snapshot-page-${tabId}-${pageKey}`;
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
 * Tolerant reader for the index. Anything that is not the current shape —
 * including the single-map layout written by older builds — reads as empty,
 * so the first save simply rewrites the key.
 */
export function parsePanelSnapshotIndex(value: unknown): PanelSnapshotIndex {
  if (!value || typeof value !== 'object') return { pages: [] };

  const pages = (value as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return { pages: [] };

  const entries = pages
    .map((entry): PanelSnapshotIndexEntry | null => {
      if (!entry || typeof entry !== 'object') return null;

      const { pageKey, updatedAt } = entry as {
        pageKey?: unknown;
        updatedAt?: unknown;
      };
      if (typeof pageKey !== 'string' || pageKey.length === 0) return null;

      return {
        pageKey,
        updatedAt:
          typeof updatedAt === 'number' && Number.isFinite(updatedAt)
            ? updatedAt
            : 0,
      };
    })
    .filter((entry): entry is PanelSnapshotIndexEntry => entry !== null);

  return { pages: entries };
}

/**
 * Record that `pageKey` was just written, and report which pages fell out of
 * the per-tab cap so the caller can delete their payloads. The page being
 * written is never evicted, even if its timestamp is the oldest.
 */
export function applyPanelSnapshotIndexPatch(
  index: PanelSnapshotIndex,
  pageKey: string,
  now: number,
): { index: PanelSnapshotIndex; evicted: string[] } {
  const pages = [
    ...index.pages.filter((entry) => entry.pageKey !== pageKey),
    { pageKey, updatedAt: now },
  ];

  const overflow = pages.length - MAX_PANEL_SNAPSHOTS_PER_TAB;
  if (overflow <= 0) return { index: { pages }, evicted: [] };

  const evicted = pages
    .filter((entry) => entry.pageKey !== pageKey)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, overflow)
    .map((entry) => entry.pageKey);
  const evictedSet = new Set(evicted);

  return {
    index: { pages: pages.filter((entry) => !evictedSet.has(entry.pageKey)) },
    evicted,
  };
}

function truncateTextPart(
  part: UIMessage['parts'][number],
): UIMessage['parts'][number] {
  if (part.type === 'text') {
    return part.text.length > MAX_PANEL_MESSAGE_PART_CHARS
      ? {
          ...part,
          text: `${part.text.slice(0, KEPT_PART_CHARS)}${PANEL_SNAPSHOT_TRUNCATION_MARKER}`,
        }
      : part;
  }

  if (part.type === 'reasoning') {
    return part.text.length > MAX_PANEL_MESSAGE_PART_CHARS
      ? {
          ...part,
          text: `${part.text.slice(0, KEPT_PART_CHARS)}${PANEL_SNAPSHOT_TRUNCATION_MARKER}`,
        }
      : part;
  }

  return part;
}

/**
 * Bound a snapshot's size: trim any oversized text/reasoning part, then drop
 * the oldest messages until the serialised snapshot fits. The newest message is
 * always kept — showing a truncated latest summary beats showing nothing.
 */
export function fitPanelSnapshotToSize(
  snapshot: PanelSnapshot,
  maxChars: number = MAX_PANEL_SNAPSHOT_CHARS,
): PanelSnapshot {
  let messages = snapshot.messages.map((message) => ({
    ...message,
    parts: message.parts.map(truncateTextPart),
  }));

  while (
    messages.length > 1 &&
    JSON.stringify({ ...snapshot, messages }).length > maxChars
  ) {
    messages = messages.slice(1);
  }

  return { ...snapshot, messages };
}

/**
 * Merge a patch into one page's snapshot. Returns a new object; the result is
 * always within the size caps, so callers cannot accidentally persist an
 * unbounded summary.
 */
export function applyPanelSnapshotPatch(
  previous: PanelSnapshot | null | undefined,
  patch: PanelSnapshotPatch,
  now: number,
): PanelSnapshot {
  return fitPanelSnapshotToSize({
    open: patch.open ?? previous?.open,
    messages:
      patch.messages !== undefined
        ? persistableMessages(patch.messages)
        : (previous?.messages ?? []),
    updatedAt: now,
  });
}
