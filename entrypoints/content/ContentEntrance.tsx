import React, { useEffect, useRef, useState } from 'react';
import RightFloatingBallContainer from '@/components/container/RightFloatingBallContainer';
import useWxtStorage from '@/hooks/useWxtStorage';
import { getUiMessages } from '@/lib/i18n';
import { onMessage } from '@/lib/messaging';
import { PanelContainer } from '@/components/container/PanelContainer';
import { ContentAppFrame } from '@/entrypoints/content/summary/ContentAppFrame';
import iconUrl from '@/assets/16.png';
import { ThemeProvider } from '@/components/theme-provider';
import { GENERAL_SETTING_DEFINITIONS } from '@/constants/general-settings';
import { setCurrentPageSelection } from '@/lib/page-selection';

export function ContentEntrance() {
  const [enableFloatingBall, setEnableFloatingBall] = useWxtStorage<boolean>(
    GENERAL_SETTING_DEFINITIONS.enableFloatingBall.storageKey,
    GENERAL_SETTING_DEFINITIONS.enableFloatingBall.defaultValue as boolean
  );

  const [enableSummaryWindowDefault] = useWxtStorage<boolean>(
    GENERAL_SETTING_DEFINITIONS.enableSummaryWindowDefault.storageKey,
    GENERAL_SETTING_DEFINITIONS.enableSummaryWindowDefault.defaultValue as boolean
  );

  const [mainPanelOpen, setMainPanelOpen] = useState(false);
  const [beginSummaryRequest, setBeginSummaryRequest] = useState(0);

  const messages = getUiMessages();

  useEffect(() => {
    if (enableSummaryWindowDefault) {
      setMainPanelOpen(true);
    }
  }, [enableSummaryWindowDefault]);

  useEffect(() => {
    const unbindInvoke = onMessage('invokeSummary', (msg) => {
      setMainPanelOpen(true);
        if (msg.data?.beginSummary) {
          setBeginSummaryRequest((request) => request + 1);
        }
    });

    return () => {
      unbindInvoke();
    };
  }, []);

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
        mainPanelOpen && (
          <PanelContainer storageKey="main-panel">
            <ContentAppFrame
              beginSummaryRequest={beginSummaryRequest}
              onClose={() => setMainPanelOpen(false)}
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
            onClick={() => setMainPanelOpen(true)}
            className="relative flex items-center justify-center p-1.5 rounded-full border border-purple-200/80 bg-purple-50/20 hover:bg-purple-100/70 hover:border-purple-300 transition-all duration-200 shadow-sm cursor-pointer group"
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
