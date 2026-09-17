import { AlertCircle, CheckCircle2, ChevronDown, Copy, Loader2, Play, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  getModelDisplayIcon,
  getModelProviderDefinition,
  type ModelConfigItem,
} from '@/constants/model-settings';
import {
  loadModelSettings,
  setDefaultModelConfig,
  setModelConfigModelId,
} from '@/lib/model-settings-storage';
import { sendMessage as sendExtMessage } from '@/lib/messaging';
import { getUiMessages } from '@/lib/i18n';

import { createLogger } from '@/lib/logger';

const logger = createLogger('popup:App');

function App() {
  const manifest = browser.runtime.getManifest();
  const messages = getUiMessages();
  const [models, setModels] = useState<ModelConfigItem[]>([]);
  const [currentModelId, setCurrentModelId] = useState('');
  const [copying, setCopying] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [isContentPage, setIsContentPage] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      await sendExtMessage('seedPromptLibrary');
      const modelSettings = await loadModelSettings();
      if (!active) return;
      setModels(modelSettings.models);
      setCurrentModelId(
        modelSettings.defaultModelId || modelSettings.models[0]?.id || '',
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!active || !tab?.id) return;
        setActiveTabId(tab.id);
        try {
          // The content script answers `ping` even on sites the user disabled
          // through the white/blacklist — but in that case it never mounts the
          // panel, so `ok:false` must be treated as "not summarizable" rather
          // than "reachable". Otherwise Summarize posts into the void.
          const result = await sendExtMessage('ping', undefined, { tabId: tab.id });
          if (active) setIsContentPage(result?.ok === true);
        } catch {
          if (active) setIsContentPage(false);
        }
      } catch (e) {
        logger.warn('[popup] failed to query active tab', e);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // The provider row lists *configs*, grouped under their vendor: one config is
  // one endpoint plus one API key, and a vendor name alone cannot address it
  // when two configs point at the same vendor.
  const handleConfigChange = async (id: string) => {
    setCurrentModelId(id);
    await setDefaultModelConfig(id);
  };

  // Switching the model rewrites only the selected config's `modelId`; the
  // config (and with it the endpoint and API key) stays put.
  const handleModelIdChange = async (modelId: string) => {
    const config = models.find((m) => m.id === currentModelId);
    if (!config || !modelId) return;

    setModels((current) =>
      current.map((m) => (m.id === config.id ? { ...m, modelId } : m)),
    );
    await setModelConfigModelId(config.id, modelId);
  };

  const handleCopyPage = async () => {
    logger.info('[popup] handleCopyPage clicked', { copying, activeTabId, isContentPage });
    if (copying) {
      logger.info('[popup] already copying, skip');
      return;
    }
    if (!activeTabId) {
      logger.warn('[popup] no active tab id');
      toast.error(messages.popup.noActiveTab);
      return;
    }
    setCopying(true);
    try {
      logger.info('[popup] sending WEBPAGE_SUMMARY_EXTRACT_TEXT to tab', activeTabId);
      const result = await sendExtMessage('extractText', undefined, { tabId: activeTabId });
      logger.info('[popup] extract result', result);

      if (!result?.ok || !('text' in result) || !result.text) {
        logger.warn('[popup] extract returned no text', result);
        toast.error(messages.popup.extractFailed);
        return;
      }
      logger.info('[popup] writing to clipboard, length=', result.text.length);
      await navigator.clipboard.writeText(result.text);
      logger.info('[popup] clipboard write success');
      toast.success(messages.popup.copySuccess);
    } catch (e) {
      logger.error('[popup] copy page failed', e);
      toast.error(`${messages.popup.copyFailed}: ${(e as Error)?.message ?? e}`);
    } finally {
      setCopying(false);
    }
  };

  const handleSummarize = async () => {
    if (!activeTabId || summarizing) return;
    setSummarizing(true);
    try {
      await sendExtMessage(
        'invokeSummary',
        { beginSummary: true },
        { tabId: activeTabId },
      );
      window.close();
    } catch (e) {
      logger.error('[popup] invoke summary failed', e);
      toast.error(messages.popup.invokeSummaryFailed);
    } finally {
      setSummarizing(false);
    }
  };

  const currentModel = models.find((m) => m.id === currentModelId);
  // The row lists configs by their own name. A vendor group header was tried
  // and read as noise: the config name is what the user recognises, and it is
  // already unique across the whole list.
  const configOptions = models.map((model) => ({
    value: model.id,
    label: model.name,
  }));
  // The model row lists the selected config's fetched pool. A config that was
  // never fetched — or one whose id was typed by hand — degrades to the single
  // id it currently uses, so the row is never empty.
  const modelIdOptions = (() => {
    if (!currentModel) return [] as Array<{ value: string; label: string }>;

    const pool = currentModel.modelIds.includes(currentModel.modelId)
      ? currentModel.modelIds
      : [currentModel.modelId, ...currentModel.modelIds];

    return pool
      .filter((id) => id)
      .map((id) => ({ value: id, label: id }));
  })();

  return (
    <main className="grid min-w-[320px] max-w-3xl gap-3 bg-background px-3 py-3">
      <div className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs', isContentPage ? 'border-primary/20 bg-primary/5 text-primary' : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300')}>
        {isContentPage ? <CheckCircle2 className="size-4 shrink-0" /> : <AlertCircle className="size-4 shrink-0" />}
        <span>{isContentPage ? messages.popup.pageSupported : messages.popup.pageUnsupported}</span>
      </div>
      <header className="flex items-center gap-1">
        <img
          src={browser.runtime.getURL('/icon/32.png')}
          alt="icon"
          className="aspect-square size-5 shrink-0 rounded-lg object-contain"
        />
        <div className="flex min-w-0 max-w-64 flex-1 items-baseline gap-2">
          <h1 className="truncate  font-semibold leading-tight">
            {manifest.name}
          </h1>
          <span className="shrink-0 rounded-full bg-muted px-1 py-0.5 font-mono font-medium text-muted-foreground">
            v{manifest.version}
          </span>
        </div>
        <button
          type="button"
          onClick={() => browser.runtime.openOptionsPage()}
          title={messages.popup.openOptions}
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings size={18} />
        </button>
      </header>

      <section className="grid gap-1.5">
        <SelectRow
          label={messages.popup.provider}
          value={currentModelId}
          onChange={handleConfigChange}
          options={configOptions}
          icon={currentModel ? <ModelIcon model={currentModel} /> : undefined}
        />
        <SelectRow
          label={messages.popup.model}
          value={currentModel?.modelId ?? ''}
          onChange={handleModelIdChange}
          options={modelIdOptions}
        />
      </section>

      <section className="flex items-center justify-between gap-2">
        <div className="flex items-center">
          {isContentPage && (
            <button
              type="button"
              onClick={handleSummarize}
              disabled={summarizing}
              title={messages.popup.openPanelAndStartSummary}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
            >
              {summarizing ? <Loader2 size={14} className="animate-spin" /> : <Play size={13} className="fill-current" />}
              <span>{messages.popup.summary}</span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopyPage}
          disabled={copying || !isContentPage}
          title={messages.popup.copyPageContentToClipboard}
          className={cn(
            'flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground',
            (copying || !isContentPage) && 'cursor-not-allowed opacity-60',
          )}
        >
          <Copy size={14} />
          <span>{messages.popup.page}</span>
        </button>
      </section>
    </main>
  );
}

function ModelIcon({ model }: { model: ModelConfigItem }) {
  const providerDef = getModelProviderDefinition(model.providerId);
  const iconUrl = getModelDisplayIcon(model);
  const src =
    iconUrl.startsWith('http') || iconUrl.startsWith('data:')
      ? iconUrl
      : browser.runtime.getURL(iconUrl as any);
  return (
    <img
      src={src}
      alt={providerDef.label}
      className="pointer-events-none size-3.5 object-contain"
    />
  );
}

interface SelectRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  icon?: React.ReactNode;
}

function SelectRow({ label, value, onChange, options, icon }: SelectRowProps) {
  return (
    <label className="grid grid-cols-[56px_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="relative flex items-center">
        {icon && (
          <span className="pointer-events-none absolute left-2 z-10 flex items-center">
            {icon}
          </span>
        )}
        <select
          className={cn(
            'w-full  appearance-none truncate rounded-md border border-border bg-background py-1.5 pr-7 text-sm text-muted-foreground shadow-sm outline-none transition-colors hover:bg-muted focus:border-primary',
            icon ? 'pl-7' : 'pl-2.5',
          )}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.length === 0 && <option value="">-</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2 text-zinc-400"
        />
      </div>
    </label>
  );
}

export default App;
