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
    // Callers pass extension-root-relative paths (e.g. '/options.html#/models');
    // resolve them against the extension origin so tabs.create always gets an
    // absolute URL.
    // Callers pass extension-root-relative options paths
    // (e.g. '/options.html#/models'); resolve them against the extension
    // origin so tabs.create always gets an absolute URL.
    const url: string =
      typeof msg.data === 'string' && msg.data.startsWith('/')
        ? browser.runtime.getURL(msg.data as `/options.html${string}`)
        : msg.data;
    return void browser.tabs.create({ url });
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

export async function activePageAndInvokeSummary(tab: Browser.tabs.Tab) {
  if (!tab.id) return;
  
  let shadowRootExist = false;
  // Give heavy pages (large DOM / SVG-heavy) more time to mount the shadow
  // root: up to 2.5s instead of 500ms.
  for (let i = 0; i < 10; i++) {
    await sleep(250);
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
      activePageAndInvokeSummary(tab);
    }

    if (info.menuItemId === 'open-setting') {
      browser.tabs.create({ url: '/options.html#/' });
    }

  });
}
