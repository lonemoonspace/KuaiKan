import { storage } from '#imports';
import { browser } from 'wxt/browser';
import { onMessage } from '@/lib/messaging';
import { isTrustedSender } from '@/lib/background-trust';
import {
  applyPanelSnapshotPatch,
  getPanelSnapshotStorageKey,
  type PanelSnapshotMap,
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

  const readSnapshots = async (tabId: number) =>
    (await storage.getItem<PanelSnapshotMap>(getPanelSnapshotStorageKey(tabId))) ?? {};

  onMessage('loadPanelSnapshot', ({ data, sender }) => {
    if (!isTrustedSender(sender)) return null;

    const tabId = sender.tab?.id;
    if (tabId === undefined) return null;

    return serialize(async () => (await readSnapshots(tabId))[data.pageKey] ?? null);
  });

  onMessage('savePanelSnapshot', ({ data, sender }) => {
    if (!isTrustedSender(sender)) return;

    const tabId = sender.tab?.id;
    if (tabId === undefined) return;

    return serialize(async () => {
      const next = applyPanelSnapshotPatch(
        await readSnapshots(tabId),
        data.pageKey,
        data.patch,
        Date.now(),
      );
      await storage.setItem(getPanelSnapshotStorageKey(tabId), next);
    }).catch((e) => logger.error('[panel-snapshot] Failed to save', e));
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void serialize(() => storage.removeItem(getPanelSnapshotStorageKey(tabId))).catch((e) =>
      logger.error('[panel-snapshot] Failed to clear a closed tab', e),
    );
  });
}
