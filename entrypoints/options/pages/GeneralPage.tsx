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
import { getModelDisplayIcon } from '@/constants/model-settings';
import {
  loadGeneralSettings,
  saveGeneralSetting,
  saveGeneralSettings,
} from '@/lib/general-settings-storage';
import { getUiMessages } from '@/lib/i18n';
import {
  loadModelSettings,
  setDefaultModelConfig,
  type ModelSettings,
} from '@/lib/model-settings-storage';
import {
  loadPromptSettings,
  setDefaultPrompt,
  type PromptSettings,
} from '@/lib/prompt-settings-storage';
import type { PageTextExtractMethod } from '@/lib/page-extraction';
import { cn } from '@/lib/utils';
import { OptionsPageTitle } from './OptionsPageTitle';

const EXTRACT_METHOD_OPTIONS: PageTextExtractMethod[] = [
  'readability',
  'dom-heuristic',
];

const LOG_LEVEL_OPTIONS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];

const OVERFLOW_LABELS: Record<
  SummaryInputExceedBehaviour,
  { label: string; description: string }
> = {
  front: { label: '保留开头', description: '保留正文开头（默认）。' },
  middle: { label: '保留首尾', description: '保留开头与结尾，中间用占位符标记。' },
  back: { label: '保留结尾', description: '保留正文结尾部分。' },
  nothing: { label: '不裁剪', description: '原样发送全部内容（可能超出模型上限）。' },
};

type BooleanSettingKey = Exclude<
  GeneralSettingKey,
  'pageTextExtractMethod' | 'logLevel' | 'summaryInputExceedBehaviour' | 'panelFontSize'
>;

const PANEL_FONT_SIZE_OPTIONS: Array<{ label: string; value: PanelFontSize }> = [
  { label: '小', value: 'small' },
  { label: '中', value: 'medium' },
  { label: '大', value: 'large' },
];

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
          <span className="mt-1 block border-l-2 border-amber-500 bg-amber-50 px-2 py-0.5 text-[11px] leading-4 text-amber-950 dark:bg-amber-500/10 dark:text-amber-200">
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

    const previous = settings;
    setSettings({ ...settings, [key]: value });

    try {
      await saveGeneralSetting(key, value);
    } catch (error) {
      setSettings(previous);
      toast.error(
        error instanceof Error ? error.message : messages.general.saveFailed,
      );
    }
  }

  async function restoreDefaults() {
    if (!settings || isSaving) return;
    if (!window.confirm('把所有通用设置恢复为默认值？')) return;

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
        { label: '浅色', value: 'light' as const },
        { label: '深色', value: 'dark' as const },
        { label: '跟随系统', value: 'system' as const },
      ]}
      value={theme as 'light' | 'dark' | 'system'}
    />
  );

  return (
    <div className="max-w-4xl pb-16">
      <OptionsPageTitle>{messages.general.title}</OptionsPageTitle>

      <Group label="界面与显示">
        <Row control={themeControl} description="设置页与页面内面板共用。" label="主题" />
        <Row
          control={
            <Segmented
              onChange={(value) => updateSetting('panelFontSize', value)}
              options={PANEL_FONT_SIZE_OPTIONS}
              value={settings.panelFontSize}
            />
          }
          description="页面内面板里总结正文的大小，已打开的面板立即生效。"
          label="面板字号"
          storageKey={GENERAL_SETTING_DEFINITIONS.panelFontSize.storageKey}
        />
        {toggleRow('enableFloatingBall')}
        {toggleRow('enableTokenUsageView')}
      </Group>

      <Group label="总结触发">
        {toggleRow('enableSummaryWindowDefault')}
        {toggleRow('enableAutoBeginSummary')}
        {toggleRow('enableAutoBeginSummaryByActionOrContextTrigger')}
        {toggleRow('enableContextMenuSummarizeThisPage')}
      </Group>

      <Group label="默认模型与提示词">
        <Row
          control={
            modelSettings ? (
              <div className="flex items-center gap-1.5">
                <Select
                  onValueChange={async (value) => {
                    await setDefaultModelConfig(value);
                    setModelSettings(await loadModelSettings());
                  }}
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
                            src={getModelDisplayIcon(model)}
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
          description="新开的总结面板默认使用。"
          label={messages.options.header.defaultModel}
        />
        <Row
          control={
            promptSettings ? (
              <div className="flex items-center gap-1.5">
                <Select
                  onValueChange={async (value) => {
                    await setDefaultPrompt(value);
                    setPromptSettings(await loadPromptSettings());
                  }}
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

      <Group label="页面内容">
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
                label: OVERFLOW_LABELS[behaviour].label,
                value: behaviour,
              }))}
              value={settings.summaryInputExceedBehaviour}
            />
          }
          description={OVERFLOW_LABELS[settings.summaryInputExceedBehaviour].description}
          label="超长内容"
          storageKey={GENERAL_SETTING_DEFINITIONS.summaryInputExceedBehaviour.storageKey}
        />
      </Group>

      <Group label="高级">
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
          description="排查问题时把级别调低。"
          label="日志级别"
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
