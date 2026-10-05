import { ExternalLink, RotateCcw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/components/theme-provider';
import {
  createDefaultGeneralSettings,
  GENERAL_SETTING_DEFINITIONS,
  SUMMARY_INPUT_EXCEED_BEHAVIOURS,
  type GeneralSettingKey,
  type GeneralSettings,
  type LogLevel,
  type PanelFontSize,
  type SummaryInputExceedBehaviour,
} from '@/constants/general-settings';
import { resolveModelIconUrl } from '@/lib/model-icon';
import {
  loadGeneralSettings,
  saveGeneralSetting,
  saveGeneralSettings,
} from '@/lib/general-settings-storage';
import { getUiMessages } from '@/lib/i18n';
import {
  loadModelSettings,
  type ModelSettings,
} from '@/lib/model-settings-storage';
import {
  loadPromptSettings,
  type PromptSettings,
} from '@/lib/prompt-settings-storage';
import { sendMessage as sendExtMessage } from '@/lib/messaging';
import type { PageTextExtractMethod } from '@/lib/page-extraction';
import { storage } from '#imports';
import {
  DEFAULT_MODEL_ID_V2_STORAGE_KEY,
  MODEL_CONFIGS_V2_STORAGE_KEY,
} from '@/constants/model-settings';
import {
  DEFAULT_PROMPT_ID_STORAGE_KEY,
  PROMPT_CONFIG_STORAGE_KEY,
} from '@/constants/prompt-settings';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { OptionsPageTitle } from './OptionsPageTitle';

const logger = createLogger('options:GeneralPage');

const EXTRACT_METHOD_OPTIONS: PageTextExtractMethod[] = [
  'readability',
  'dom-heuristic',
];

const LOG_LEVEL_OPTIONS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

type BooleanSettingKey = Exclude<
  GeneralSettingKey,
  'pageTextExtractMethod' | 'logLevel' | 'summaryInputExceedBehaviour' | 'panelFontSize'
>;

/**
 * One switch per row, grouped under a lightweight label. Everything shares the
 * same row shape so the page reads as a single list rather than a stack of
 * cards.
 */
function Group({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h2 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
        {label}
      </h2>
      <div className="rounded-lg border border-border/60 bg-card/40 px-4">{children}</div>
    </section>
  );
}

function Row({
  caution,
  control,
  description,
  label,
  storageKey,
}: {
  caution?: string;
  control: ReactNode;
  description?: string;
  label: string;
  storageKey?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
      <div className="min-w-0">
        <span className="block text-sm font-medium" title={storageKey}>
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {description}
          </span>
        ) : null}
        {caution ? (
          <span className="mt-1 block border-l-2 border-caution/60 bg-caution/10 px-2 py-0.5 text-[11px] leading-4 text-caution">
            {caution}
          </span>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function Segmented<Value extends string>({
  onChange,
  options,
  value,
}: {
  onChange: (value: Value) => void;
  options: Array<{ label: string; value: Value }>;
  value: Value;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted/40 p-0.5">
      {options.map((option) => (
        <button
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function GeneralPage() {
  const messages = getUiMessages();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(null);
  const [promptSettings, setPromptSettings] = useState<PromptSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const overflowLabels: Record<
    SummaryInputExceedBehaviour,
    { label: string; description: string }
  > = messages.general.overflow;
  const panelFontSizeOptions: Array<{ label: string; value: PanelFontSize }> = (
    ['small', 'medium', 'large'] as const
  ).map((value) => ({
    label: messages.general.panelFontSize.options[value],
    value,
  }));

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [loadedSettings, loadedModels, loadedPrompts] = await Promise.all([
          loadGeneralSettings(),
          loadModelSettings(),
          loadPromptSettings(),
        ]);

        if (!active) return;

        setSettings(loadedSettings);
        setModelSettings(loadedModels);
        setPromptSettings(loadedPrompts);
      } catch (error) {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : messages.general.loadFailed,
        );
      }
    }

    load();

    return () => {
      active = false;
    };
  }, [messages.general.loadFailed]);

  // Every row saves on its own, so there is no dirty state to track and no way
  // to lose an edit by navigating away. Failures roll the optimistic update back.
  async function updateSetting<Key extends GeneralSettingKey>(
    key: Key,
    value: GeneralSettings[Key],
  ) {
    if (!settings) return;

    const previousValue = settings[key];
    setSettings({ ...settings, [key]: value });

    try {
      await saveGeneralSetting(key, value);
    } catch (error) {
      // Roll back only the field that failed. Restoring the whole snapshot
      // would also revert a different switch the user toggled (and saved)
      // while this write was in flight, and the next click would then write
      // that stale value back to storage.
      setSettings((current) =>
        current ? { ...current, [key]: previousValue } : current,
      );
      toast.error(
        error instanceof Error ? error.message : messages.general.saveFailed,
      );
    }
  }

  async function changeDefaultModel(value: string) {
    try {
      const response = await sendExtMessage('mutateModelSettings', {
        op: 'setDefault',
        id: value,
      });
      setModelSettings(response.settings);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : messages.options.header.defaultModelFailed,
      );
      // Re-read rather than guess: the select is controlled by state, so
      // leaving the failed value in place would show a default that is not set.
      setModelSettings(await loadModelSettings());
    }
  }

  async function changeDefaultPrompt(value: string) {
    try {
      const response = await sendExtMessage('mutatePromptSettings', {
        op: 'setDefault',
        id: value,
      });
      setPromptSettings(response.settings);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : messages.options.header.defaultPromptFailed,
      );
      setPromptSettings(await loadPromptSettings());
    }
  }

  async function restoreDefaults() {
    if (!settings || isSaving) return;
    if (!window.confirm(messages.general.restoreDefaultsConfirm)) return;

    const previous = settings;
    const defaults = createDefaultGeneralSettings();
    setIsSaving(true);
    setSettings(defaults);

    try {
      await saveGeneralSettings(defaults);
      toast.success(messages.general.savedToast);
    } catch (error) {
      setSettings(previous);
      toast.error(
        error instanceof Error ? error.message : messages.general.saveFailed,
      );
    } finally {
      setIsSaving(false);
    }
  }

  // The model/prompt lists and the default choices can be changed from other
  // contexts while this page sits in a background tab (the popup switches the
  // default config, the panel switches a model id, another options tab edits
  // them). Without these watchers the dropdowns kept offering the list they were
  // mounted with, and picking a since-deleted row failed silently.
  useEffect(() => {
    const reloadModelSettings = () => {
      void loadModelSettings()
        .then(setModelSettings)
        .catch((e) => logger.error('[GeneralPage] Failed to refresh model settings', e));
    };
    const reloadPromptSettings = () => {
      void loadPromptSettings()
        .then(setPromptSettings)
        .catch((e) => logger.error('[GeneralPage] Failed to refresh prompt settings', e));
    };

    const unwatchers = [
      storage.watch(MODEL_CONFIGS_V2_STORAGE_KEY, reloadModelSettings),
      storage.watch(DEFAULT_MODEL_ID_V2_STORAGE_KEY, reloadModelSettings),
      storage.watch(PROMPT_CONFIG_STORAGE_KEY, reloadPromptSettings),
      storage.watch(DEFAULT_PROMPT_ID_STORAGE_KEY, reloadPromptSettings),
    ];

    return () => {
      for (const unwatch of unwatchers) unwatch();
    };
  }, []);

  if (loadError) {
    return (
      <>
        <OptionsPageTitle>{messages.general.title}</OptionsPageTitle>
        <div className="max-w-2xl rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {loadError}
        </div>
      </>
    );
  }

  if (!settings) {
    return (
      <>
        <OptionsPageTitle>{messages.general.title}</OptionsPageTitle>
        <div className="text-sm text-muted-foreground">
          {messages.common.loadingSettings}
        </div>
      </>
    );
  }

  const toggleRow = (field: BooleanSettingKey) => {
    const fieldMessage = messages.general.settings[field];

    return (
      <Row
        caution={fieldMessage.caution}
        control={
          <Switch
            checked={settings[field]}
            onCheckedChange={(checked) => updateSetting(field, checked)}
          />
        }
        description={fieldMessage.description}
        key={field}
        label={fieldMessage.label}
        storageKey={GENERAL_SETTING_DEFINITIONS[field].storageKey}
      />
    );
  };

  const themeControl = (
    <Segmented
      onChange={(value) => setTheme(value)}
      options={[
        { label: messages.general.theme.options.light, value: 'light' as const },
        { label: messages.general.theme.options.dark, value: 'dark' as const },
        { label: messages.general.theme.options.system, value: 'system' as const },
      ]}
      value={theme as 'light' | 'dark' | 'system'}
    />
  );

  return (
    <div className="max-w-4xl pb-16">
      <OptionsPageTitle>{messages.general.title}</OptionsPageTitle>

      <Group label={messages.general.groups.appearance}>
        <Row
          control={themeControl}
          description={messages.general.theme.description}
          label={messages.general.theme.label}
        />
        <Row
          control={
            <Segmented
              onChange={(value) => updateSetting('panelFontSize', value)}
              options={panelFontSizeOptions}
              value={settings.panelFontSize}
            />
          }
          description={messages.general.panelFontSize.description}
          label={messages.general.panelFontSize.label}
          storageKey={GENERAL_SETTING_DEFINITIONS.panelFontSize.storageKey}
        />
        {toggleRow('enableTokenUsageView')}
      </Group>

      <Group label={messages.general.groups.triggers}>
        {toggleRow('enableSummaryWindowDefault')}
        {toggleRow('enableAutoBeginSummary')}
        {toggleRow('enableAutoBeginSummaryByActionOrContextTrigger')}
        {toggleRow('enableContextMenuSummarizeThisPage')}
      </Group>

      <Group label={messages.general.groups.defaults}>
        <Row
          control={
            modelSettings ? (
              <div className="flex items-center gap-1.5">
                <Select
                  onValueChange={changeDefaultModel}
                  value={modelSettings.defaultModelId ?? undefined}
                >
                  <SelectTrigger className="h-8 w-[200px] text-xs">
                    <SelectValue placeholder={messages.options.header.noModels} />
                  </SelectTrigger>
                  <SelectContent>
                    {modelSettings.models.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <span className="flex items-center gap-2">
                          <img
                            alt=""
                            className="size-4 shrink-0 object-contain"
                            src={resolveModelIconUrl(model)}
                          />
                          <span className="truncate">{model.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Link
                  className="text-muted-foreground transition-colors hover:text-primary"
                  title={messages.options.header.defaultModel}
                  to="/models"
                >
                  <ExternalLink className="size-4" />
                </Link>
              </div>
            ) : (
              <div className="h-8 w-[200px] animate-pulse rounded-md bg-muted" />
            )
          }
          description={messages.general.defaultModelDescription}
          label={messages.options.header.defaultModel}
        />
        <Row
          control={
            promptSettings ? (
              <div className="flex items-center gap-1.5">
                <Select
                  onValueChange={changeDefaultPrompt}
                  value={promptSettings.defaultPromptId ?? undefined}
                >
                  <SelectTrigger className="h-8 w-[200px] text-xs">
                    <SelectValue placeholder={messages.options.header.noPrompts} />
                  </SelectTrigger>
                  <SelectContent>
                    {promptSettings.prompts.map((prompt) => (
                      <SelectItem key={prompt.id} value={prompt.id}>
                        <span className="truncate">{prompt.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Link
                  className="text-muted-foreground transition-colors hover:text-primary"
                  title={messages.options.header.defaultPrompt}
                  to="/prompts"
                >
                  <ExternalLink className="size-4" />
                </Link>
              </div>
            ) : (
              <div className="h-8 w-[200px] animate-pulse rounded-md bg-muted" />
            )
          }
          label={messages.options.header.defaultPrompt}
        />
      </Group>

      <Group label={messages.general.groups.pageContent}>
        <Row
          control={
            <Segmented
              onChange={(value) => updateSetting('pageTextExtractMethod', value)}
              options={EXTRACT_METHOD_OPTIONS.map((method) => ({
                label: messages.pageExtraction.methods[method].label,
                value: method,
              }))}
              value={settings.pageTextExtractMethod}
            />
          }
          description={
            messages.pageExtraction.methods[settings.pageTextExtractMethod].description
          }
          label={messages.pageExtraction.method.title}
          storageKey={GENERAL_SETTING_DEFINITIONS.pageTextExtractMethod.storageKey}
        />
        <Row
          control={
            <Segmented
              onChange={(value) => updateSetting('summaryInputExceedBehaviour', value)}
              options={SUMMARY_INPUT_EXCEED_BEHAVIOURS.map((behaviour) => ({
                label: overflowLabels[behaviour].label,
                value: behaviour,
              }))}
              value={settings.summaryInputExceedBehaviour}
            />
          }
          description={overflowLabels[settings.summaryInputExceedBehaviour].description}
          label={messages.general.overflowRowLabel}
          storageKey={GENERAL_SETTING_DEFINITIONS.summaryInputExceedBehaviour.storageKey}
        />
      </Group>

      <Group label={messages.general.groups.advanced}>
        <Row
          control={
            <Select
              onValueChange={(value) =>
                updateSetting('logLevel', value as LogLevel)
              }
              value={settings.logLevel}
            >
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVEL_OPTIONS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          description={messages.general.logLevel.description}
          label={messages.general.logLevel.label}
          storageKey={GENERAL_SETTING_DEFINITIONS.logLevel.storageKey}
        />
      </Group>

      <div className="mt-6">
        <Button
          disabled={isSaving}
          onClick={() => void restoreDefaults()}
          type="button"
          variant="outline"
        >
          <RotateCcw />
          {messages.general.restoreDefaults}
        </Button>
      </div>
    </div>
  );
}
