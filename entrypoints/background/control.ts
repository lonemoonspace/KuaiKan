import { onMessage, sendMessage } from '@/lib/messaging';
import { loadGeneralSettings } from '@/lib/general-settings-storage';
import { storage } from '#imports';
import { browser, type Browser } from 'wxt/browser';
import { sleep } from 'radash';
import { GENERAL_SETTING_DEFINITIONS } from '@/constants/general-settings';
import { getUiMessages } from '@/lib/i18n';

import { createLogger } from '@/lib/logger';

const logger = createLogger('background:control');

export function registerControlMessages() {
  onMessage('openOptionPage', async (msg) => {
    logger.debug('[openOptionPage]', msg.data);
    try {
      await browser.tabs.create({ url: resolveOptionsUrl(msg.data) });
    } catch (e) {
      // Logged here because the caller cannot see this: every call site fires
      // the message and forgets it.
      logger.error('[openOptionPage] Failed to open the options page', e);
    }
  });

  // Context menus are only built at service-worker startup; rebuild them live
  // when the relevant toggle changes.
  const rebuildContextMenus = () => {
    addContextMenus().catch((e) => {
      logger.error('[contextMenu] Live rebuild failed', e);
    });
  };
  storage.watch(
    GENERAL_SETTING_DEFINITIONS.enableContextMenuSummarizeThisPage.storageKey,
    rebuildContextMenus,
  );
}

function isInjectionForbidden(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot access|cannot be scripted|extensions gallery|missing host permission|no tab with id/i.test(
    message,
  );
}

export async function activePageAndInvokeSummary(tab: Browser.tabs.Tab) {
  if (!tab.id) return;
  
  let shadowRootExist = false;
  // Give heavy pages (large DOM / SVG-heavy) more time to mount the shadow
  // root: ten probes spanning ~2.3s instead of 500ms. Only the retries sleep —
  // when this is triggered from the context menu the panel is usually already
  // mounted, so an unconditional first wait would add 250ms of pure latency to
  // every trigger.
  for (let i = 0; i < 10; i++) {
    if (i > 0) await sleep(250);
    try {
      const result = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return !!document.querySelector('webpage-summary-entrance')?.shadowRoot;
        },
      });
      shadowRootExist = Boolean(result?.[0]?.result);
      if (shadowRootExist) {
        break;
      }
    } catch (e) {
      logger.warn('[activePageAndInvokeSummary] script execution failed', e);
      // Restricted pages (chrome://, the web store, unauthorized sites) reject
      // every injection identically; retrying only burns ~2s.
      if (isInjectionForbidden(e)) break;
    }
  }

  if (shadowRootExist) {
    const settings = await loadGeneralSettings();
    const beginSummary = settings.enableAutoBeginSummaryByActionOrContextTrigger;
    sendMessage('invokeSummary', { beginSummary }, { tabId: tab.id }).catch(e => {
      logger.warn('[activePageAndInvokeSummary] sendMessage failed', e);
    });
  } else {
    logger.error("Cannot find webpage-summary-entrance shadow root, check if extension is enabled on this page.");
  }
}

export async function addContextMenus() {
  const settings = await loadGeneralSettings();
  const messages = getUiMessages();

  await browser.contextMenus.removeAll();

  if (settings.enableContextMenuSummarizeThisPage) {
    logger.debug('[contextMenu] adding summarize-this-page');
    try {
      await browser.contextMenus.create({
        id: 'summarize-this-page',
        title: messages.common.contextMenu.summarizeThisPage,
        contexts: ['page', 'action'],
      });
    } catch (e) {
      logger.error('[contextMenu] Failed to create summarize-this-page menu', e);
    }
  }

  // Open settings context menu
  try {
    await browser.contextMenus.create({
      id: 'open-setting',
      title: messages.common.contextMenu.openSetting,
      contexts: ['action'],
    });
  } catch (e) {
    logger.error('[contextMenu] Failed to create open-setting menu', e);
  }
}

// Set up event listeners for context menu clicks
export function initializeControlHandlers() {
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    logger.debug('[contextMenu] onClicked, menuItemId:', info.menuItemId);
    if (info.menuItemId === 'summarize-this-page' && tab) {
      activePageAndInvokeSummary(tab).catch((e) =>
        logger.error('[contextMenu] Failed to invoke the summary', e),
      );
    }

    if (info.menuItemId === 'open-setting') {
      void browser.tabs
        .create({ url: resolveOptionsUrl('/options.html#/') })
        .catch((e) => logger.error('[contextMenu] Failed to open the settings page', e));
    }

  });
}

/**
 * Callers pass extension-root-relative paths (e.g. '/options.html#/models').
 * Resolve them against the extension origin here so every entry point that
 * opens a settings page (the `openOptionPage` message and the context menu)
 * hands `tabs.create` the same absolute URL.
 */
function resolveOptionsUrl(target: string): string {
  return target.startsWith('/')
    ? browser.runtime.getURL(target as `/options.html${string}`)
    : target;
}
