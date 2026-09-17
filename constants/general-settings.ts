import type { StorageItemKey } from '#imports';
import {
  isPageTextExtractMethod,
  type PageTextExtractMethod,
} from './page-extraction';

type GeneralSettingDefinition<T> = {
  defaultValue: T | (() => T);
  parse: (value: unknown, fallback: T) => T;
  storageKey: StorageItemKey;
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export const SUMMARY_INPUT_EXCEED_BEHAVIOURS = ['front', 'middle', 'back', 'nothing'] as const;
export type SummaryInputExceedBehaviour =
  (typeof SUMMARY_INPUT_EXCEED_BEHAVIOURS)[number];

export function isSummaryInputExceedBehaviour(
  value: unknown,
): value is SummaryInputExceedBehaviour {
  return (
    typeof value === 'string' &&
    (SUMMARY_INPUT_EXCEED_BEHAVIOURS as readonly string[]).includes(value)
  );
}

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LOG_LEVELS;
}

function booleanSetting(
  storageKey: StorageItemKey,
  defaultValue: boolean,
): GeneralSettingDefinition<boolean> {
  return {
    defaultValue,
    parse: (value, fallback) =>
      typeof value === 'boolean' ? value : fallback,
    storageKey,
  };
}

function pageTextExtractMethodSetting(
  storageKey: StorageItemKey,
  defaultValue: PageTextExtractMethod,
): GeneralSettingDefinition<PageTextExtractMethod> {
  return {
    defaultValue,
    parse: (value, fallback) =>
      isPageTextExtractMethod(value) ? value : fallback,
    storageKey,
  };
}

function logLevelSetting(
  storageKey: StorageItemKey,
  defaultValue: LogLevel,
): GeneralSettingDefinition<LogLevel> {
  return {
    defaultValue,
    parse: (value, fallback) => (isLogLevel(value) ? value : fallback),
    storageKey,
  };
}

function summaryInputExceedBehaviourSetting(
  storageKey: StorageItemKey,
  defaultValue: SummaryInputExceedBehaviour,
): GeneralSettingDefinition<SummaryInputExceedBehaviour> {
  return {
    defaultValue,
    parse: (value, fallback) =>
      isSummaryInputExceedBehaviour(value) ? value : fallback,
    storageKey,
  };
}

export const GENERAL_SETTING_DEFINITIONS = {
  pageTextExtractMethod: pageTextExtractMethodSetting(
    'local:page-text-extract-method',
    'readability',
  ),
  enableFloatingBall: booleanSetting('local:enable-floating-ball', true),
  enableSummaryWindowDefault: booleanSetting(
    'local:enable-summary-window-default',
    false,
  ),
  enableAutoBeginSummary: booleanSetting(
    'local:enable-auto-begin-summary',
    false,
  ),
  enableAutoBeginSummaryByActionOrContextTrigger: booleanSetting(
    'local:enable-auto-begin-summary-by-action-or-context-trigger',
    true,
  ),
  enableTokenUsageView: booleanSetting(
    // Keep the reference project's storage key spelling for migration compatibility.
    'local:enable-tokan-usage-view',
    true,
  ),
  enableContextMenuSummarizeThisPage: booleanSetting(
    'local:enable-context-menu-summarize-this-page',
    true,
  ),
  logLevel: logLevelSetting('local:log-level', 'info'),
  summaryInputExceedBehaviour: summaryInputExceedBehaviourSetting(
    'local:summary-input-exceed-behaviour',
    'front',
  ),
} as const;

type GeneralSettingDefinitionMap = typeof GENERAL_SETTING_DEFINITIONS;

type SettingValue<TDefinition> =
  TDefinition extends GeneralSettingDefinition<infer TValue> ? TValue : never;

export type GeneralSettings = {
  -readonly [Key in keyof GeneralSettingDefinitionMap]: SettingValue<
    GeneralSettingDefinitionMap[Key]
  >;
};

export type GeneralSettingKey = keyof GeneralSettings;

export function getGeneralSettingEntries() {
  return Object.entries(GENERAL_SETTING_DEFINITIONS) as Array<
    [GeneralSettingKey, GeneralSettingDefinition<GeneralSettings[GeneralSettingKey]>]
  >;
}

function getDefaultValue<T>(definition: GeneralSettingDefinition<T>) {
  return typeof definition.defaultValue === 'function'
    ? (definition.defaultValue as () => T)()
    : definition.defaultValue;
}

export function createDefaultGeneralSettings(): GeneralSettings {
  return Object.fromEntries(
    getGeneralSettingEntries().map(([key, definition]) => [
      key,
      getDefaultValue(definition),
    ]),
  ) as GeneralSettings;
}
