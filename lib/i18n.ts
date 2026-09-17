// This extension is now Chinese-only (self-use fork). `getUiMessages()` keeps
// its original signature and return shape so call sites did not need to
// change — it just always returns the Simplified Chinese copy below.

const UI_MESSAGES = {
  common: {
    allChangesSaved: '所有更改均已保存。',
    back: '返回',
    loadingSettings: '正在加载设置...',
    off: '关闭',
    on: '开启',
    save: '保存',
    saved: '已保存',
    saving: '保存中',
    success: '成功',
    unsavedChanges: '有未保存的更改',
    unknownError: '发生未知错误，请重试',
    collapse: '收起',
    more: '更多...',
    contextMenu: {
      summarizeThisPage: '总结此页',
      openSetting: '打开设置',
    },
  },
  content: {
    badgeLabel: '网页总结',
    summary: '总结',
    reSummarize: '重新总结',
    untitledPage: '未命名页面',
    noModelConfigured: '还没有配置模型，请先在设置中添加。',
    noPromptConfigured: '没有可用的提示词，请先在设置中创建。',
    noPageContent: '页面内容尚未就绪，请稍后重试。',

    tokenViewerInfoTip: '此界面仅用于可视化分词效果。在此处的拖动调节不会改变实际发送给大语言模型的文本内容。',
    calculating: '计算中...',
    settings: '设置',
    close: '关闭',
    thinking: '思考中...',
    reasoningStreaming: '思考中',
    reasoningDone: '思考过程',
    inputTokensLabel: '输入 Token：',
    totalLabel: '总计：',
    viewChangeHint: '点击右侧的眼睛按钮查看/更改',
    tokenPreview: 'Token 预览',
    hideFloatingBall: '隐藏悬浮球',
    citationNotFound: '没有在页面中找到这段原文，可能被改写过或内容尚未加载。',
  },
  general: {
    loadFailed: '通用设置加载失败。',
    restoreDefaults: '恢复默认值',
    saveFailed: '通用设置保存失败。',
    savedToast: '通用设置已保存。',
    sections: {
      contextMenu: {
        description: '选择扩展在页面菜单中提供哪些入口。',
        title: '右键菜单',
      },

      triggers: {
        description: '控制面板的默认行为以及何时自动开始工作。',
        title: '触发',
      },
    },
    settings: {
      enableAutoBeginSummary: {
        description: '',
        label: '启动面板后立即开始总结',
      },
      enableAutoBeginSummaryByActionOrContextTrigger: {
        description: '',
        label: '通过右键菜单触发后立即开始总结',
      },
      enableContextMenuSummarizeThisPage: {
        description: '显示总结当前页面的菜单项。',
        label: '总结当前页面',
      },
      enableFloatingBall: {
        description: '在右下角显示用于打开总结面板的悬浮按钮。',
        label: '悬浮按钮',
      },
      enableSummaryWindowDefault: {
        caution: '这会改变每个匹配页面的默认行为。',
        description: '',
        label: '新页面自动打开面板',
      },
      enableTokenUsageView: {
        description: '显示 token 用量。',
        label: 'Token 用量',
      },
    } as Record<
      | 'enableAutoBeginSummary'
      | 'enableAutoBeginSummaryByActionOrContextTrigger'
      | 'enableContextMenuSummarizeThisPage'
      | 'enableFloatingBall'
      | 'enableSummaryWindowDefault'
      | 'enableTokenUsageView',
      { caution?: string; description: string; label: string }
    >,
    title: '通用设置',
  },
  options: {
    debug: '调试',
    header: {
      defaultModel: '默认模型',
      defaultModelFailed: '默认模型切换失败。',
      defaultPrompt: '默认提示词',
      defaultPromptFailed: '默认提示词切换失败。',
      language: '语言',
      noModels: '还没有模型配置',
      noPrompts: '还没有提示词模板',
    },
    navigation: {
      general: '通用',
      models: '模型',
      prompts: '提示词',
    },
    navigationLabel: '选项',
  },
  models: {
    createModelConfig: '创建模型配置',
    noModelConfigsYet: '暂无模型配置',
    createOneBeforeBackgroundBridge: '请先创建一个模型配置，以便后台脚本可以调用接口。',
    defaultBadge: '默认',
    provider: '提供商 (Provider)',
    baseUrl: '基础 URL',
    apiMode: 'API 模式',
    maxInputTokens: '最大输入 Token',
    price: '价格',
    useDefault: (name: string) => `将 ${name} 设为默认`,
    moveUp: (name: string) => `上移 ${name}`,
    moveDown: (name: string) => `下移 ${name}`,
    duplicate: (name: string) => `复制 ${name}`,
    edit: (name: string) => `编辑 ${name}`,
    delete: (name: string) => `删除 ${name}`,
    deleteConfirm: (name: string) => `确定要删除 "${name}" 吗？`,
    deletedToast: '模型已删除。',
    deleteFailed: '模型删除失败。',
    moveFailed: '模型移动失败。',
    duplicatedToast: '模型已复制。',
    duplicateFailed: '模型复制失败。',
    defaultChangedFailed: '默认模型切换失败。',
  },
  pageExtraction: {
    method: {
      description: '获取页面内容的算法',
      title: '页面内容提取方式',
    },
    methods: {
      'dom-heuristic': {
        description:
          '按语义 DOM 容器打分，保留文档提示块、注释等较长的可见内容。',
        label: 'DOM 启发式',
      },
      readability: {
        description: '按阅读模式提取文章内容。https://github.com/mozilla/readability',
        label: 'Readability',
      },
    },
  },
  prompts: {
    create: '创建提示词',
    createFromPreset: '从预置开始：',
    createdToast: '提示词已创建。',
    defaultBadge: '默认',
    delete: (name: string) => `删除 ${name}`,
    deleteConfirm: (name: string) => `确认删除“${name}”？`,
    deleteFailed: '提示词删除失败。',
    deletedToast: '提示词已删除。',
    edit: (name: string) => `编辑 ${name}`,
    emptyDescription: '先创建一个提示词模板，再组装总结输入。',
    emptyTitle: '还没有提示词模板',
    libraryDescription:
      '在这里管理可复用的 system 和 user 模板，选择默认项，并调整后续选择器中的顺序。',
    libraryTitle: '提示词模板',
    loadFailed: '提示词设置加载失败。',
    makeDefault: (name: string) => `将 ${name} 设为默认提示词`,
    missingPromptId: '缺少提示词 ID。',
    moveDown: (name: string) => `下移 ${name}`,
    moveFailed: '提示词顺序调整失败。',
    moveUp: (name: string) => `上移 ${name}`,
    name: '名称',
    namePlaceholder: '文章总结',
    promptNotFound: '未找到提示词。',
    saveFailed: '提示词保存失败。',
    savedToast: '提示词已保存。',
    selectDefaultFailed: '默认提示词切换失败。',
    systemMessage: 'System 消息',
    systemMessageDescription: '定义总结行为、输出语言和输出格式。',
    templateVariables: '模板变量',
    templateVariablesDescription: '组装总结请求时会渲染这些占位符。',
    userMessage: 'User 消息',
    userMessageDescription: '包裹页面输入并补充任务上下文。',
    variableDescriptions: {
      articleUrl: '当前总结页面的 URL。',
      currentSelection: '页面中当前存在的选中文本。',
      summaryLanguage: '输出语言名称（如「简体中文」「English」），由设置中的语言代码转换而来。',
      textContent: '作为总结输入的页面提取文本。',
    },
  },
  pageTitles: {
    createModel: '创建模型',
    createPrompt: '创建提示词',
    editModel: '编辑模型',
    editPrompt: '编辑提示词',
    models: '模型',
    prompts: '提示词',
    welcome: '欢迎',
  },
  popup: {
    provider: '配置',
    noActiveTab: '没有可用的当前标签页',
    pageSupported: '当前页面可以开始总结',
    pageUnsupported: '当前页面暂不支持内容提取',
    openOptions: '设置',
    model: '模型',
    prompt: '提示词',
    summary: '总结',
    page: '页面',
    openPanelAndStartSummary: '打开总结面板并立即开始总结',
    copyPageContentToClipboard: '把页面内容复制到剪切板',
    extractFailed: '页面内容提取失败',
    copySuccess: '已复制页面内容到剪切板',
    copyFailed: '复制失败',
    invokeSummaryFailed: '无法触发总结',
  },
};

export function getUiMessages() {
  return UI_MESSAGES;
}
