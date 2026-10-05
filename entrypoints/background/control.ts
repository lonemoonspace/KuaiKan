import { onMessage, sendMessage } from '@/lib/messaging';
import { loadGeneralSettings } from '@/lib/general-settings-storage';
import { isTrustedSender } from '@/lib/background-trust';
import { storage } from '#imports';
import { browser, type Browser } from 'wxt/browser';
import { sleep } from 'radash';
import { GENERAL_SETTING_DEFINITIONS } from '@/constants/general-settings';
import { getUiMessages } from '@/lib/i18n';

import { createLogger } from '@/lib/logger';

const logger = createLogger('background:control');

export function registerControlMessages() {
  onMessage('openOptionPage', async (msg) => {
    if (!isTrustedSender(msg.sender)) return;

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

/**
 * Pages no content script can run on. Asking the tab whether it is alive would
 * only burn the retry budget (~2.3s) before failing, so these are recognised up
 * front.
 *
 * `file:` is deliberately NOT in this list: a `file://` page works fine once
 * the user grants "Allow access to file URLs", and there is no synchronous way
 * to ask whether that toggle is on. When it is off, the very first probe fails
 * with an injection-forbidden error, which the retry loop below already treats
 * as final -- so the cost of trying is one probe, and the gain is that local
 * pages can be summarized at all.
 */
function isUnsupportedPageUrl(url: string | undefined): boolean {
  if (!url) return false;

  return (
    /^(chrome|edge|brave|about|devtools|view-source|chrome-extension|moz-extension):/i.test(
      url,
    ) ||
    /^https?:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url)
  );
}

function isInjectionForbidden(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot access|cannot be scripted|extensions gallery|missing host permission|no tab with id|could not establish connection|receiving end does not exist/i.test(
    message,
  );
}

export async function activePageAndInvokeSummary(tab: Browser.tabs.Tab) {
  if (!tab.id) return;

  let contentScriptReady = false;
  // Give heavy pages (large DOM / SVG-heavy) more time to load the content
  // script: ten probes spanning ~2.3s instead of 500ms. Only the retries sleep
  // — when this is triggered from the context menu the content script is
  // usually already there, so an unconditional first wait would add 250ms of
  // pure latency to every trigger.
  //
  // This probes with `ping` rather than `scripting.executeScript`: the content
  // script answers only once it is loaded, which is the same question, and it
  // lets the extension drop the `scripting` permission.
  if (!isUnsupportedPageUrl(tab.url)) {
    for (let i = 0; i < 10; i++) {
      if (i > 0) await sleep(250);
      try {
        const result = await sendMessage('ping', undefined, { tabId: tab.id });
        if (result?.ok) {
          contentScriptReady = true;
          break;
        }
      } catch (e) {
        logger.warn('[activePageAndInvokeSummary] ping failed', e);
        // Restricted pages reject every probe identically; retrying only burns
        // ~2s.
        if (isInjectionForbidden(e)) break;
      }
    }
  }

  if (contentScriptReady) {
    const settings = await loadGeneralSettings();
    const beginSummary = settings.enableAutoBeginSummaryByActionOrContextTrigger;
    sendMessage('invokeSummary', { beginSummary }, { tabId: tab.id }).catch(e => {
      logger.warn('[activePageAndInvokeSummary] sendMessage failed', e);
    });
  } else {
    logger.error("Cannot reach the content script on this page, check if the extension is enabled on it.");
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
 *
 * Anything that is not one of our own options paths falls back to the settings
 * root. The message carries a URL that ends up in `tabs.create`, so passing an
 * absolute one through would make this an open redirect (a page-influenced
 * caller could open an arbitrary site under the extension's action).
 */
function resolveOptionsUrl(target: string): string {
  return target.startsWith('/options.html')
    ? browser.runtime.getURL(target as `/options.html${string}`)
    : browser.runtime.getURL('/options.html#/');
}
