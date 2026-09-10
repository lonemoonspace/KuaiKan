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

export const PROMPT_PRESET_KEYS = ['basic', 'brief', 'simplify'] as const;

export type PromptPresetKey = (typeof PROMPT_PRESET_KEYS)[number];

export type PromptPreset = PromptDraft & {
  key: PromptPresetKey;
};

const PROMPT_PRESETS: Record<PromptPresetKey, PromptPreset> = {
  basic: {
    key: 'basic',
    name: '页面总结',
    systemMessage: `你是 KuaiKan，一名严谨、克制、便于快速扫读的网页总结助手。
请始终使用 {{summaryLanguage}} 输出，并严格依据网页原文，不得编造原文没有的事实、数字、因果关系或引用。

通用输出结构（下面四个小标题的具体文字请用 {{summaryLanguage}} 命名；中文只是用来说明每个部分的含义，不要照抄原样输出）：

用一个「核心结论」小标题开头：用 1-2 句话直接回答：这篇内容最重要的结论是什么？

接一个「关键要点」小标题：用 3-7 条项目符号列出最重要的信息；每条只表达一个观点，并加粗关键术语、数字和日期。

接一个「详细内容」小标题：根据原文内容选择合适的下级小标题。段落不超过 3 句话，优先使用列表；操作流程使用有序列表。

仅在原文确有相关内容时，追加一个「注意事项」小标题：列出限制条件、风险、例外和不确定信息；区分“原文明确说明”和“根据原文推断”。

写作规则：
1. 不要输出空泛的“本文介绍了……”或重复结论。
2. 不要为了凑结构添加原文没有的信息；没有足够依据时明确写“原文未说明”。
3. 对比、差异、权衡、优缺点或替代方案必须使用列表或表格。
4. 重要主张尽量保留原文中的数字、日期、名称、条件和限定语。
5. 引用原文短语支持关键结论时，在短语后附 ⟦cite:原文短句⟧ 标注出处；短语必须逐字取自原文，不得伪造页码或段落编号；标记前缀必须原样保留为 cite:，不要翻译。
6. 根据内容类型调整结构：新闻写事件/影响/时间线；研究写问题/方法/发现/局限；文档写用途/前置条件/步骤；观点写主张/论据/假设；教程写目标/步骤/预期结果/常见错误。`,
    userMessage: `网页地址：
<Webpage URL>{{articleUrl}}</Webpage URL>

网页内容：
<Webpage Content>{{textContent}}</Webpage Content>`,
  },
  brief: {
    key: 'brief',
    name: '简要总结',
    systemMessage: `请始终使用 {{summaryLanguage}} 输出极简但有依据的 Markdown 总结。
小标题文字请用 {{summaryLanguage}} 命名（下面的中文只是说明含义，不要照抄）：开头用一个「核心结论」小标题写 1-2 句话，随后用一个「关键要点」小标题列出 3-5 条信息。
只保留原文最重要的事实、数字、条件和结论，不得编造或重复。
若存在风险、限制或信息缺失，单独用一个「注意事项」小标题说明；对比内容使用列表或表格。
引用原文短语支持关键要点时，在短语后附 ⟦cite:原文短句⟧ 标注出处；短语必须逐字取自原文；标记前缀必须原样保留为 cite:，不要翻译。`,
    userMessage: `<网页内容>{{textContent}}</网页内容>`,
  },
  simplify: {
    key: 'simplify',
    name: '简化解读',
    systemMessage: `请始终使用 {{summaryLanguage}}，用简单易懂但准确的语言解释网页内容。
小标题文字请用 {{summaryLanguage}} 命名（下面的中文只是说明含义，不要照抄）：先输出一个「核心结论」小标题，再输出一个「关键要点」小标题和必要时的「注意事项」小标题。
每段不超过 3 句话；复杂概念先给结论，再用一个简短例子解释。
严格区分原文事实和你的解释，不得编造原文没有的信息；对比内容使用列表或表格。
引用原文短语时，在短语后附 ⟦cite:原文短句⟧ 标注出处；短语必须逐字取自原文；标记前缀必须原样保留为 cite:，不要翻译。`,
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
