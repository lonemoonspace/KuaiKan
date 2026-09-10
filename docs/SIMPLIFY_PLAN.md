# KuaiKan 精简与修复工作计划

> 背景：本项目已转为**纯自用**。不上架 Chrome Web Store、不发 GitHub Release、不需要多语言、
> 不需要 Firefox。目标是在保住核心体验（打开页面 → 一键/自动总结 → 看完即走）的前提下，
> 删掉一切为「公开分发的多用户产品」而存在的代码，并修掉 review 中发现的真 bug。
>
> 执行：Sonnet 5　验收：Opus 5
>
> **核心原则：这是一次以删代码为主的重构。遇到取舍时，一律选择删得更干净的那一边。**
> 任何「先留着以后可能有用」的犹豫都按删除处理 —— 代码在本地，随时能从历史里翻回来。

## 已确认的产品决策（不要再自行发挥）

| 决策 | 结论 |
|---|---|
| 会话恢复 / 摘要库 / 导出对话 | **三个全删** |
| 摘要输出语言设置（`{{summaryLanguage}}`） | **保留**，并修掉内置 prompt 无视它的问题 |
| 面板形态 | **只留浮动面板 + popup**；删侧边栏、删「新建副本面板」 |
| UI 语言 | **只留简体中文**，删掉九语言机制 |
| Firefox | 删除所有相关分支 |
| 商店 / GitHub / 发布流程 | 全删，只保留本地 `npm run build` / `npm run zip` |

## 全局约束

- **不要运行 `npm run dev`**（常驻后台），需要重启时通知用户手动操作。
- 每个阶段结束必须能通过 `npm run compile`（`tsgo --noEmit`），**零类型错误**。
- 不引入新的运行时依赖。本计划只做删除、修复、以及一个开发期测试框架。
- 存储键常量继续集中在 `constants/*`，业务代码不写裸字面量。
- 删除某个模块时，连同它的类型、常量、i18n 文案、设置项 UI、AGENTS.md 记录一起删干净，
  不留孤儿。**判断标准：删完之后全局 grep 该功能的关键词应当零命中（文档除外）。**
- 每阶段独立提交心智：阶段之间不要交叉改动，方便逐段验收。

---

# 阶段 P0：先修真 bug

这一阶段不删东西，只修。做完 P0 再进入删除阶段，避免把 bug 连同代码一起删掉、事后说不清。

## P0-1　内置 Prompt 硬编码简体中文，`{{summaryLanguage}}` 形同虚设

**文件**：`constants/prompt-settings.ts`

**现状**：`PROMPT_PRESETS` 的三个预设（`basic` / `brief` / `simplify`）系统提示词里全部写死
「请始终使用简体中文」。而 `entrypoints/content/summary/useContentApp.ts:501` 附近构造的
Mustache view 里明明传了 `summaryLanguage`，没有任何预设引用它 —— 用户在通用设置里改
「摘要语言」完全不生效。

**改法**：

1. 三个预设中所有「请始终使用简体中文」「请使用简体中文」之类的措辞，统一替换为引用变量，例如：
   `请始终使用 {{summaryLanguage}} 输出。`
2. 预设的 `name` 字段保持中文（「页面总结」「简要总结」「简化解读」），那是 UI 展示名，不是输出语言。
3. `constants/general-settings.ts` 里 `summaryLanguage` 的默认值目前是
   `() => browser.i18n.getUILanguage()`。改为固定的 `'zh-CN'`，去掉对 `browser.i18n` 的依赖
   （P1-4 会删掉 `_locales`，这个 API 的返回值将不再可控）。

**注意**：只有**新播种**的 prompt 会用到新预设。用户已有的 prompt 存在
`local:prompt-configs` 里，不会被自动改写 —— 这是正确行为，不要写迁移去覆盖用户编辑过的 prompt。
在阶段汇报里明确提醒用户：**想用上修好的预设，需要在设置页手动新建一个 prompt，或删掉旧的重新播种。**

## P0-2　引用溯源标记锁死在中文字面量

**文件**：`components/ai-elements/message.tsx:66`、`constants/prompt-settings.ts`

**现状**：`const CITATION_PATTERN = /⟦引用:([^⟧]+)⟧/g`。P0-1 改完之后，模型被要求用英文/日文输出时
极可能把「引用」二字一起翻译掉，引用 chip 功能静默失效。

**改法**：

1. 预设 prompt 里的标记格式统一改为语言无关的 `⟦cite:原文短句⟧`，
   并在提示词里明确写「标记前缀必须原样保留为 `cite:`，不要翻译」。
2. `CITATION_PATTERN` 改为同时接受两种前缀，兼容用户已存的中文版 prompt：
   `/⟦(?:引用|cite):([^⟧]+)⟧/g`
3. `CITATION_PLACEHOLDER_PATTERN`（`⟦kuai-cite:(\d+)⟧`）是内部占位符，不用动。
4. 确认 `extractCitationPhrases` / `buildCitationChips` 的转义逻辑不受影响 ——
   现有实现是「解析前抽出、渲染后塞回」，只改正则不会破坏它。

---

# 阶段 P1：删功能

## P1-1　删除「会话恢复 + 摘要库 + 导出对话」整套基建

这套东西是为多轮对话设计的，但面板从 0.8.0 起就没有追问输入框，属于半挂状态。
顺带解决了 review 里「会话按 host 存导致同站不同文章串台、并吞掉自动总结」的 bug ——
数据结构没了，bug 自然没了。

**整文件删除**：

- `lib/chat-archive.ts`
- `lib/chat-session-storage.ts`
- `lib/summary-library-storage.ts`
- `entrypoints/options/pages/LibraryPage.tsx`

**`entrypoints/content/summary/useContentApp.ts` 需要摘掉的部分**（这是本阶段最大的一处改动）：

- 上述三个模块的全部 import。
- 状态：`savedSummaryId`。
- 会话串行化基建：`sessionOpsRef`、`runSessionOp`（整个 useCallback 一起删）。
- 初始化 effect 里 `loadSessionByHost` 那一段，以及 `restoredSession` 变量。
  删掉后自动总结的判断简化为 `if (generalSettings.enableAutoBeginSummary) setAutoSummarizePending(true)`。
- 初始化 effect 里 `findSummaryByUrl` 那一段。
- 「按 host 持久化会话」的那个 effect（注释为 `Persist the current session per host...`）整个删除。
- handler：`handleClearConversation`、`handleToggleSaveSummary`、`handleExportMarkdown`、
  `handleCopyMarkdown`、`handleCopyJson`。
- 上述 handler 专用的辅助函数：`buildFrontMatter`、`collectLatestAssistantText`。
  （`collectText` 如果删完没人用了也一起删。）
- 返回对象里对应的字段全部移除。
- `host` / `pageUrl` / `pageTitle` 这几个 memo：删完上面这些之后逐个确认是否还有使用者，
  没有就一起删。

**`entrypoints/content/summary/ContentAppFrame.tsx` 需要摘掉的部分**：

- 顶栏的收藏按钮（`Star`，`title="Save to library"`）。
- 顶栏的清空按钮（`Trash2`，`title="Clear conversation"`）。
- 右上角的导出下拉菜单（`Download` 图标 + `DropdownMenu` 三个菜单项）。
- 随之不再使用的 import：`Star`、`Trash2`、`Download`、`DropdownMenu` 系列。
- `shadowPortalContainer` 这个 memo 只为导出下拉的 Radix portal 存在 —— 确认没有其他
  Radix portal 用它之后删掉。**注意 `ModelPromptSelector` 里可能也有 Radix 下拉需要它，
  删之前先 grep 确认。**
- `hasMessages` 变量删完是否还有用，按实际情况处理。

**其他**：

- `entrypoints/options/router.tsx`：删掉 `/library` 路由和 `LibraryPage` 的 import。
- `entrypoints/options/layout/OptionsLayout.tsx`：删掉侧边导航里指向 `/library` 的入口。
- `lib/i18n.ts` 里 library / 导出 / 清空会话 相关的文案键（P1-4 会重写这个文件，
  在那一步一并清理即可，但要记得清）。

**保留**：`lib/scroll-to-text.ts` 和引用 chip 功能不动（它服务于 P0-2，不属于这套基建）。

## P1-2　删除「副本面板」

**`entrypoints/content/ContentEntrance.tsx`**：

- 删 `copies` 状态、`handleAddCopy`、`handleCloseCopy`。
- 删渲染 `copies.map(...)` 的整个 JSX 块。
- `<ContentAppFrame>` 不再传 `onAdd`。

**`entrypoints/content/summary/ContentAppFrame.tsx`**：

- 删 props `onAdd` 和 `isMain`。
- 删顶栏的 `PlusSquare` 新建按钮及其 `enableCreateNewPanelButton` 开关读取。
- 删 `PlusSquare` import。

**`entrypoints/content/summary/useContentApp.ts`**：

- 删参数 `isMain`（现在恒为主面板），删掉函数体内所有 `isMain &&` 条件分支。

**设置项**：

- `constants/general-settings.ts`：删 `enableCreateNewPanelButton` 定义。
- `entrypoints/options/pages/InterfacePage.tsx`：删对应的开关 UI（约 316–332 行那一块）。
- `lib/i18n.ts`：删 `enableCreateNewPanelButton` 文案键。

## P1-3　删除「侧边栏面板」

**`components/container/PanelContainer.tsx`**（收益最大的一处，234 行应能砍到 100 行上下）：

- 删 `sidebarSqueezeOwner`、`writeHostSqueeze`、`clearHostSqueeze`、`updateHostSqueeze`、
  `squeezeTokenRef`，以及页面挤压相关的两个 effect（含 `ResizeObserver` 那个）。
- 删 `startSidebarResize` 及其 `useResizable` 调用。
- 删 `sidebarWidth` / `sidebarStateKey` / `isSidebarLoaded` 及 `local:<key>-sidebar-width` 存储。
- 渲染分支只保留 floating，删掉 `isFloating ? ... : ...` 的三元，className 直接用浮动那套。
- `PanelContainerProps.defaultMode` 和 `initialOffset` 在没有副本面板后也没有调用方传值了，
  一并删除。

**`components/container/PanelContext.tsx`**：

- `PanelMode` 类型删掉 `'sidebar'`。如果删完之后 `mode` 恒为 `'floating'`、
  `setMode` 无人调用，**把整个 PanelContext 删掉**，`usePanel` 的调用点改为直接写死浮动样式。
  这是本阶段的首选方案；只有在删除会引起大面积连锁改动时才退而保留。

**`components/container/internal/interactions.ts`**：

- 检查 `useResizable` 的 `modifyLeftOnResize` 选项是否只被侧边栏用到（原代码那里还挂着
  一个 `@ts-ignore`）。是的话删掉该选项和 `@ts-ignore`。

**`entrypoints/content/summary/ContentAppFrame.tsx`**：

- 删浮动/侧边栏切换按钮（`PanelRight` / `PictureInPicture2`）及其 import。
- 删所有 `mode === 'sidebar'` / `mode !== 'sidebar'` 分支，只保留浮动分支。
- 删底部那个只在 sidebar 模式渲染的 `ModelPromptSelector`（`variant="sidebar"`）。

**`entrypoints/content/summary/ModelPromptSelector.tsx`**：

- 删 `variant` prop 及 `sidebar` 分支，只保留 floating 的样式。

**`entrypoints/content/ContentEntrance.tsx`**：

- 删 `panelLayoutMode` 的读取和 `defaultMode` 计算。

**设置项**：

- `constants/general-settings.ts`：删 `panelLayoutMode` 定义、`PanelLayoutMode` 类型、
  `isPanelLayoutMode`。
- `entrypoints/options/pages/InterfacePage.tsx`：删面板形态选择 UI（约 230–285 行）。
- `entrypoints/options/pages/GeneralPage.tsx`：从字段联合类型里删掉 `'panelLayoutMode'`。
- `lib/i18n.ts`：删相关文案键。

## P1-4　UI 只保留简体中文

**`lib/i18n.ts`（1821 行 → 目标 300 行以内）**：

- `UI_MESSAGES` 只保留 `'zh-CN'` 那一份（原 678–1014 行），其余八种语言的对象全部删除。
- 删除：`UiLocale` 类型、`UI_LOCALE_OPTIONS`、`UI_LOCALE_OVERRIDE_STORAGE_KEY`、
  `UI_LOCALE_OVERRIDE_LOCAL_STORAGE_KEY`、`resolveUiLocale`、`isUiLocale`、
  `canUseExtensionLocalStorage`、`getUiLocaleOverride`、`setUiLocaleOverride`、
  `getUiLocale`、`refreshUiLocaleOverrideFromStorage`，以及 localStorage / storage.local
  的整套镜像逻辑。
- **保留 `getUiMessages()` 这个导出名和它返回对象的结构**，不带参数，直接返回中文文案对象。
  这样绝大多数调用点一行都不用改 —— 这是本步骤成本最低的做法，务必照做。

**调用点清理**：

- `entrypoints/content/ContentEntrance.tsx`：删 `refreshUiLocaleOverrideFromStorage` 调用、
  `localeTick` 状态、以及监听 `UI_LOCALE_OVERRIDE_LOCAL_STORAGE_KEY` 的整个 effect。
- `entrypoints/content/scope.tsx`、`entrypoints/background/control.ts`：删
  `refreshUiLocaleOverrideFromStorage` 的 import 和调用。
- `entrypoints/options/layout/OptionsLayout.tsx`：删顶部的语言下拉 `<select>` 及
  `reloadOptionsPage` 相关逻辑。
- `entrypoints/options/pages/GeneralPage.tsx`：删 `getUiLocale`，把所有
  `uiLocale === 'zh-CN' ? 'X' : 'Y'` 形式的三元**就地展开成中文字面量**。
- `lib/error-taxonomy.ts:100`：删 `getUiLocale`，只保留中文错误文案。
- 全局 grep `getUiLocale`、`UiLocale`、`UI_LOCALE`，确认零残留。

**`public/_locales/`**：

- 整个目录删除（九个语言各一份 `messages.json`）。
- `wxt.config.ts`：`manifest` 里的 `__MSG_extStoreName__` / `__MSG_extDescription__` /
  `__MSG_Command_Open_Panel_DESC__` 改为直接写中文字面量，删掉 `default_locale` 字段。
  （`default_locale` 必须指向真实存在的 `_locales` 目录，删了目录就必须删这个字段，
  否则扩展加载会直接失败 —— 这一条务必验证。）

## P1-5　删除 Firefox 相关分支

- `entrypoints/background/cors-fix.ts`：删 `if (import.meta.env.FIREFOX) return;` 那个提前返回，
  以及文件头注释里的 `## Firefox` 一节。
- 全局 grep `FIREFOX`、`firefox`，清理残留（含注释）。
- `lib/*` 中若有为 Firefox 写的兼容代码（例如 1.5.1 提到的「延迟 `URL.revokeObjectURL`」），
  随 P1-1 删除导出功能时一并消失，不必单独处理。

## P1-6　删除商店 / GitHub / 发布流程

- 删 `.github/`（整个目录）。
- 删 `release/`（37 MB 的历史 zip 存档；本地构建产物在 `.output/chrome-mv3`，不需要归档）。
- 删 `scripts/release.mjs`，`package.json` 里删 `release` script。
  **保留 `build` / `zip` / `compile` / `postinstall`。**
- 删 `docs/RELEASE_WORKFLOW.md`、`docs/webstore/`、`docs/README_zh.md`、`CONTRIBUTING.md`。
- 删 `stats.html`（1.1 MB 构建分析产物，已在 `.gitignore` 里）和 `pnpm-install.log`、
  `pnpm-workspace.yaml`。
- **保留 `LICENSE`**：本项目是 fork，上游许可证义务与是否公开发布无关。
- `README.md` 重写为一份简短的自用说明：项目是什么、如何 `npm run build`、
  如何在 Chrome 里加载 `.output/chrome-mv3` 未打包扩展、以及保留对上游项目的致谢链接。
  删掉商店徽章、演示 webp 的 `<details>` 集合、贡献指引、更新历史章节。
- `docs/video/`、`docs/img/` 共 11 MB 的演示素材：README 重写后若不再引用，一并删除。
- `CHANGELOG.md` 保留（本地版本记录仍有用），在末尾新增本次精简的条目。

---

# 阶段 P2：清死代码与死依赖

## P2-1　删除零引用组件

以下文件全局零引用，直接删：

- `components/ai-elements/prompt-input.tsx`（1463 行，0.8.0 删掉追问输入框后的孤儿）
- `components/ai-elements/conversation.tsx`（238 行）
- `components/ai-elements/shimmer.tsx`
- `components/ui/collapsible.tsx`
- `components/ui/settings-card.tsx`

删除后重新跑一遍零引用检查（P1 的删除可能又制造了新的孤儿组件，
`components/ui/command.tsx`、`hover-card.tsx`、`radio-group.tsx`、`button-group.tsx`
都值得复查）。**发现新的孤儿就继续删，直到没有为止。**

## P2-2　删除未使用依赖

`package.json` 中以下依赖全局零 import，删除后重新 `npm install`：

- `js-tiktoken`（实际用的是 `gpt-tokenizer/model/gpt-5`）
- `markdown-it` + `@types/markdown-it`（实际用的是 `marked`）
- `eventemitter3`
- `react-use`

P1/P2-1 删完后需要**重新核对**下列依赖是否变成孤儿，是则一并删除：
`cmdk`（仅被 `ui/command.tsx` 用）、`nanoid`（仅被 `prompt-input.tsx` 用）、
`motion`（仅被两个 options 列表页用，确认是否还在用）、
`@radix-ui/*` 里随组件删除而失去引用的那些。

**计划修订（P1 验收后）**：`web-streams-polyfill` **现在也要删**。原计划写的是「不要删，
`entrypoints/content/polyfill.ts` 在用」，但 P1-5 已经证实该 polyfill 整个文件都包在
`import.meta.env.FIREFOX` 里、纯为 Firefox 存在，文件已随 P1-5 删除，这个依赖现已成孤儿。
（Chrome 原生支持 `ReadableStream`/`WritableStream`/`TransformStream`，删除无风险。）

**不要删**：`picomatch`（站点规则 glob）、`radash`、`@types/marked`（如确认 `marked` 自带类型
则可删，需先验证 `npm run compile` 通过）。

## P2-3　面板内硬编码英文文案改中文

`ContentAppFrame.tsx` 里仍有一批写死的英文 `title` / 文案，UI 已是纯中文，统一改为中文并
走 `getUiMessages()`（缺的键就往 i18n 的中文对象里加）：

`"Settings"`、`"Close"`、`"Input Tokens: "`、`"Thinking..."`、
`"click the right eye button to View&Change"`，以及 P1 删除后仍残留的其他英文 title。

**追加**：`entrypoints/popup/index.html` 的 `<title>Webpage Summary</title>` 改为中文。
它决定了构建产物 manifest 里的 `action.default_title`（工具栏图标的悬停提示），
是目前产物中唯一残留的英文。改完重新构建，确认 `.output/chrome-mv3/manifest.json`
的 `action.default_title` 已变为中文。

## P2-4　清理已失效的历史文档与残留配置（P1 验收后追加）

P1 完成后，下列文件描述的都是已经不存在的东西，留着会误导以后的自己（和 AI）：

- `plan.md`（根目录，30 KB，1.6.0 之前的改名/优化计划，引用了已删除的
  `docs/README_zh.md`、`docs/webstore/`）
- `docs/UX_OPTIMIZATION_PLAN.md`（**它描述的正是 P1-1 刚刚删掉的会话恢复 / 摘要库 /
  导出对话三件套**，现已完全失效）
- `review-report.md`、`CODE-REVIEW-2026-09-08.md`（两份历史 review 报告，
  其中的问题已在 1.5.1 / 1.6.0 修完）
- `web-ext.config.ts.example`（`web-ext` 是 Firefox 的调试工具链，属 P1-5 漏网）
- `agent-browser.json`（AGENTS.md 已明确约定不使用 AgentBrowser 测试）

**保留** `docs/SIMPLIFY_PLAN.md`（本文件）、`CHANGELOG.md`、`AGENTS.md`、`README.md`、`LICENSE`。

## P2-5　内置 Prompt 的结构小标题去中文化（P0-1 的收尾）

P0-1 把「请始终使用简体中文」改成了 `{{summaryLanguage}}`，但三个预设里**规定的小标题
仍是中文字面量**（`## 核心结论`、`## 关键要点`、`## 详细内容`、`## 注意事项`）。
用户把摘要语言切成 English 时，模型收到的是「用 English 输出」+「小标题必须叫『核心结论』」
这样自相矛盾的指令，实际会产出中英混杂的结果。

**改法**：把小标题从「规定字面量」改为「描述其含义」，让模型用目标语言自行命名。例如
`用一个「核心结论」小标题（用输出语言命名）开头，写 1-2 句话……`。
三个预设统一处理，保持中文输出时的效果不变。

---

# 阶段 P3：工程基建

## P3-1　引入 vitest，为纯函数补测试

CHANGELOG 里 1.4.0 / 1.5.1 / 1.6.0 连续三个版本修的都是回归型 bug，其中 1.4.0 那个迁移
bug 直接清空了用户全部模型配置和 API Key。这是本项目最该补的一块。

- 加 `vitest` 到 devDependencies，`package.json` 加 `"test": "vitest run"`。
- 配置需要能解析 `@/` 别名（与 `tsconfig.json` 一致）。涉及 `#imports`（WXT 虚拟模块）的
  文件需要 mock `wxt/storage`，**优先挑选不依赖 `#imports` 的纯函数**，避免为了测试引入
  一堆 mock 基建。
- 目标测试对象（按价值排序）：
  1. `lib/migration.ts` —— 尤其是「`local:` 前缀不能被当成真实 key 的一部分」这条不变量，
     以及迁移的幂等性。这是那个严重事故的根因，必须有测试钉死。
  2. `lib/error-taxonomy.ts` —— `classifySummaryError`：HTTP status 优先于消息匹配；
     `abort` 必须是整词匹配，`"...aborted the request due to invalid_api_key"` 这类
     provider 响应体不能被误判为用户主动停止。
  3. `lib/token-count.ts` 的 `truncateByTokens` —— `front` / `middle` / `back` / `nothing`
     四种策略的边界行为。
  4. `lib/site-rules-storage.ts` 的 glob 匹配 / `isUrlAllowed` —— 白名单黑名单优先级。
  5. `lib/page-extraction.ts` 的 `cleanExtractedText` —— 纯字符串函数，零成本。
- 不追求覆盖率数字，每个函数 3–6 个用例，覆盖正常路径 + 已知踩过的坑即可。

## P3-2　补 lint 配置（可选，但建议做）

代码里散落着 `// eslint-disable-next-line react-hooks/exhaustive-deps`，但项目**根本没有
ESLint 配置** —— 在关一个不存在的 linter。而 `react-hooks/exhaustive-deps` 恰恰是这个项目
栽过跟头的地方（1.5.1「总结按钮是空操作」就是 stale closure）。

加一份最小的 ESLint flat config，只开 `react-hooks` 插件的两条规则，`package.json` 加
`"lint": "eslint ."`。跑一遍，把现有的 disable 注释逐条复核：
**确实必要的保留并补一句为什么，站不住脚的就按规则修掉。**

---

# 阶段 P4：性能（做完 P1–P2 后再评估）

**先测量，再决定做不做。** P1/P2 删掉的东西（八种语言文案、会话与摘要库、副本与侧边栏、
1900 行死组件）本身就会明显缩小产物。P1–P2 完成后重新构建并记录：

```
find .output/chrome-mv3 -name '*.js' -exec ls -la {} \; | awk '{print $5, $9}' | sort -rn
```

基线（精简前）：`background.js` 2.86 MB，`content.js` 914 KB，`chunks/options-*.js` 484 KB。

## P4-1　流式渲染的二次方开销（建议做，收益明确）

`components/ai-elements/message.tsx:386` 的 `MessageResponse`：每收到一个流式 chunk，
effect 就把**整段**文本重新 `marked.parse` 一次，再整体 `dangerouslySetInnerHTML` 替换。

两个后果：解析开销随长度呈二次方增长；每帧摧毁并重建 DOM，导致用户在流式过程中划词复制
会被反复清空、滚动锚点保不住。

### 确定的实现方案（P3 验收后细化）

采用**自包含的尾沿节流**，不改 `MessageResponse` 的 props 签名、不往下传 `status`。
分三部分：

**(a) 把 marked 的加载与 renderer 构造提到模块级**

现状是每个 chunk 都重新 `import('marked')`、`new Renderer()`、重新挂三个 renderer 方法。
模块本身有缓存，但 renderer 每次重建纯属浪费。改为模块级单例：

```ts
let markdownRendererPromise: Promise<(text: string) => string> | null = null;
function loadMarkdownRenderer() { /* 只在首次构造 marked + Renderer，返回同步的 render 函数 */ }
```

renderer 的三个方法（`html` / `link` / `image`）实现原样搬过去，**一行都不要改**。

**(b) 组件内做 100 ms 尾沿节流**

- 用 ref 保存最新的 `children`，定时器回调**从 ref 读取**最新值 —— 这样天然不会出现
  「旧解析结果覆盖新文本」的竞态。
- **首次必须立即解析**（leading edge），否则第一帧要等 100 ms 才出内容，反而更慢。
- **必须保证尾沿调用**：流式结束后 `children` 不再变化，最后一次变更也必须被解析。
  这是本改动最关键的正确性要求 —— 漏掉尾沿会导致摘要末尾几十个字永久不渲染。
- 卸载时清掉定时器。

**(c) 顺带给两个纯函数补测试**

`extractCitationPhrases` / `buildCitationChips` 目前未导出、未被测试，但它们负责引用短语的
转义（安全相关，1.5.1 修过一次双重转义）。导出这两个函数并补 vitest 用例：
标记抽取与占位符还原、含 markdown 字符（`& < > " *`）的短语、超 60 字截断、
未匹配到的占位符、新旧两种标记前缀（`⟦cite:⟧` 与 `⟦引用:⟧`）。

### 绝对不能在这次重构中被削弱的行为

以下都是 1.2.0 / 1.5.1 专门加固过的，搬运代码时逐条核对：

- `renderer.html` 对 html token 做 `escapeHtml`
- `renderer.link` / `renderer.image` 的 `isSafeUrl` 协议白名单（http/https/mailto），
  不安全的 image 降级为文本
- 引用标记「解析前抽出、渲染后塞回」的顺序（保证短语只被转义一次）
- `addEvidenceLabel` 对 blockquote/cite 的标注
- `memo` 的比较函数（`prevProps.children === nextProps.children`）

### 已知局限（不在本次范围内，别顺手扩大）

节流把全量重解析的频率降了约 10 倍，但**没有消除** `dangerouslySetInnerHTML` 整体替换 DOM
的问题 —— 流式过程中划词选中仍会在每次刷新时被清空，只是从「每个 chunk 一次」变成
「每 100 ms 一次」。彻底解决需要按 markdown 块做增量 DOM 更新，改动量大得多，**本次不做**。

## P4-2　content script 懒加载（视 P4 测量结果决定）

`entrypoints/content/index.ts` 是 `matches: ['<all_urls>']` + `document_idle` 无条件注入，
意味着每开一个标签页都要解析整个 content bundle，而绝大多数页面用户根本不会点总结。

若 P1–P2 之后 `content.js` 仍显著偏大，再考虑：入口只保留悬浮球 + 消息监听，
`ContentAppFrame` 整棵树走动态 `import()`。

**注意**：WXT 的 content script 默认打成单文件 IIFE，代码分割需要额外配置，
且拆出的 chunk 必须加进 `web_accessible_resources`。这一项改动风险高于收益不确定性，
**没有实测数据支撑就不要做**。

---

# 验收标准

每个阶段交付时必须满足：

1. `npm run compile` 零错误。
2. `npm run build` 成功产出 `.output/chrome-mv3`。
3. 该阶段涉及的删除项，全局 grep 关键词零残留（文档与 CHANGELOG 除外）。
4. 汇报中说明：删了哪些文件、改了哪些文件、**以及任何计划里没预料到的连锁改动**。

**发现计划有误时，停下来说明，不要自行改变已确认的产品决策。**
计划中的实现细节（行号、具体删法）如与实际代码不符，以实际代码为准并在汇报中指出。

## 人工验证清单（Opus 5 验收后交由用户实机确认）

自动检查覆盖不到浏览器行为，以下需要用户手动加载 `.output/chrome-mv3` 后确认：

- 扩展能正常加载（P1-4 动了 manifest 的 `default_locale`，这是最可能出问题的一处）。
- 悬浮球出现，点击打开浮动面板，拖拽与缩放正常。
- 总结能正常流式输出；顶栏无残留的失效按钮。
- 设置页六个页面均可打开，无空白路由；语言下拉已消失，面板形态选项已消失。
- 快捷键（Alt+S）、右键菜单、popup 三个触发路径均正常。
- 改「摘要语言」为 English 后，**用新播种的 prompt** 总结，输出确为英文（验证 P0-1）。
