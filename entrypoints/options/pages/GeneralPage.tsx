import { ExternalLink, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  'pageTextExtractMethod' | 'logLevel' | 'summaryInputExceedBehaviour'
>;

type SectionKey = 'display' | 'triggers' | 'contextMenu';

/**
 * Grouping of the boolean switches. `display` is the former interface page —
 * the two pages were merged so every setting lives in one list.
 */
const BOOLEAN_SECTIONS: Array<{
  key: SectionKey;
  fields: BooleanSettingKey[];
}> = [
  { key: 'display', fields: ['enableFloatingBall', 'enableTokenUsageView'] },
  {
    key: 'triggers',
    fields: [
      'enableSummaryWindowDefault',
      'enableAutoBeginSummary',
      'enableAutoBeginSummaryByActionOrContextTrigger',
    ],
  },
  { key: 'contextMenu', fields: ['enableContextMenuSummarizeThisPage'] },
];

function ToggleRow({
  checked,
  caution,
  description,
  label,
  onChange,
  storageKey,
}: {
  checked: boolean;
  caution?: string;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
  storageKey: string;
}) {
  return (
    <label className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b py-4 last:border-b-0 max-sm:grid-cols-1">
      <span className="min-w-0">
        <span className="block text-sm font-medium" title={storageKey}>
          {label}
        </span>
        {description ? (
          <span className="mt-1 block max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </span>
        ) : null}
        {caution ? (
          <span className="mt-2 block border-l-2 border-amber-500 bg-amber-50 px-2 py-1 text-xs leading-5 text-amber-950">
            {caution}
          </span>
        ) : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function RadioRow({
  checked,
  description,
  isDefault,
  label,
  name,
  onSelect,
  value,
}: {
  checked: boolean;
  description?: string;
  isDefault?: boolean;
  label: string;
  name: string;
  onSelect: () => void;
  value: string;
}) {
  return (
    <label className="grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] gap-3 rounded-md border p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-muted/60">
      <input
        checked={checked}
        className="mt-1 size-4 accent-primary"
        name={name}
        onChange={onSelect}
        type="radio"
        value={value}
      />
      <span>
        <span className="flex items-center gap-2 text-sm font-medium">
          {label}
          {isDefault ? (
            <span className="text-xs font-normal text-muted-foreground/50">(Default)</span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-1 block max-w-xl text-sm leading-6 text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function SectionHeader({ description, title }: { description: string; title: string }) {
  return (
    <header className="mb-4 border-b pb-2">
      <h2 className="text-xl font-extrabold text-primary">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
    </header>
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

  return (
    <div className="grid max-w-4xl gap-7 pb-24">
      <OptionsPageTitle>{messages.general.title}</OptionsPageTitle>

      {BOOLEAN_SECTIONS.map((section) => {
        const sectionCopy =
          section.key === 'display'
            ? { title: '界面与显示', description: '主题，以及页面内的显示开关。' }
            : messages.general.sections[section.key];

        return (
          <section key={section.key} aria-label={sectionCopy.title}>
            <SectionHeader description={sectionCopy.description} title={sectionCopy.title} />

            {section.key === 'display' ? (
              <div className="grid gap-2 border-b py-4">
                <span className="text-sm font-medium">主题</span>
                <RadioGroup
                  className="flex flex-wrap gap-2"
                  onValueChange={(value) => setTheme(value as 'light' | 'dark' | 'system')}
                  value={theme}
                >
                  {[
                    { value: 'light', label: '浅色' },
                    { value: 'dark', label: '深色' },
                    { value: 'system', label: '跟随系统' },
                  ].map((option) => (
                    <label
                      className={cn(
                        'cursor-pointer rounded-md border px-3 py-1.5 text-xs transition-colors',
                        theme === option.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted',
                      )}
                      key={option.value}
                    >
                      <RadioGroupItem className="sr-only" value={option.value} />
                      {option.label}
                    </label>
                  ))}
                </RadioGroup>
              </div>
            ) : null}

            {section.fields.map((field) => {
              const fieldMessage = messages.general.settings[field];
              const definition = GENERAL_SETTING_DEFINITIONS[field];

              return (
                <ToggleRow
                  caution={fieldMessage.caution}
                  checked={settings[field]}
                  description={fieldMessage.description}
                  key={field}
                  label={fieldMessage.label}
                  onChange={(checked) => updateSetting(field, checked)}
                  storageKey={definition.storageKey}
                />
              );
            })}
          </section>
        );
      })}

      <section aria-label="默认模型与提示词">
        <SectionHeader
          description="新开的总结面板默认使用这两个选择。"
          title="默认模型与提示词"
        />

        <div className="grid gap-3">
          <div className="flex items-center justify-between gap-4 border-b py-4">
            <span className="text-sm font-medium">{messages.options.header.defaultModel}</span>
            <div className="flex items-center gap-2">
              {modelSettings ? (
                <Select
                  onValueChange={async (value) => {
                    await setDefaultModelConfig(value);
                    setModelSettings(await loadModelSettings());
                  }}
                  value={modelSettings.defaultModelId ?? undefined}
                >
                  <SelectTrigger className="h-8 w-[220px] text-xs">
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
              ) : (
                <div className="h-8 w-[220px] animate-pulse rounded-md bg-muted" />
              )}
              <Link
                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                title={messages.options.header.defaultModel}
                to="/models"
              >
                <ExternalLink className="size-4" />
              </Link>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 py-4">
            <span className="text-sm font-medium">{messages.options.header.defaultPrompt}</span>
            <div className="flex items-center gap-2">
              {promptSettings ? (
                <Select
                  onValueChange={async (value) => {
                    await setDefaultPrompt(value);
                    setPromptSettings(await loadPromptSettings());
                  }}
                  value={promptSettings.defaultPromptId ?? undefined}
                >
                  <SelectTrigger className="h-8 w-[220px] text-xs">
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
              ) : (
                <div className="h-8 w-[220px] animate-pulse rounded-md bg-muted" />
              )}
              <Link
                className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                title={messages.options.header.defaultPrompt}
                to="/prompts"
              >
                <ExternalLink className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section aria-label={messages.pageExtraction.method.title}>
        <SectionHeader
          description={messages.pageExtraction.method.description}
          title={messages.pageExtraction.method.title}
        />
        <div className="grid gap-3">
          {EXTRACT_METHOD_OPTIONS.map((method) => {
            const methodMessage = messages.pageExtraction.methods[method];

            return (
              <RadioRow
                checked={settings.pageTextExtractMethod === method}
                description={methodMessage.description}
                isDefault={GENERAL_SETTING_DEFINITIONS.pageTextExtractMethod.defaultValue === method}
                key={method}
                label={methodMessage.label}
                name="page-text-extract-method"
                onSelect={() => updateSetting('pageTextExtractMethod', method)}
                value={method}
              />
            );
          })}
        </div>
      </section>

      <section aria-label="超长内容裁剪">
        <SectionHeader
          description="当网页内容超过所选模型的最大输入 token 时，保留哪一部分送入模型。"
          title="超长内容裁剪"
        />
        <div className="grid gap-3">
          {SUMMARY_INPUT_EXCEED_BEHAVIOURS.map((behaviour) => (
            <RadioRow
              checked={settings.summaryInputExceedBehaviour === behaviour}
              description={OVERFLOW_LABELS[behaviour].description}
              isDefault={
                GENERAL_SETTING_DEFINITIONS.summaryInputExceedBehaviour.defaultValue === behaviour
              }
              key={behaviour}
              label={OVERFLOW_LABELS[behaviour].label}
              name="summary-input-exceed-behaviour"
              onSelect={() => updateSetting('summaryInputExceedBehaviour', behaviour)}
              value={behaviour}
            />
          ))}
        </div>
      </section>

      <section aria-label="高级">
        <SectionHeader description="排查问题时才会用到的开关。" title="高级" />

        <div className="grid gap-3">
          {LOG_LEVEL_OPTIONS.map((level) => (
            <RadioRow
              checked={settings.logLevel === level}
              isDefault={GENERAL_SETTING_DEFINITIONS.logLevel.defaultValue === level}
              key={level}
              label={level.toUpperCase()}
              name="log-level"
              onSelect={() => updateSetting('logLevel', level)}
              value={level}
            />
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 border-t pt-4">
          <div>
            <span className="block text-sm font-medium">快捷键</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              在浏览器里配置打开面板的快捷键。
            </span>
          </div>
          <a
            className="shrink-0 rounded-md p-2 text-primary transition-colors hover:bg-muted"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              import('wxt/browser').then(({ browser }) => {
                browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
              });
            }}
            title="去设置"
          >
            <ExternalLink className="size-5" />
          </a>
        </div>
      </section>

      <section className="border-t pt-6">
        <Button disabled={isSaving} onClick={() => void restoreDefaults()} type="button" variant="outline">
          <RotateCcw />
          {messages.general.restoreDefaults}
        </Button>
      </section>
    </div>
  );
}
