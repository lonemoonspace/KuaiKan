import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { getUiMessages } from '@/lib/i18n';
import { loadGeneralSettings } from '@/lib/general-settings-storage';
import { parsePageContent, textsBySelectors } from '@/lib/page-extraction';
import {
  findMatchingCustomization,
  isUrlAllowed,
  loadSiteRules,
} from '@/lib/site-rules-storage';
import { ContentEntrance } from './ContentEntrance';

import { onMessage } from '@/lib/messaging';
import { createLogger } from '@/lib/logger';

const logger = createLogger('content:scope');



function collectPageTextLength() {
  return document.body?.innerText.trim().length ?? 0;
}

async function mountSummaryBadge(ctx: ContentScriptContext) {
  // logger.info('[ContentScope] mountSummaryBadge running');
  // The host element created by createShadowRootUi is a <webpage-summary-entrance>
  // element; guarding against that tag (rather than a light-DOM id that is
  // never set) makes the duplicate-mount check real.
  if (document.querySelector('webpage-summary-entrance')) {
    // logger.info('[ContentScope] host already exists, skipping');
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
      // logger.info('[ContentScope] UI container mounted, rendering React root');
      const root = createRoot(container);
      root.render(createElement(ContentEntrance));
      return root;
    },
    onRemove(root) {
      // logger.info('[ContentScope] UI container unmounted');
      root?.unmount();
    },
  });

  ui.mount();
  // logger.info('[ContentScope] ui.mount() called');
}

export async function mountContentScope(ctx: ContentScriptContext) {
  // logger.info('[ContentScope] mountContentScope called');
  const messages = getUiMessages();

  let urlAllowed = true;
  try {
    const { whitelist, blacklist } = await loadSiteRules();
    urlAllowed = isUrlAllowed(location, whitelist, blacklist);
  } catch (e) {
    logger.error('[ContentScope] Failed to load site rules; treating page as allowed', e);
  }

  if (urlAllowed) {
    try {
      await mountSummaryBadge(ctx);
    } catch (e) {
      logger.error('[ContentScope] Failed to mount summary badge', e);
    }
  } else {
    // logger.info('[ContentScope] site rules blocked UI mount for', location.hostname);
  }

  onMessage('ping', () => {
    return Promise.resolve({
      ok: urlAllowed,
      title: document.title || messages.content.untitledPage,
      url: location.href,
      textLength: collectPageTextLength(),
    });
  });

  onMessage('extractText', async () => {
    if (!urlAllowed) {
      // Keep whitelist/blacklist semantics consistent: a disabled site must
      // not answer content-extraction requests either.
      return { ok: false, error: 'Extension is disabled on this site.' };
    }
    try {
      const [settings, { siteCustomization }] = await Promise.all([
        loadGeneralSettings(),
        loadSiteRules(),
      ]);

      const matchedRule = findMatchingCustomization(location, siteCustomization);
      // logger.info('matchedRule',matchedRule)
      const extracted = matchedRule
        ? textsBySelectors(
            matchedRule.selectors,
            {
              shadowRootSelectors: matchedRule.shadowRootSelectors,
              useShadowRoot: matchedRule.useShadowRoot,
            },
            document,
          )
        : parsePageContent(settings.pageTextExtractMethod, document);

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
