import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  MAX_PANEL_MESSAGE_PART_CHARS,
  MAX_PANEL_SNAPSHOTS_PER_TAB,
  PANEL_SNAPSHOT_TRUNCATION_MARKER,
  applyPanelSnapshotIndexPatch,
  applyPanelSnapshotPatch,
  fitPanelSnapshotToSize,
  getPageKey,
  getPanelPageSnapshotStorageKey,
  getPanelSnapshotStorageKey,
  parsePanelSnapshotIndex,
  type PanelSnapshot,
  type PanelSnapshotIndex,
} from '@/lib/panel-snapshot';

const textPart = (text: string): UIMessage['parts'][number] => ({
  type: 'text',
  text,
});

const message = (
  role: UIMessage['role'],
  text: string,
  id = `${role}-${text}`,
): UIMessage => ({
  id,
  role,
  parts: [textPart(text)],
});

describe('getPageKey', () => {
  it('drops an in-page anchor so jumping within the page keeps the same key', () => {
    expect(getPageKey('https://example.com/post?id=1#section-2')).toBe(
      'https://example.com/post?id=1',
    );
  });

  it('keeps hash-router routes, which are distinct pages', () => {
    expect(getPageKey('https://example.com/app#/inbox')).toBe('https://example.com/app#/inbox');
    expect(getPageKey('https://example.com/app#!/inbox')).toBe('https://example.com/app#!/inbox');
  });

  it('distinguishes paths and query strings', () => {
    expect(getPageKey('https://example.com/a')).not.toBe(getPageKey('https://example.com/b'));
    expect(getPageKey('https://example.com/a?page=1')).not.toBe(
      getPageKey('https://example.com/a?page=2'),
    );
  });

  it('returns an unparseable href unchanged', () => {
    expect(getPageKey('not a url')).toBe('not a url');
  });
});

describe('storage keys', () => {
  it('keeps the per-tab index key stable', () => {
    expect(getPanelSnapshotStorageKey(7)).toBe('session:panel-snapshots-7');
  });

  it('gives every (tab, page) its own payload key', () => {
    const a = getPanelPageSnapshotStorageKey(7, 'https://example.com/a');
    const b = getPanelPageSnapshotStorageKey(7, 'https://example.com/b');

    expect(a).not.toBe(b);
    expect(a).toBe('session:panel-snapshot-page-7-https://example.com/a');
    // Only the first colon separates the storage area, so the URL (with its
    // own colons and slashes) survives as part of the key.
    expect(a.startsWith('session:')).toBe(true);
  });
});

describe('parsePanelSnapshotIndex', () => {
  it('reads anything that is not the current shape as empty', () => {
    expect(parsePanelSnapshotIndex(null)).toEqual({ pages: [] });
    expect(parsePanelSnapshotIndex('nope')).toEqual({ pages: [] });
    expect(parsePanelSnapshotIndex({})).toEqual({ pages: [] });
    expect(parsePanelSnapshotIndex({ pages: 'nope' })).toEqual({ pages: [] });
  });

  it('rejects the single-map layout written by older builds', () => {
    // Without this the old value would be read as an index and the panel would
    // try to restore a "page" named after the URL of another page's snapshot.
    expect(
      parsePanelSnapshotIndex({
        'https://example.com/a': { open: true, messages: [], updatedAt: 1 },
      }),
    ).toEqual({ pages: [] });
  });

  it('drops malformed entries and defaults a missing timestamp', () => {
    const index = parsePanelSnapshotIndex({
      pages: [
        { pageKey: 'a', updatedAt: 5 },
        { pageKey: '', updatedAt: 1 },
        { pageKey: 3 },
        null,
        { pageKey: 'b' },
      ],
    });

    expect(index.pages).toEqual([
      { pageKey: 'a', updatedAt: 5 },
      { pageKey: 'b', updatedAt: 0 },
    ]);
  });
});

describe('applyPanelSnapshotIndexPatch', () => {
  it('adds a page and refreshes an existing one without duplicating it', () => {
    const first = applyPanelSnapshotIndexPatch({ pages: [] }, 'a', 1);
    expect(first).toEqual({ index: { pages: [{ pageKey: 'a', updatedAt: 1 }] }, evicted: [] });

    const second = applyPanelSnapshotIndexPatch(first.index, 'a', 2);
    expect(second.index.pages).toEqual([{ pageKey: 'a', updatedAt: 2 }]);
    expect(second.evicted).toEqual([]);
  });

  it('evicts the least recently updated page beyond the per-tab cap', () => {
    let index: PanelSnapshotIndex = { pages: [] };
    for (let i = 0; i < MAX_PANEL_SNAPSHOTS_PER_TAB; i += 1) {
      index = applyPanelSnapshotIndexPatch(index, `page-${i}`, i).index;
    }

    const { index: next, evicted } = applyPanelSnapshotIndexPatch(index, 'new', 100);

    expect(evicted).toEqual(['page-0']);
    expect(next.pages).toHaveLength(MAX_PANEL_SNAPSHOTS_PER_TAB);
    expect(next.pages.some((page) => page.pageKey === 'page-0')).toBe(false);
  });

  it('never evicts the page it was just asked to record', () => {
    // A backwards clock (or a snapshot restored with an old timestamp) must not
    // make a save delete the payload it just wrote.
    const index: PanelSnapshotIndex = {
      pages: Array.from({ length: MAX_PANEL_SNAPSHOTS_PER_TAB }, (_, i) => ({
        pageKey: `page-${i}`,
        updatedAt: 1_000 + i,
      })),
    };

    const { index: next, evicted } = applyPanelSnapshotIndexPatch(index, 'stale', 1);

    expect(evicted).not.toContain('stale');
    expect(next.pages.some((page) => page.pageKey === 'stale')).toBe(true);
  });
});

describe('applyPanelSnapshotPatch', () => {
  it('creates an empty snapshot and applies the patch to it', () => {
    const next = applyPanelSnapshotPatch(undefined, { open: true }, 10);
    expect(next).toEqual({ open: true, messages: [], updatedAt: 10 });
  });

  it('leaves the open state unset when only messages were saved', () => {
    // The panel may have been opened by the "open by default" setting rather
    // than by the user; recording `open: false` here would override it.
    const next = applyPanelSnapshotPatch(
      undefined,
      { messages: [message('assistant', 'hi')] },
      1,
    );
    expect(next.open).toBeUndefined();
  });

  it('merges the open flag and messages written by separate patches', () => {
    let snapshot = applyPanelSnapshotPatch(undefined, { open: true }, 1);
    snapshot = applyPanelSnapshotPatch(snapshot, { messages: [message('assistant', 'hi')] }, 2);
    expect(snapshot.open).toBe(true);
    expect(snapshot.messages).toHaveLength(1);

    snapshot = applyPanelSnapshotPatch(snapshot, { open: false }, 3);
    expect(snapshot.open).toBe(false);
    expect(snapshot.messages).toHaveLength(1);
  });

  it('keeps only assistant messages, dropping the prompt that carries the page text', () => {
    const next = applyPanelSnapshotPatch(
      undefined,
      {
        messages: [
          message('system', 'system prompt'),
          message('user', 'full page text'),
          message('assistant', 'summary'),
        ],
      },
      1,
    );
    expect(next.messages.map((m) => m.role)).toEqual(['assistant']);
  });

  it('does not mutate the previous snapshot', () => {
    const previous: PanelSnapshot = { open: true, messages: [], updatedAt: 1 };
    applyPanelSnapshotPatch(previous, { open: false }, 2);
    expect(previous).toEqual({ open: true, messages: [], updatedAt: 1 });
  });

  it('truncates an oversized text part and marks the cut', () => {
    const long = 'a'.repeat(MAX_PANEL_MESSAGE_PART_CHARS + 100);
    const next = applyPanelSnapshotPatch(
      undefined,
      { messages: [message('assistant', long)] },
      1,
    );

    const part = next.messages[0].parts[0];
    expect(part.type).toBe('text');
    if (part.type !== 'text') throw new Error('expected a text part');
    expect(part.text.length).toBe(MAX_PANEL_MESSAGE_PART_CHARS);
    expect(part.text).toBe(
      `${'a'.repeat(
        MAX_PANEL_MESSAGE_PART_CHARS - PANEL_SNAPSHOT_TRUNCATION_MARKER.length,
      )}${PANEL_SNAPSHOT_TRUNCATION_MARKER}`,
    );
  });

  it('truncates an oversized reasoning part too', () => {
    const long = 'r'.repeat(MAX_PANEL_MESSAGE_PART_CHARS + 1);
    const next = applyPanelSnapshotPatch(
      undefined,
      {
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            parts: [{ type: 'reasoning', text: long }],
          },
        ],
      },
      1,
    );

    const part = next.messages[0].parts[0];
    expect(part.type).toBe('reasoning');
    if (part.type !== 'reasoning') throw new Error('expected a reasoning part');
    expect(part.text.endsWith(PANEL_SNAPSHOT_TRUNCATION_MARKER)).toBe(true);
    expect(part.text.length).toBe(MAX_PANEL_MESSAGE_PART_CHARS);
  });

  it('leaves a part at the cap untouched', () => {
    const exact = 'a'.repeat(MAX_PANEL_MESSAGE_PART_CHARS);
    const next = applyPanelSnapshotPatch(
      undefined,
      { messages: [message('assistant', exact)] },
      1,
    );

    const part = next.messages[0].parts[0];
    if (part.type !== 'text') throw new Error('expected a text part');
    expect(part.text).toBe(exact);
  });
});

describe('fitPanelSnapshotToSize', () => {
  it('drops the oldest messages until the snapshot fits, keeping the newest', () => {
    const messages = [1, 2, 3, 4].map((i) =>
      message('assistant', `summary-${i} `.repeat(20), `assistant-${i}`),
    );

    const fitted = fitPanelSnapshotToSize({ messages, updatedAt: 1 }, 200);

    expect(fitted.messages.length).toBeLessThan(messages.length);
    expect(fitted.messages[fitted.messages.length - 1]?.id).toBe('assistant-4');
    expect(JSON.stringify(fitted).length).toBeLessThan(
      JSON.stringify({ messages, updatedAt: 1 }).length,
    );
  });

  it('keeps the last message even when it alone exceeds the cap', () => {
    const messages = [message('assistant', 'x'.repeat(100), 'only')];
    const fitted = fitPanelSnapshotToSize({ messages, updatedAt: 1 }, 10);

    expect(fitted.messages).toHaveLength(1);
    expect(fitted.messages[0].id).toBe('only');
  });
});
