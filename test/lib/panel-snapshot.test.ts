import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import {
  MAX_PANEL_SNAPSHOTS_PER_TAB,
  applyPanelSnapshotPatch,
  getPageKey,
  type PanelSnapshotMap,
} from '@/lib/panel-snapshot';

const message = (role: UIMessage['role'], text: string): UIMessage => ({
  id: `${role}-${text}`,
  role,
  parts: [{ type: 'text', text }],
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

describe('applyPanelSnapshotPatch', () => {
  it('creates an empty snapshot and applies the patch to it', () => {
    const next = applyPanelSnapshotPatch({}, 'a', { open: true }, 10);
    expect(next.a).toEqual({ open: true, messages: [], updatedAt: 10 });
  });

  it('leaves the open state unset when only messages were saved', () => {
    // The panel may have been opened by the "open by default" setting rather
    // than by the user; recording `open: false` here would override it.
    const next = applyPanelSnapshotPatch({}, 'a', { messages: [message('assistant', 'hi')] }, 1);
    expect(next.a.open).toBeUndefined();
  });

  it('merges the open flag and messages written by separate patches', () => {
    let snapshots = applyPanelSnapshotPatch({}, 'a', { open: true }, 1);
    snapshots = applyPanelSnapshotPatch(snapshots, 'a', { messages: [message('assistant', 'hi')] }, 2);
    expect(snapshots.a.open).toBe(true);
    expect(snapshots.a.messages).toHaveLength(1);

    snapshots = applyPanelSnapshotPatch(snapshots, 'a', { open: false }, 3);
    expect(snapshots.a.open).toBe(false);
    expect(snapshots.a.messages).toHaveLength(1);
  });

  it('keeps only assistant messages, dropping the prompt that carries the page text', () => {
    const next = applyPanelSnapshotPatch(
      {},
      'a',
      {
        messages: [
          message('system', 'system prompt'),
          message('user', 'full page text'),
          message('assistant', 'summary'),
        ],
      },
      1,
    );
    expect(next.a.messages.map((m) => m.role)).toEqual(['assistant']);
  });

  it('does not mutate the input map', () => {
    const input: PanelSnapshotMap = {};
    applyPanelSnapshotPatch(input, 'a', { open: true }, 1);
    expect(input).toEqual({});
  });

  it('evicts the least recently updated pages beyond the per-tab cap', () => {
    let snapshots: PanelSnapshotMap = {};
    for (let i = 0; i < MAX_PANEL_SNAPSHOTS_PER_TAB; i += 1) {
      snapshots = applyPanelSnapshotPatch(snapshots, `page-${i}`, { open: true }, i);
    }
    // Touching the oldest page makes page-1 the least recently updated.
    snapshots = applyPanelSnapshotPatch(snapshots, 'page-0', { open: false }, 100);
    snapshots = applyPanelSnapshotPatch(snapshots, 'new', { open: true }, 101);

    expect(Object.keys(snapshots)).toHaveLength(MAX_PANEL_SNAPSHOTS_PER_TAB);
    // The touched page survived (with the flag it was touched with) and the
    // newest page entered; only the least-recently-updated one was evicted.
    expect(snapshots['page-0']).toEqual({
      open: false,
      messages: [],
      updatedAt: 100,
    });
    expect(snapshots['page-1']).toBeUndefined();
    expect(snapshots.new).toEqual({ open: true, messages: [], updatedAt: 101 });
  });
});
