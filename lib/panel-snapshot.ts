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
 * Characters all of one tab's snapshots may occupy together. The per-page cap
 * alone still allowed 20 × 128K ≈ 2.5M chars per tab (several MB once CJK text
 * is UTF-8 encoded), so a few long-lived tabs could exhaust the ~10 MB quota
 * that every tab shares. The oldest pages are evicted to stay under it.
 */
export const MAX_PANEL_SNAPSHOT_CHARS_PER_TAB = 512 * 1024;

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
  /** Serialised length of the page's snapshot, for the per-tab cap. */
  size: number;
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

      const { pageKey, updatedAt, size } = entry as {
        pageKey?: unknown;
        updatedAt?: unknown;
        size?: unknown;
      };
      if (typeof pageKey !== 'string' || pageKey.length === 0) return null;

      return {
        pageKey,
        updatedAt:
          typeof updatedAt === 'number' && Number.isFinite(updatedAt)
            ? updatedAt
            : 0,
        // Indexes written before sizes were tracked count as empty; their
        // payloads are already bounded by the per-page cap.
        size: typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0,
      };
    })
    .filter((entry): entry is PanelSnapshotIndexEntry => entry !== null);

  return { pages: entries };
}

/**
 * Record that `pageKey` was just written (`size` = its serialised length), and
 * report which pages fell out of the per-tab caps — page count and total size —
 * so the caller can delete their payloads. The oldest pages go first; the page
 * being written is never evicted, even if its timestamp is the oldest.
 */
export function applyPanelSnapshotIndexPatch(
  index: PanelSnapshotIndex,
  pageKey: string,
  now: number,
  size = 0,
): { index: PanelSnapshotIndex; evicted: string[] } {
  const pages = [
    ...index.pages.filter((entry) => entry.pageKey !== pageKey),
    { pageKey, updatedAt: now, size },
  ];

  let count = pages.length;
  let totalSize = pages.reduce((sum, entry) => sum + entry.size, 0);
  const evicted: string[] = [];
  const oldestFirst = pages
    .filter((entry) => entry.pageKey !== pageKey)
    .sort((a, b) => a.updatedAt - b.updatedAt);

  for (const entry of oldestFirst) {
    if (
      count <= MAX_PANEL_SNAPSHOTS_PER_TAB &&
      totalSize <= MAX_PANEL_SNAPSHOT_CHARS_PER_TAB
    ) {
      break;
    }
    evicted.push(entry.pageKey);
    count -= 1;
    totalSize -= entry.size;
  }

  if (evicted.length === 0) return { index: { pages }, evicted };
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
 * Shorten the longest text/reasoning part of `message` so the serialised
 * snapshot shrinks by at least `overflow` characters (every removed character
 * is at least one serialised character). Returns `null` when nothing is left
 * to trim.
 */
function trimLongestPart(message: UIMessage, overflow: number): UIMessage | null {
  let longest = -1;
  let longestLength = 0;
  message.parts.forEach((part, index) => {
    if (part.type !== 'text' && part.type !== 'reasoning') return;
    if (part.text.length > longestLength) {
      longest = index;
      longestLength = part.text.length;
    }
  });
  if (longest < 0) return null;

  const part = message.parts[longest] as Extract<
    UIMessage['parts'][number],
    { type: 'text' | 'reasoning' }
  >;
  const marked = part.text.endsWith(PANEL_SNAPSHOT_TRUNCATION_MARKER);
  const body = marked
    ? part.text.slice(0, -PANEL_SNAPSHOT_TRUNCATION_MARKER.length)
    : part.text;
  if (body.length === 0) return null;

  const markerCost = marked ? 0 : PANEL_SNAPSHOT_TRUNCATION_MARKER.length;
  const kept = Math.max(0, body.length - overflow - markerCost);
  const parts = [...message.parts];
  parts[longest] = {
    ...part,
    text: `${body.slice(0, kept)}${PANEL_SNAPSHOT_TRUNCATION_MARKER}`,
  };
  return { ...message, parts };
}

/**
 * Bound a snapshot's size: trim any oversized text/reasoning part, then drop
 * the oldest messages until the serialised snapshot fits. The newest message is
 * always kept — showing a truncated latest summary beats showing nothing — but
 * is itself trimmed when it alone is over the cap (several parts each just
 * under the per-part limit).
 */
export function fitPanelSnapshotToSize(
  snapshot: PanelSnapshot,
  maxChars: number = MAX_PANEL_SNAPSHOT_CHARS,
): PanelSnapshot {
  let messages = snapshot.messages.map((message) => ({
    ...message,
    parts: message.parts.map(truncateTextPart),
  }));
  const overflowOf = (candidate: UIMessage[]) =>
    JSON.stringify({ ...snapshot, messages: candidate }).length - maxChars;

  while (messages.length > 1 && overflowOf(messages) > 0) {
    messages = messages.slice(1);
  }

  // Each pass empties at most one part, so the part count bounds the loop.
  for (let pass = 0; messages.length === 1 && pass <= messages[0].parts.length; pass += 1) {
    const overflow = overflowOf(messages);
    if (overflow <= 0) break;
    const trimmed = trimLongestPart(messages[0], overflow);
    if (!trimmed) break;
    messages = [trimmed];
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
