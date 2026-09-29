import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { getUiMessages } from '@/lib/i18n';
import { loadGeneralSettings } from '@/lib/general-settings-storage';
import { parsePageContent } from '@/lib/page-extraction';
import { ContentEntrance } from './ContentEntrance';

import { onMessage } from '@/lib/messaging';
import { createLogger } from '@/lib/logger';

const logger = createLogger('content:scope');

function collectPageTextLength() {
  return document.body?.innerText.trim().length ?? 0;
}

async function mountSummaryBadge(ctx: ContentScriptContext) {
  // The host element created by createShadowRootUi is a <webpage-summary-entrance>
  // element; guarding against that tag (rather than a light-DOM id that is
  // never set) makes the duplicate-mount check real.
  if (document.querySelector('webpage-summary-entrance')) {
    return;
  }

  let host: HTMLElement | null = null;

  const ui = await createShadowRootUi<Root>(ctx, {
    name: 'webpage-summary-entrance',
    position: 'overlay',
    alignment: 'bottom-right',
    anchor: 'body',
    append: 'last',
    zIndex: 2147483647,
    onMount(container, _shadow, shadowHost) {
      host = shadowHost;
      const root = createRoot(container);
      root.render(createElement(ContentEntrance, { ctx }));
      return root;
    },
    onRemove(root) {
      root?.unmount();
    },
  });

  ui.mount();

  // The host is an ordinary child of <body>, so a page that clears or rebuilds
  // its body takes the panel with it — previously it stayed gone until the page
  // was reloaded. Watch for that and mount again from scratch; `remove()` first,
  // because a bare `mount()` would attach a second React root to the container
  // that still holds one.
  if (typeof MutationObserver !== 'undefined' && ctx.isValid) {
    const observer = new MutationObserver(() => {
      if (!ctx.isValid || host?.isConnected) return;
      ui.remove();
      ui.mount();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    // WXT removes the UI itself when the context is invalidated; without this
    // the observer would immediately resurrect a dead panel.
    ctx.onInvalidated(() => observer.disconnect());
  }
}

export async function mountContentScope(ctx: ContentScriptContext) {
  const messages = getUiMessages();

  try {
    await mountSummaryBadge(ctx);
  } catch (e) {
    logger.error('[ContentScope] Failed to mount summary badge', e);
  }

  const unbindPing = onMessage('ping', () => {
    return Promise.resolve({
      ok: true,
      title: document.title || messages.content.untitledPage,
      url: location.href,
      textLength: collectPageTextLength(),
    });
  });

  const unbindExtractText = onMessage('extractText', async () => {
    try {
      const settings = await loadGeneralSettings();
      const extracted = parsePageContent(settings.pageTextExtractMethod, document);

      return {
        ok: true,
        title: document.title || messages.content.untitledPage,
        url: location.href,
        text: extracted?.textContent ?? '',
      };
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? String(e) };
    }
  });

  // These are runtime-level listeners that WXT does not own, so an invalidated
  // context has to unbind them itself; otherwise a second injection into the
  // same document leaves both handlers registered and the dead one can answer.
  ctx.onInvalidated(() => {
    unbindPing();
    unbindExtractText();
  });
}
