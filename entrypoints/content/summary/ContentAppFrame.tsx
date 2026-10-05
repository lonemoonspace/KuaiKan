import React, { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { UIMessage } from 'ai';
import { browser } from 'wxt/browser';
import useWxtStorage from '@/hooks/useWxtStorage';
import { sendMessage as sendExtMessage } from '@/lib/messaging';
import {
  Check,
  ChevronRight,
  Copy,
  Info,
  RefreshCw,
  ScanEye,
  Settings,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { Toaster, toast } from 'sonner';

import {
  Message,
  MessageContent,
  MessageResponse,
  citationMarkersToQuotes,
} from '@/components/ai-elements/message';
import { copyText } from '@/lib/clipboard';

import { TokenViewerModal } from '@/components/TokenViewerModal';
import { useContentApp } from './useContentApp';
import { UsageDisplay } from './UsageDisplay';
import { ModelSelector } from './ModelSelector';
import { getUiMessages } from '@/lib/i18n';
import { getEffectiveInputTokenLimit } from '@/lib/input-token-limit';
import {
  GENERAL_SETTING_DEFINITIONS,
  PANEL_FONT_SIZE_REM_PX,
  type PanelFontSize,
  type SummaryInputExceedBehaviour,
} from '@/constants/general-settings';

import { createLogger } from '@/lib/logger';

const logger = createLogger('content:ContentAppFrame');

/** Copy button for the finished summary; flips to a check mark briefly. */
function CopySummaryButton({ text }: { text: string }) {
  const uiMessages = getUiMessages();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    try {
      await copyText(text);
      setCopied(true);
    } catch (e) {
      logger.warn('[ContentAppFrame] Copy failed', e);
      toast.error(uiMessages.content.copyFailed);
    }
  };

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={handleCopy}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? uiMessages.content.copied : uiMessages.content.copySummary}</span>
    </button>
  );
}

const formatTokens = (val: number) => {
  if (val >= 10000) {
    return Math.round(val / 1000) + 'k';
  }
  return val.toString();
};

/**
 * Collapsible model reasoning, closed by default. The <details> element is
 * left uncontrolled so a user's open/close choice survives streaming
 * re-renders. Reasoning is shown as plain text (React-escaped), never parsed
 * as Markdown, so it adds no HTML surface and no parse cost per chunk.
 */
function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const uiMessages = getUiMessages();
  const startedAtRef = useRef(Date.now());
  // A block restored from an earlier visit mounts already finished, so its
  // duration was never observed; show no seconds rather than "0 秒".
  const [timed] = useState(streaming);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const update = () =>
      setElapsedSeconds(Math.round((Date.now() - startedAtRef.current) / 1000));
    update();
    if (!streaming) return;
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [streaming]);

  const label = streaming ? uiMessages.content.reasoningStreaming : uiMessages.content.reasoningDone;

  return (
    <details className="group rounded-lg border border-border/60 bg-muted/30 text-xs text-muted-foreground">
      <summary className="flex cursor-pointer select-none list-none items-center gap-1 px-2.5 py-1.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
        <span className={streaming ? 'animate-pulse' : undefined}>{label}</span>
        <span className="opacity-70">
          {timed ? `· ${elapsedSeconds} 秒 ` : ''}· {text.length} 字
        </span>
      </summary>
      <div className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words border-t border-border/60 px-3 py-2 leading-relaxed">
        {text}
      </div>
    </details>
  );
}

interface ContentAppFrameProps {
  onClose: () => void;
  beginSummaryRequest?: number;
  onBeginSummaryHandled?: () => void;
  /** The summary this page showed last time, restored into the chat. */
  initialMessages?: UIMessage[];
  /** Called with the summary as it changes, so it can be restored later. */
  onPersistMessages?: (messages: UIMessage[]) => void;
}

export function ContentAppFrame({
  onClose,
  beginSummaryRequest = 0,
  onBeginSummaryHandled,
  initialMessages,
  onPersistMessages,
}: ContentAppFrameProps) {
  const uiMessages = getUiMessages();
  const [isTokenViewerOpen, setIsTokenViewerOpen] = useState(false);
  const [enableTokenUsageView] = useWxtStorage<boolean>(
    GENERAL_SETTING_DEFINITIONS.enableTokenUsageView.storageKey,
    GENERAL_SETTING_DEFINITIONS.enableTokenUsageView.defaultValue as boolean
  );
  // The token preview must dim the region that is actually discarded, which
  // depends on the configured truncation strategy.
  const [summaryInputExceedBehaviour] = useWxtStorage<SummaryInputExceedBehaviour>(
    GENERAL_SETTING_DEFINITIONS.summaryInputExceedBehaviour.storageKey,
    GENERAL_SETTING_DEFINITIONS.summaryInputExceedBehaviour.defaultValue as SummaryInputExceedBehaviour
  );
  const [panelFontSize] = useWxtStorage<PanelFontSize>(
    GENERAL_SETTING_DEFINITIONS.panelFontSize.storageKey,
    GENERAL_SETTING_DEFINITIONS.panelFontSize.defaultValue as PanelFontSize
  );
  // Only the reading area follows the font-size setting; the header and the
  // status bar keep their size. Unknown stored values fall back to medium.
  const readingStyle = {
    '--webpage-summary-panel-srem': `${PANEL_FONT_SIZE_REM_PX[panelFontSize] ?? PANEL_FONT_SIZE_REM_PX.medium}px`,
  } as CSSProperties;

  const {
    messages,
    status,
    error,
    errorMessage,
    models,
    currentModelId,
    setCurrentModelId,
    currentModel,
    pageContent,
    pageContentTokenCount,
    handleSummarize,
    beginSummary,
    handleModelIdChange,
  } = useContentApp({ initialMessages, onPersistMessages });

  const isBusy = status === 'streaming' || status === 'submitted';
  const assistantMessages = useMemo(
    () => messages.filter((message) => message.role === 'assistant'),
    [messages],
  );
  const hasSummary = assistantMessages.length > 0;
  // Markdown of the latest summary, citation markers turned into quotes.
  const latestSummaryText = useMemo(() => {
    const latest = assistantMessages[assistantMessages.length - 1];
    if (!latest) return '';
    const text = latest.parts
      .map((part) => (part.type === 'text' ? part.text : ''))
      .filter(Boolean)
      .join('\n\n');
    return citationMarkersToQuotes(text).trim();
  }, [assistantMessages]);
  // Same budget the summary is actually truncated to.
  const effectiveTokenLimit = currentModel
    ? getEffectiveInputTokenLimit(currentModel)
    : 0;

  // Fire beginSummary exactly once per trigger request. beginSummary is a
  // stable useCallback and the handled-request ref guards against later
  // re-renders re-running the effect (which previously aborted a streaming
  // summary and immediately restarted it, forever).
  const handledSummaryRequestRef = useRef(0);
  React.useEffect(() => {
    if (
      beginSummaryRequest > 0 &&
      beginSummaryRequest !== handledSummaryRequestRef.current
    ) {
      handledSummaryRequestRef.current = beginSummaryRequest;
      beginSummary();
      onBeginSummaryHandled?.();
    }
  }, [beginSummaryRequest, beginSummary, onBeginSummaryHandled]);


  return (
    <div
      lang="zh-CN"
      className="kuai-summary-panel flex flex-col w-full h-full overflow-hidden relative pointer-events-auto rounded-xl"
    >
      <Toaster
        position="bottom-right"
        duration={6000}
        richColors
        closeButton
        toastOptions={{
          style: { fontSize: '14px', padding: '16px' },
          className: 'min-h-[60px] text-sm',
        }}
      />
      {/* 顶部栏 / Top Bar */}
      <header
        className="px-1 py-1 border-b grid grid-cols-[1fr_auto_1fr] items-center cursor-move whitespace-nowrap gap-2 select-none touch-none"
        data-drag-handle
      >
        <div className="flex items-stretch gap-1.5 justify-start shrink-0 h-full">
          <button
            className="flex items-center gap-0.5 px-1 bg-background border border-border rounded-lg text-xs hover:border-foreground/40 shadow-sm text-foreground shrink-0 transition-colors"
            onClick={handleSummarize}
            title={
              isBusy
                ? uiMessages.content.stop
                : hasSummary
                  ? uiMessages.content.reSummarize
                  : uiMessages.content.summary
            }
          >
            {isBusy ? (
              <Square size={14} strokeWidth={0} fill="currentColor" className="m-px" />
            ) : hasSummary ? (
              <RefreshCw size={16} strokeWidth={1.5} />
            ) : (
              <img
                src={browser.runtime.getURL('/icon/32.png')}
                alt="icon"
                className="size-[18px] rounded-md object-contain shrink-0 transition-all dark:brightness-110"
                draggable={false}
              />
            )}
            {!hasSummary && !isBusy ? (
              <span className="font-medium pr-0.5 pl-0.5 inline-block translate-y-px opacity-80">{uiMessages.content.summary}</span>
            ) : null}
          </button>

          {error && (
            <button
              className="flex items-center justify-center text-red-500 hover:text-red-600 shrink-0 outline-none"
              title={errorMessage ?? error.message}
              onClick={() => toast.error(errorMessage ?? (error.message || uiMessages.common.unknownError))}
            >
              <Info size={16} strokeWidth={2.5} />
            </button>
          )}
        </div>

        <ModelSelector
          models={models}
          currentModelId={currentModelId}
          onModelChange={setCurrentModelId}
          onModelIdChange={handleModelIdChange}
        />

        <div className="flex items-center gap-0.5 text-muted-foreground justify-end shrink-0 h-full">
          <button
            className="flex items-center justify-center size-6 border border-border rounded hover:bg-muted shadow-sm shrink-0 transition-colors hover:text-foreground"
            title={uiMessages.content.settings}
            onClick={() => sendExtMessage('openOptionPage', '/options.html#/')}
          >
            <Settings size={14} />
          </button>
          <button
            className="flex items-center justify-center size-6 border border-border rounded hover:bg-muted shadow-sm hover:text-foreground shrink-0 transition-colors mr-1"
            onClick={onClose}
            title={uiMessages.content.close}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div
        className="kuai-reading kuai-scroll relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden"
        role="log"
        style={readingStyle}
      >
        <div className="flex min-h-full flex-col gap-6 px-5 pt-4 pb-6">
          {!hasSummary && !isBusy && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
              <div className="kuai-empty-title">
                {pageContent?.title || document.title || uiMessages.content.untitledPage}
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={handleSummarize}
              >
                <Sparkles size={15} />
                {uiMessages.content.summarizeThisPage}
              </button>
            </div>
          )}
          {assistantMessages.map((message) => {
            return (
              <Message from={message.role} key={message.id} className="kuai-message-enter">
                <MessageContent className="w-full">
                  {message.parts.map((part, i) => {
                    if (part.type === 'text') {
                      return (
                        <MessageResponse
                          key={`${message.id}-${i}`}
                          onCitationNotFound={() => toast.warning(uiMessages.content.citationNotFound)}
                        >
                          {part.text}
                        </MessageResponse>
                      );
                    }
                    if (part.type === 'reasoning' && part.text) {
                      return (
                        <ReasoningBlock
                          key={`${message.id}-${i}`}
                          text={part.text}
                          streaming={isBusy && part.state !== 'done'}
                        />
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            );
          })}
          {hasSummary && !isBusy && latestSummaryText && (
            <div className="-mt-3 -ml-2 flex">
              <CopySummaryButton text={latestSummaryText} />
            </div>
          )}
          {status === 'submitted' && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="size-4 animate-spin rounded-full border-2 border-border border-t-foreground" />
              <span>{uiMessages.content.thinking}</span>
            </div>
          )}
        </div>
      </div>

      {/* Status bar: in normal flow below the summary, so it never covers text. */}
      <footer className="kuai-status-bar flex items-center justify-between gap-2 px-3 py-1 shrink-0">
        {enableTokenUsageView && (
          <div className="flex items-center gap-1 min-w-0" title={uiMessages.content.viewChangeHint}>
            <span className="truncate tabular-nums">
              {pageContentTokenCount !== null
                ? (effectiveTokenLimit > 0 && pageContentTokenCount > effectiveTokenLimit)
                  ? `${uiMessages.content.inputTokensLabel}${formatTokens(effectiveTokenLimit)} · ${uiMessages.content.totalLabel}${formatTokens(pageContentTokenCount)}`
                  : `${uiMessages.content.inputTokensLabel}${formatTokens(pageContentTokenCount)}`
                : `${uiMessages.content.inputTokensLabel}${uiMessages.content.calculating}`}
            </span>
            <button
              className="inline-flex items-center justify-center shrink-0 size-5 rounded hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={uiMessages.content.tokenPreview}
              onClick={() => setIsTokenViewerOpen(true)}
            >
              <ScanEye size={13} strokeWidth={2} />
            </button>
          </div>
        )}
        {enableTokenUsageView && messages.length > 0 && !isBusy && (
          <UsageDisplay messages={messages} currentModel={currentModel} />
        )}
      </footer>

      {pageContent && (
        <TokenViewerModal
          isOpen={isTokenViewerOpen}
          onClose={() => setIsTokenViewerOpen(false)}
          textContent={pageContent.textContent}
          maxInputTokens={effectiveTokenLimit}
          behaviour={summaryInputExceedBehaviour}
        />
      )}
    </div>
  );
}
