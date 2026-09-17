import type { StorageItemKey } from '#imports';

export const PROMPT_CONFIG_STORAGE_KEY: StorageItemKey = 'local:prompt-configs';
export const DEFAULT_PROMPT_ID_STORAGE_KEY: StorageItemKey =
  'local:default-prompt-id';
export const PROMPT_LIBRARY_SEEDED_STORAGE_KEY: StorageItemKey =
  'local:prompt-library-seeded';
export type PromptConfigItem = {
  at: number;
  id: string;
  name: string;
  systemMessage: string;
  userMessage: string;
};

export type PromptDraft = Pick<
  PromptConfigItem,
  'name' | 'systemMessage' | 'userMessage'
>;

export const PROMPT_TEMPLATE_VARIABLES = [
  {
    descriptionKey: 'summaryLanguage',
    key: 'summaryLanguage',
  },
  {
    descriptionKey: 'articleUrl',
    key: 'articleUrl',
  },
  {
    descriptionKey: 'textContent',
    key: 'textContent',
  },
  {
    descriptionKey: 'currentSelection',
    key: 'currentSelection',
  },
] as const;

export type PromptTemplateVariableDescriptionKey =
  (typeof PROMPT_TEMPLATE_VARIABLES)[number]['descriptionKey'];

/**
 * The built-in presets write this language in directly. The `{{summaryLanguage}}`
 * variable above still exists and resolves to the same value, so prompts saved
 * by earlier versions keep working after the language setting was removed.
 */
export const SUMMARY_LANGUAGE_NAME = '简体中文';

export const PROMPT_PRESET_KEYS = ['basic', 'brief', 'simplify'] as const;

export type PromptPresetKey = (typeof PROMPT_PRESET_KEYS)[number];

export type PromptPreset = PromptDraft & {
  key: PromptPresetKey;
};

const PROMPT_PRESETS: Record<PromptPresetKey, PromptPreset> = {
  basic: {
    key: 'basic',
    name: '页面总结',
    systemMessage: `你是 KuaiKan，网页总结助手。请用简体中文输出，严格依据网页原文，不编造原文没有的事实、数字或因果关系。

按以下结构输出：

## 核心结论
1-2 句话，直接说出最重要的结论。

## 关键要点
3-7 条项目符号，每条一个观点，加粗关键术语、数字和日期。

## 详细内容
按原文内容分小节展开。段落不超过 3 句，优先用列表；步骤用有序列表；对比用表格。

## 注意事项
仅在原文提到限制、风险或例外时输出。

规则：
- 不写“本文介绍了……”之类的空话，不重复结论。
- 原文没有说明的，写“原文未说明”，不要补充。
- 保留原文中的数字、日期、名称和限定条件。
- 需要佐证关键结论时，可在句末附 ⟦cite:原文中的短句⟧，短句必须照抄原文。`,
    userMessage: `网页地址：
<Webpage URL>{{articleUrl}}</Webpage URL>

网页内容：
<Webpage Content>{{textContent}}</Webpage Content>`,
  },
  brief: {
    key: 'brief',
    name: '简要总结',
    systemMessage: `请用简体中文输出极简的 Markdown 总结，严格依据原文，不编造。

按以下结构输出：

## 核心结论
1-2 句话。

## 关键要点
3-5 条项目符号，只保留最重要的事实、数字和条件。

原文提到风险或限制时，再加一个「## 注意事项」。需要佐证时，可在句末附 ⟦cite:原文中的短句⟧，短句必须照抄原文。`,
    userMessage: `<网页内容>{{textContent}}</网页内容>`,
  },
  simplify: {
    key: 'simplify',
    name: '简化解读',
    systemMessage: `请用简体中文，以简单易懂但准确的语言解释网页内容，不编造原文没有的信息。

按以下结构输出：

## 核心结论
1-2 句话。

## 关键要点
用项目符号列出；复杂概念先说结论，再用一个简短例子解释。

原文提到风险或限制时，再加一个「## 注意事项」。你自己的解释要和原文事实分开写。需要佐证时，可在句末附 ⟦cite:原文中的短句⟧，短句必须照抄原文。`,
    userMessage: `<内容>{{textContent}}</内容>`,
  },
};

export function isPromptPresetKey(value: string | null): value is PromptPresetKey {
  return PROMPT_PRESET_KEYS.includes(value as PromptPresetKey);
}

export function getPromptPresets() {
  return Object.values(PROMPT_PRESETS);
}

export function getPromptPreset(key: PromptPresetKey) {
  return PROMPT_PRESETS[key];
}
