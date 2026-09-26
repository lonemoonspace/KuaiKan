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

  const ui = await createShadowRootUi<Root>(ctx, {
    name: 'webpage-summary-entrance',
    position: 'overlay',
    alignment: 'bottom-right',
    anchor: 'body',
    append: 'last',
    zIndex: 2147483647,
    onMount(container) {
      const root = createRoot(container);
      root.render(createElement(ContentEntrance, { ctx }));
      return root;
    },
    onRemove(root) {
      root?.unmount();
    },
  });

  ui.mount();
}

export async function mountContentScope(ctx: ContentScriptContext) {
  const messages = getUiMessages();

  try {
    await mountSummaryBadge(ctx);
  } catch (e) {
    logger.error('[ContentScope] Failed to mount summary badge', e);
  }

  onMessage('ping', () => {
    return Promise.resolve({
      ok: true,
      title: document.title || messages.content.untitledPage,
      url: location.href,
      textLength: collectPageTextLength(),
    });
  });

  onMessage('extractText', async () => {
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
}
