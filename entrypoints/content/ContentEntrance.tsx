import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import RightFloatingBallContainer from '@/components/container/RightFloatingBallContainer';
import useWxtStorage from '@/hooks/useWxtStorage';
import { getUiMessages } from '@/lib/i18n';
import { onMessage, sendMessage } from '@/lib/messaging';
import { PanelContainer } from '@/components/container/PanelContainer';
import { ContentAppFrame } from '@/entrypoints/content/summary/ContentAppFrame';
import iconUrl from '@/assets/16.png';
import { ThemeProvider } from '@/components/theme-provider';
import { GENERAL_SETTING_DEFINITIONS } from '@/constants/general-settings';
import { loadGeneralSettings } from '@/lib/general-settings-storage';
import { setCurrentPageSelection } from '@/lib/page-selection';
import { getPageKey, type PanelSnapshotPatch } from '@/lib/panel-snapshot';

import { createLogger } from '@/lib/logger';

const logger = createLogger('content:ContentEntrance');

function savePanelSnapshot(pageKey: string, patch: PanelSnapshotPatch) {
  sendMessage('savePanelSnapshot', { pageKey, patch }).catch((e) =>
    logger.warn('[ContentEntrance] Failed to save the panel snapshot', e),
  );
}

export function ContentEntrance({ ctx }: { ctx: ContentScriptContext }) {
  const [enableFloatingBall, setEnableFloatingBall] = useWxtStorage<boolean>(
    GENERAL_SETTING_DEFINITIONS.enableFloatingBall.storageKey,
    GENERAL_SETTING_DEFINITIONS.enableFloatingBall.defaultValue as boolean
  );

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
  // An explicit open (context menu, popup, floating ball) that lands while the
  // snapshot is still loading must not be undone by the restore.
  const openedExplicitlyRef = useRef(false);

  const messages = getUiMessages();

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
    pageMessagesRef.current.set(key, latest);
    savePanelSnapshot(key, { messages: latest });
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

      {/* Floating Ball Trigger — shown only when main panel is closed */}
      {enableFloatingBall && !mainPanelOpen && (
        <RightFloatingBallContainer
          storageKey="page"
          onClose={() => setEnableFloatingBall(false)}
        >
          <div
            onClick={() => setPanelOpen(true)}
            className="relative flex items-center justify-center p-1.5 rounded-full border border-primary/20 bg-card/80 hover:bg-accent hover:border-primary/40 transition-all duration-200 shadow-sm cursor-pointer group"
            title={messages.content.badgeLabel}
          >
            <img
              src={iconUrl}
              alt="Logo"
              className="w-6 h-6 rounded-md select-none pointer-events-none"
              draggable={false}
            />

            {/* Premium Tooltip on hover */}
            <div className="absolute right-12 top-1/2 -translate-y-1/2 rounded bg-zinc-900/90 px-2 py-1 text-[11px] font-medium text-white opacity-0 group-hover:opacity-100 scale-95 group-hover:scale-100 transition-all duration-200 pointer-events-none whitespace-nowrap shadow-md">
              {messages.content.badgeLabel}
            </div>
          </div>
        </RightFloatingBallContainer>
      )}
    </ThemeProvider>
  );
}
