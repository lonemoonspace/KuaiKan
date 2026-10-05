import { storage } from '#imports';
import { browser } from 'wxt/browser';
import { onMessage } from '@/lib/messaging';
import { isTrustedSender } from '@/lib/background-trust';
import {
  applyPanelSnapshotIndexPatch,
  applyPanelSnapshotPatch,
  getPanelPageSnapshotStorageKey,
  getPanelSnapshotStorageKey,
  parsePanelSnapshotIndex,
  type PanelSnapshot,
  type PanelSnapshotIndex,
} from '@/lib/panel-snapshot';

import { createLogger } from '@/lib/logger';

const logger = createLogger('background:panel-snapshot');

// Content scripts do not know their own tab id, and `storage.session` is not
// exposed to them by default, so every read and write goes through here with
// the tab id taken from the message sender.
export function registerPanelSnapshotMessages() {
  // The open flag and the messages are saved by separate calls that can
  // arrive back to back; running each read-modify-write to completion before
  // the next keeps one from overwriting the other.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };

  // The per-tab index is tiny (one entry per visited page). The summaries
  // themselves live under one key each, so a save rewrites a single page
  // instead of the whole tab's history -- the previous single-map layout's
  // write size grew with every page the tab had visited.
  const readIndex = async (tabId: number): Promise<PanelSnapshotIndex> =>
    parsePanelSnapshotIndex(
      await storage.getItem<unknown>(getPanelSnapshotStorageKey(tabId)),
    );

  onMessage('loadPanelSnapshot', ({ data, sender }) => {
    if (!isTrustedSender(sender)) return null;

    const tabId = sender.tab?.id;
    if (tabId === undefined) return null;

    return serialize(async () => {
      const index = await readIndex(tabId);
      if (!index.pages.some((page) => page.pageKey === data.pageKey)) {
        return null;
      }

      return (
        (await storage.getItem<PanelSnapshot>(
          getPanelPageSnapshotStorageKey(tabId, data.pageKey),
        )) ?? null
      );
    });
  });

  onMessage('savePanelSnapshot', ({ data, sender }) => {
    if (!isTrustedSender(sender)) return;

    const tabId = sender.tab?.id;
    if (tabId === undefined) return;

    return serialize(async () => {
      const now = Date.now();
      const { index, evicted } = applyPanelSnapshotIndexPatch(
        await readIndex(tabId),
        data.pageKey,
        now,
      );
      const pageStorageKey = getPanelPageSnapshotStorageKey(tabId, data.pageKey);
      const previous = await storage.getItem<PanelSnapshot>(pageStorageKey);

      // `applyPanelSnapshotPatch` also bounds the payload's size.
      await storage.setItem(
        pageStorageKey,
        applyPanelSnapshotPatch(previous, data.patch, now),
      );
      await storage.setItem(getPanelSnapshotStorageKey(tabId), index);

      // Remove evicted pages only after the index stopped referencing them, so
      // a failed removal can leak a key but can never drop a live snapshot.
      await Promise.all(
        evicted.map((pageKey) =>
          storage.removeItem(getPanelPageSnapshotStorageKey(tabId, pageKey)),
        ),
      );
    }).catch((e) => logger.error('[panel-snapshot] Failed to save', e));
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void serialize(async () => {
      const index = await readIndex(tabId);
      await Promise.all([
        storage.removeItem(getPanelSnapshotStorageKey(tabId)),
        ...index.pages.map((page) =>
          storage.removeItem(getPanelPageSnapshotStorageKey(tabId, page.pageKey)),
        ),
      ]);
    }).catch((e) =>
      logger.error('[panel-snapshot] Failed to clear a closed tab', e),
    );
  });
}
