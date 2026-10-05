import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { onMessage, sendMessage } from '@/lib/messaging';
import { PanelContainer } from '@/components/container/PanelContainer';
import { ContentAppFrame } from '@/entrypoints/content/summary/ContentAppFrame';
import { ThemeProvider } from '@/components/theme-provider';
import { loadGeneralSettings } from '@/lib/general-settings-storage';
import { setCurrentPageSelection } from '@/lib/page-selection';
import { getPageKey, persistableMessages, type PanelSnapshotPatch } from '@/lib/panel-snapshot';

import { createLogger } from '@/lib/logger';

const logger = createLogger('content:ContentEntrance');

function savePanelSnapshot(pageKey: string, patch: PanelSnapshotPatch) {
  sendMessage('savePanelSnapshot', { pageKey, patch }).catch((e) =>
    logger.warn('[ContentEntrance] Failed to save the panel snapshot', e),
  );
}

export function ContentEntrance({ ctx }: { ctx: ContentScriptContext }) {
  const [mainPanelOpen, setMainPanelOpen] = useState(false);
  // A pending "summarize now" request, bound to the page it was made on and
  // cleared once the frame picks it up, so a frame that mounts later (another
  // page, or the panel reopened) never replays it.
  const [summaryRequest, setSummaryRequest] = useState<{ pageKey: string; id: number } | null>(null);
  const summaryRequestIdRef = useRef(0);

  // Panel state is remembered per page of this tab: navigating to another
  // page (a single-page-app route or a full load) shows that page's own state,
  // and coming back restores the panel and the summary it held.
  const [pageKey, setPageKey] = useState(() => getPageKey(window.location.href));
  const pageKeyRef = useRef(pageKey);
  pageKeyRef.current = pageKey;
  // The summary frame is mounted only once this page's snapshot is known, so
  // it starts from the restored messages instead of an empty chat.
  const [restoredPageKey, setRestoredPageKey] = useState<string | null>(null);
  // Latest summary per page, so reopening a closed panel shows it again.
  const pageMessagesRef = useRef(new Map<string, UIMessage[]>());
  // An explicit open (context menu, popup) that lands while the
  // snapshot is still loading must not be undone by the restore.
  const openedExplicitlyRef = useRef(false);

  const setPanelOpen = useCallback((open: boolean) => {
    openedExplicitlyRef.current = open;
    setMainPanelOpen(open);
    savePanelSnapshot(pageKeyRef.current, { open });
  }, []);

  useEffect(() => {
    // WXT removes the listener itself when the content script is invalidated
    // (it overrides any signal passed in), so the flag only guards unmount.
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    ctx.addEventListener(window, 'wxt:locationchange', () => {
      // With the Navigation API this fires before the new URL commits — and
      // also for link downloads that never leave the page — so read the
      // committed URL once the navigation event has been handled.
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active) return;
        const key = getPageKey(window.location.href);
        if (key === pageKeyRef.current) return;
        openedExplicitlyRef.current = false;
        pageKeyRef.current = key;
        setPageKey(key);
      }, 0);
    });

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ctx]);

  useEffect(() => {
    let active = true;

    Promise.all([
      sendMessage('loadPanelSnapshot', { pageKey }).catch((e) => {
        logger.warn('[ContentEntrance] Failed to load the panel snapshot', e);
        return null;
      }),
      loadGeneralSettings(),
    ])
      .then(([snapshot, settings]) => {
        if (!active) return;
        if (snapshot) pageMessagesRef.current.set(pageKey, snapshot.messages);
        // Only an explicit open/close is stored; otherwise the setting decides.
        const open = snapshot?.open ?? settings.enableSummaryWindowDefault;
        setMainPanelOpen(open || openedExplicitlyRef.current);
      })
      .catch((e) => logger.error('[ContentEntrance] Failed to restore the panel', e))
      .finally(() => {
        if (active) setRestoredPageKey(pageKey);
      });

    return () => {
      active = false;
    };
  }, [pageKey]);

  const handleBeginSummaryHandled = useCallback(() => setSummaryRequest(null), []);

  const handlePersistMessages = useCallback((key: string, latest: UIMessage[]) => {
    // Keep only the assistant messages in memory as well as on disk. The system
    // and user messages carry the rendered prompt with the whole page text, so
    // holding them here would leave a copy of every summarized article resident
    // for the lifetime of this tab -- and would also make an in-memory restore
    // behave differently from a snapshot restore.
    const keep = persistableMessages(latest);
    pageMessagesRef.current.set(key, keep);
    savePanelSnapshot(key, { messages: keep });
  }, []);

  useEffect(() => {
    const unbindInvoke = onMessage('invokeSummary', (msg) => {
      // Page changes are picked up asynchronously, so a trigger right after
      // navigating can beat them; resolve the page here so the request lands
      // on the right one.
      const key = getPageKey(window.location.href);
      pageKeyRef.current = key;
      setPageKey(key);
      setPanelOpen(true);
      if (msg.data?.beginSummary) {
        summaryRequestIdRef.current += 1;
        setSummaryRequest({ pageKey: key, id: summaryRequestIdRef.current });
      }
    });

    return () => {
      unbindInvoke();
    };
  }, [setPanelOpen]);

  // Track page selections live so {{currentSelection}} in prompt templates
  // reflects the text the user had selected when the summary was triggered.
  // Clicks inside our own shadow UI collapse the document selection (the
  // panel is an overlay, so any button press deselects the page text before
  // the click handler runs). Pointerdown events originating in the shadow
  // host are therefore not treated as "user cleared the selection".
  useEffect(() => {
    const suppressClearRef = { current: false };

    const pointerInsideShadowUI = (event: PointerEvent) => {
      const host = document.querySelector('webpage-summary-entrance');
      if (!host) return false;
      const target = event.target as Node | null;
      return host.contains(target) || host.shadowRoot?.contains(target) === true;
    };

    const updateSelection = () => {
      const text = document.getSelection()?.toString().trim() ?? '';
      if (!text) {
        if (suppressClearRef.current) {
          suppressClearRef.current = false;
          return;
        }
      }
      setCurrentPageSelection(text);
    };

    const onPointerDown = (event: PointerEvent) => {
      suppressClearRef.current = pointerInsideShadowUI(event);
    };

    updateSelection();
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('selectionchange', updateSelection);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('selectionchange', updateSelection);
    };
  }, []);

  // WXT appends the shadow host before React renders into it (mountUi runs
  // before onMount), so the lookup result can be cached instead of re-running
  // on every render. Only a hit is cached: a `null` is retried on the next
  // render, so a host that appears later is still picked up.
  const shadowHostRef = useRef<HTMLElement | null>(null);
  if (!shadowHostRef.current && typeof document !== 'undefined') {
    shadowHostRef.current = document.querySelector('webpage-summary-entrance') as HTMLElement | null;
  }
  const shadowHost = shadowHostRef.current;
  // logger.info('[ContentEntrance] document.querySelector("webpage-summary-entrance"):', shadowHost);

  return (
    <ThemeProvider container={shadowHost}>
      {/* Switchable summary panel layout — controller is shared from parent */}
      {
        mainPanelOpen && restoredPageKey === pageKey && (
          <PanelContainer storageKey="main-panel">
            <ContentAppFrame
              key={pageKey}
              beginSummaryRequest={summaryRequest?.pageKey === pageKey ? summaryRequest.id : 0}
              onBeginSummaryHandled={handleBeginSummaryHandled}
              initialMessages={pageMessagesRef.current.get(pageKey)}
              onPersistMessages={(latest) => handlePersistMessages(pageKey, latest)}
              onClose={() => setPanelOpen(false)}
            />
          </PanelContainer>
        )
      }
    </ThemeProvider>
  );
}
