import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Mustache from 'mustache';
import { toast } from 'sonner';
import { useChat } from '@ai-sdk/react';
import { storage } from '#imports';
import type { UIMessage } from 'ai';

import { AiSdkConnectTransport } from '@/lib/ai-sdk-connect-transport';
import {
  loadModelSettings,
  setModelConfigModelId,
} from '@/lib/model-settings-storage';
import { loadPromptSettings } from '@/lib/prompt-settings-storage';
import { loadGeneralSettings } from '@/lib/general-settings-storage';
import { parsePageContent, type WebpageContent } from '@/lib/page-extraction';
import { getCurrentPageSelection } from '@/lib/page-selection';
import { countInputTokens, truncateByTokens } from '@/lib/token-count';
import { getEffectiveInputTokenLimit } from '@/lib/input-token-limit';
import {
  cachePageContent,
  cachePageContentTokenCount,
  getCachedPageContent,
} from '@/lib/page-content-cache';
import {
  classifySummaryError,
  describeSummaryError,
  type SummaryErrorCode,
} from '@/lib/error-taxonomy';

import {
  MODEL_CONFIGS_V2_STORAGE_KEY,
  type ModelConfigItem,
} from '@/constants/model-settings';
import {
  SUMMARY_LANGUAGE_NAME,
  type PromptConfigItem,
} from '@/constants/prompt-settings';
import type { GeneralSettings } from '@/constants/general-settings';
import { getUiMessages } from '@/lib/i18n';
import { sendMessage as sendExtMessage } from '@/lib/messaging';

import { createLogger } from '@/lib/logger';
import {
  beginPanelTiming,
  beginSummaryTiming,
  markTiming,
} from '@/lib/summary-timing';

const logger = createLogger('content:useContentApp');

// Page content is raw text destined for an LLM prompt, not HTML. Mustache's
// default HTML escaping would turn `<`, `>`, `&` and quotes in the article
// into `&lt;` / `&gt;` / `&amp;` entities, corrupting code samples. The
// templates are rendered for prompt text only, so disable escaping globally.
Mustache.escape = (value: string) => value;

// While a summary streams in, save it at most this often, so a full page
// navigation mid-stream still leaves most of it to restore.
const PERSIST_THROTTLE_MS = 1000;

type UseContentAppOptions = {
  /** The summary this page showed last time; the chat starts from it. */
  initialMessages?: UIMessage[];
  /** Receives the summary whenever it changes, for per-page restore. */
  onPersistMessages?: (messages: UIMessage[]) => void;
};

export function useContentApp({
  initialMessages,
  onPersistMessages,
}: UseContentAppOptions = {}) {
  const messagesI18n = getUiMessages();
  const [models, setModels] = useState<ModelConfigItem[]>([]);
  const [prompts, setPrompts] = useState<PromptConfigItem[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string>('');
  const [currentPromptId, setCurrentPromptId] = useState<string>('');
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [pageContent, setPageContent] = useState<WebpageContent | null>(null);
  const [pageContentTokenCount, setPageContentTokenCount] = useState<number | null>(null);
  const [autoSummarizePending, setAutoSummarizePending] = useState(false);
  // State (not a ref) so the auto-summarize effect actually re-runs once
  // initialization settles — a ref flip would not schedule a render.
  const [initialized, setInitialized] = useState(false);

  const modelConfigIdRef = useRef<string | null>(null);
  modelConfigIdRef.current = currentModelId || null;

  const promptIdRef = useRef<string | null>(null);
  promptIdRef.current = currentPromptId || null;

  const settingsLoadedRef = useRef(false);

  // URL the current `pageContent` was extracted for. A single-page app can
  // navigate under the open panel, at which point that content is stale.
  const pageHrefRef = useRef<string | null>(null);

  // The summarize callback is intentionally stable (ContentAppFrame's trigger
  // effect fires once per request). All data it needs is read from this
  // always-current ref instead of the render closure, so a stale closure can
  // never freeze `prompts/pageContent/settings` at their mount-time empties.
  const summarizeContextRef = useRef<{
    currentModel: ModelConfigItem | null;
    currentModelId: string;
    currentPromptId: string;
    pageContent: WebpageContent | null;
    prompts: PromptConfigItem[];
    settings: GeneralSettings | null;
  }>({
    currentModel: null,
    currentModelId: '',
    currentPromptId: '',
    pageContent: null,
    prompts: [],
    settings: null,
  });

  const transport = useMemo(
    () =>
      new AiSdkConnectTransport({
        getModelConfigId: () => modelConfigIdRef.current,
      }),
    [],
  );

  // Read once: the chat is seeded at mount and owns its messages after that.
  const [restoredMessages] = useState(() => initialMessages ?? []);

  const { error, messages, sendMessage, setMessages, status, stop } = useChat({
    transport,
    messages: restoredMessages,
  });

  const statusRef = useRef(status);
  statusRef.current = status;

  const onPersistMessagesRef = useRef(onPersistMessages);
  onPersistMessagesRef.current = onPersistMessages;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // The last array handed to onPersistMessages; the restored one counts as
  // already saved.
  const persistedMessagesRef = useRef<UIMessage[]>(restoredMessages);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistMessages = useCallback(() => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (messagesRef.current === persistedMessagesRef.current) return;
    persistedMessagesRef.current = messagesRef.current;
    onPersistMessagesRef.current?.(messagesRef.current);
  }, []);

  // Save the summary so this page can show it again after navigating away and
  // back. Settled states are saved at once; while streaming, at most once per
  // PERSIST_THROTTLE_MS (the pending timer is deliberately not reset by each
  // new chunk, or it would never fire mid-stream).
  useEffect(() => {
    if (status !== 'streaming' && status !== 'submitted') {
      persistMessages();
      return;
    }
    persistTimerRef.current ??= setTimeout(persistMessages, PERSIST_THROTTLE_MS);
  }, [messages, status, persistMessages]);

  // Unmounting (panel closed, or the page changed under a single-page app)
  // ends this chat: stop a stream nobody will see and save what it produced.
  useEffect(() => {
    return () => {
      if (statusRef.current === 'streaming' || statusRef.current === 'submitted') {
        stop();
      }
      persistMessages();
    };
  }, [stop, persistMessages]);

  const currentModel = useMemo(
    () => models.find((m) => m.id === currentModelId),
    [models, currentModelId],
  );

  const currentPrompt = useMemo(
    () => prompts.find((p) => p.id === currentPromptId),
    [prompts, currentPromptId],
  );

  // Refresh the snapshot on every render so the stable summarize callback
  // always sees the latest models/prompts/content/settings.
  summarizeContextRef.current = {
    currentModel: currentModel ?? null,
    currentModelId,
    currentPromptId,
    pageContent,
    prompts,
    settings,
  };

  useEffect(() => {
    if (!error) return;

    const maybeCode = (error as Error & { code?: SummaryErrorCode }).code;
    const classification = maybeCode
      ? {
          code: maybeCode,
          retryable:
            (error as Error & { retryable?: boolean }).retryable ?? false,
        }
      : classifySummaryError({
          message: error.message,
          name: error.name,
          status: (error as Error & { status?: number }).status,
        });

    // A user-initiated stop must never surface an error toast.
    if (classification.code === 'aborted') return;

    const message = describeSummaryError(classification.code, error.message);

    if (classification.code === 'auth') {
      toast.error(message, {
        action: {
          label: messagesI18n.popup.openOptions,
          onClick: () => {
            void sendExtMessage('openOptionPage', '/options.html#/models');
          },
        },
      });
      return;
    }

    toast.error(message);
  }, [error, messagesI18n.popup.openOptions]);

  // Human-friendly copy for the header error indicator (mirrors the toast).
  const errorMessage = useMemo(() => {
    if (!error) return null;
    const maybeCode = (error as Error & { code?: SummaryErrorCode }).code;
    const classification = maybeCode
      ? { code: maybeCode }
      : classifySummaryError({
          message: error.message,
          name: error.name,
          status: (error as Error & { status?: number }).status,
        });
    if (classification.code === 'aborted') return null;
    return describeSummaryError(classification.code, error.message);
  }, [error]);

  // Initialization
  useEffect(() => {
    let active = true;
    async function init() {
      beginPanelTiming();
      // Seed through the background worker so first-run seeding never races
      // across content scripts, the popup and the options page. Seeding is
      // best-effort: a failure must not prevent the panel from loading.
      try {
        await sendExtMessage('seedPromptLibrary');
      } catch (e) {
        logger.warn('[useContentApp] Prompt seeding failed; continuing', e);
      }
      markTiming('面板：提示词播种 RPC 完成');

      try {
        const [modelSettings, promptSettings, generalSettings] = await Promise.all([
          loadModelSettings(),
          loadPromptSettings(),
          loadGeneralSettings(),
        ]);
        markTiming('面板：读取设置完成');

        if (!active) return;

        setModels(modelSettings.models);
        setPrompts(promptSettings.prompts);

        const defaultModelId =
          modelSettings.defaultModelId || (modelSettings.models[0]?.id ?? '');
        const defaultPromptId =
          promptSettings.defaultPromptId || (promptSettings.prompts[0]?.id ?? '');
        setCurrentModelId(defaultModelId);
        setCurrentPromptId(defaultPromptId);
        setSettings(generalSettings);

        // Reuse an already-extracted page body when several panel copies share
        // the same URL. The signature is validated against live DOM text so a
        // stale spa route can never leak the previous article into the prompt.
        const cached = getCachedPageContent(window.location.href);
        if (!active) return;

        if (cached) {
          markTiming('面板：命中正文缓存（含 innerText 校验）');
          pageHrefRef.current = window.location.href;
          setPageContent(cached.content);
          if (cached.tokenCount !== null) {
            setPageContentTokenCount(cached.tokenCount);
          } else {
            countInputTokens(cached.content.textContent)
              .then((count) => {
                markTiming('面板：token 计数 RPC 完成');
                if (!active) return;
                setPageContentTokenCount(count);
                cachePageContentTokenCount(window.location.href, count);
              })
              .catch((e) => logger.error('Failed to count tokens', e));
          }
        } else {
          try {
            const extracted = parsePageContent(
              generalSettings.pageTextExtractMethod,
              document,
            );
            markTiming('面板：正文抽取完成');
            if (!active) return;
            if (extracted) {
              cachePageContent(window.location.href, extracted);
              markTiming('面板：写入正文缓存（innerText 签名）完成');
              pageHrefRef.current = window.location.href;
              setPageContent(extracted);
              countInputTokens(extracted.textContent)
                .then((count) => {
                  markTiming('面板：token 计数 RPC 完成');
                  if (!active) return;
                  setPageContentTokenCount(count);
                  cachePageContentTokenCount(window.location.href, count);
                })
                .catch((e) => logger.error('Failed to count tokens', e));
            }
          } catch (e) {
            logger.error('Failed to extract page content', e);
          }
        }

        // A restored summary is what the user came back to see; do not
        // replace it with a fresh run.
        if (generalSettings.enableAutoBeginSummary && restoredMessages.length === 0) {
          setAutoSummarizePending(true);
        }
      } catch (e) {
        // Any storage/messaging failure must leave a usable panel rather than
        // a silently half-initialized one.
        logger.error('[useContentApp] Initialization failed', e);
      } finally {
        if (active) {
          markTiming('面板：初始化完成');
          settingsLoadedRef.current = true;
          setInitialized(true);
        }
      }
    }
    init().catch((e) => logger.error('[useContentApp] init threw unexpectedly', e));
    return () => {
      active = false;
    };
    // `restoredMessages` is fixed at mount, so this still runs once.
  }, [restoredMessages.length]);

  // Model-config edits made elsewhere (options page, popup) have to reach a
  // panel that is already open: both the fetched model pool and the selected
  // id live on the config row, so a stale copy would offer the wrong options.
  // This deliberately does not touch `currentModelId` — which config the panel
  // is showing stays the user's session-local choice.
  useEffect(() => {
    let active = true;

    const unwatch = storage.watch(MODEL_CONFIGS_V2_STORAGE_KEY, () => {
      void loadModelSettings()
        .then((settings) => {
          if (active) setModels(settings.models);
        })
        .catch((e) =>
          logger.error('[useContentApp] Failed to refresh model configs', e),
        );
    });

    return () => {
      active = false;
      unwatch();
    };
  }, []);

  // Re-extract the body when the page navigated (SPA route change) or its
  // text changed since the last extraction — after a route change the panel
  // remounts and may have extracted before the new route finished rendering.
  // The cache lookup validates against the live DOM text. Returns the content
  // to summarize; falls back to the previous content if extraction yielded
  // nothing.
  const refreshPageContentIfStale = useCallback(
    async (
      current: WebpageContent | null,
      generalSettings: GeneralSettings,
    ): Promise<WebpageContent | null> => {
      const href = window.location.href;
      const cached = getCachedPageContent(href);
      if (pageHrefRef.current === href && cached) return current;

      let fresh: WebpageContent | null = cached?.content ?? null;
      if (!fresh) {
        try {
          fresh =
            parsePageContent(generalSettings.pageTextExtractMethod, document) ??
            null;
        } catch (e) {
          logger.error('[useContentApp] Failed to re-extract page content', e);
        }
        if (fresh) cachePageContent(href, fresh);
      }

      // The href stays stale on failure so the next attempt retries.
      if (!fresh) return current;

      pageHrefRef.current = href;
      setPageContent(fresh);
      if (cached && cached.tokenCount !== null) {
        setPageContentTokenCount(cached.tokenCount);
      } else {
        setPageContentTokenCount(null);
        countInputTokens(fresh.textContent)
          .then((count) => {
            if (pageHrefRef.current !== href) return;
            setPageContentTokenCount(count);
            cachePageContentTokenCount(href, count);
          })
          .catch((e) => logger.error('Failed to count tokens', e));
      }
      return fresh;
    },
    [],
  );

  // External triggers are routed through the extension message listener in
  // ContentEntrance rather than a page-visible DOM event. useCallback keeps
  // the reference stable so ContentAppFrame's trigger effect fires once per
  // request instead of on every render (which caused an abort/restart loop).
  const beginSummary = useCallback(() => {
    setAutoSummarizePending(true);
  }, []);

  // Picking another model out of the current config's pool writes through to
  // that config row, so the choice survives a reload and shows up in the
  // options page and the popup. `currentModelId` here is the config's id.
  const handleModelIdChange = useCallback(async (modelId: string) => {
    const configId = summarizeContextRef.current.currentModelId;

    if (!configId || !modelId) return;

    try {
      const changed = await setModelConfigModelId(configId, modelId);

      if (!changed) return;

      // Reload rather than waiting for the storage watcher: whether an
      // onChanged event fires back into the context that wrote is an
      // implementation detail, and the picker must never snap back to the
      // previous id. A failed write leaves the UI on the old value.
      const settings = await loadModelSettings();
      setModels(settings.models);
    } catch (e) {
      logger.error('[useContentApp] Failed to switch the model id', e);
    }
  }, []);

  // `restartIfBusy` distinguishes an external trigger (context menu, popup,
  // auto-summarize), which means "summarize now", from the panel button, which
  // toggles: pressing it mid-stream only stops.
  const summarize = useCallback(async (restartIfBusy: boolean) => {
    const isBusy = () =>
      statusRef.current === 'streaming' || statusRef.current === 'submitted';

    if (isBusy()) {
      stop();
      if (!restartIfBusy) return;

      // Let the aborted stream settle before starting the next one.
      for (let waited = 0; isBusy() && waited < 2000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (isBusy()) return;
    }

    beginSummaryTiming();

    const {
      currentModel,
      currentModelId,
      currentPromptId,
      prompts,
      settings,
    } = summarizeContextRef.current;
    let pageContent = summarizeContextRef.current.pageContent;

    // Every bail-out below used to be a silent log, which made the button look
    // broken. Tell the user what is missing, and where to fix it.
    if (!currentModelId) {
      toast.error(messagesI18n.content.noModelConfigured, {
        action: {
          label: messagesI18n.popup.openOptions,
          onClick: () => {
            void sendExtMessage('openOptionPage', '/options.html#/models');
          },
        },
      });
      return;
    }

    const prompt = prompts.find((p) => p.id === currentPromptId);
    if (!prompt) {
      toast.error(messagesI18n.content.noPromptConfigured, {
        action: {
          label: messagesI18n.popup.openOptions,
          onClick: () => {
            void sendExtMessage('openOptionPage', '/options.html#/prompts');
          },
        },
      });
      return;
    }

    if (settings) {
      pageContent = await refreshPageContentIfStale(pageContent, settings);
    }

    if (!pageContent || !settings) {
      logger.warn('[useContentApp] Missing page content or settings');
      toast.error(messagesI18n.content.noPageContent);
      return;
    }

    let textContent = pageContent.textContent;

    const tokenLimit = currentModel
      ? getEffectiveInputTokenLimit(currentModel)
      : 0;
    if (tokenLimit > 0) {
      markTiming('总结：截断 RPC 开始');
      try {
        textContent = await truncateByTokens(
          textContent,
          tokenLimit,
          settings.summaryInputExceedBehaviour,
        );
      } catch (e) {
        // Truncation only keeps us under the context limit; if the background
        // worker is unreachable, send the full text and let the provider
        // decide rather than failing without any feedback.
        logger.warn('[useContentApp] Truncation failed; sending the full text', e);
      }
      markTiming('总结：截断 RPC 完成');
    }

    const view = {
      textContent,
      articleUrl: pageContent.articleUrl,
      summaryLanguage: SUMMARY_LANGUAGE_NAME,
      currentSelection: getCurrentPageSelection(),
    };

    setMessages([
      {
        id: `system-${prompt.id}`,
        role: 'system',
        parts: [{ type: 'text', text: Mustache.render(prompt.systemMessage, view) }],
      },
    ]);
    markTiming('总结：模板渲染完成，交给 useChat');
    await sendMessage({
      text: Mustache.render(prompt.userMessage, view),
    });
    // State flows through summarizeContextRef (updated on every render), so
    // this callback can stay stable for ContentAppFrame's trigger effect.
    // `messagesI18n` is a module-level constant per locale, so listing it does
    // not destabilize the callback.
  }, [stop, sendMessage, setMessages, messagesI18n, refreshPageContentIfStale]);

  const handleSummarize = useCallback(() => summarize(false), [summarize]);

  // Handle auto summarization once data is fully loaded
  useEffect(() => {
    if (!autoSummarizePending) return;

    // Wait for initialization to finish before deciding anything: models and
    // prompts are empty until then, which is indistinguishable from "the user
    // has none configured".
    if (!initialized || !settings) return;

    if (!currentModelId || models.length === 0) {
      // Without a model there is nothing to run, and leaving the pending flag
      // set would strand the request forever with no feedback at all.
      setAutoSummarizePending(false);
      toast.error(messagesI18n.content.noModelConfigured, {
        action: {
          label: messagesI18n.popup.openOptions,
          onClick: () => {
            void sendExtMessage('openOptionPage', '/options.html#/models');
          },
        },
      });
      return;
    }

    if (!currentPromptId || prompts.length === 0) {
      setAutoSummarizePending(false);
      toast.error(messagesI18n.content.noPromptConfigured, {
        action: {
          label: messagesI18n.popup.openOptions,
          onClick: () => {
            void sendExtMessage('openOptionPage', '/options.html#/prompts');
          },
        },
      });
      return;
    }

    if (pageContent) {
      setAutoSummarizePending(false);
      void summarize(true);
    }
    // `summarize` and `messagesI18n` are deliberately left out of this
    // dependency array. `setAutoSummarizePending(false)` above doesn't commit
    // synchronously — so if `summarize` were listed here and its identity ever
    // changed while this effect's state update is still in flight, the effect
    // could re-run before `autoSummarizePending` reads back as false, firing
    // `summarize()` again (duplicate/looping summary triggers). `messagesI18n`
    // is only read inside the early-return branches above and reassigning it can't affect whether those branches run, so it
    // adds nothing but re-run churn. See 1.5.1's stale-closure bug
    // (`summarizeContextRef` below) for why this effect's dependencies get
    // this much scrutiny — do not "fix" this by adding either back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoSummarizePending,
    initialized,
    pageContent,
    settings,
    models,
    prompts,
    currentModelId,
    currentPromptId,
  ]);

  return {
    // chat
    messages,
    status,
    error,
    errorMessage,
    // models & prompts
    models,
    prompts,
    currentModelId,
    setCurrentModelId,
    currentPromptId,
    setCurrentPromptId,
    currentModel,
    currentPrompt,
    // page content
    pageContent,
    pageContentTokenCount,
    // handlers
    handleSummarize,
    beginSummary,
    handleModelIdChange,
  };
}