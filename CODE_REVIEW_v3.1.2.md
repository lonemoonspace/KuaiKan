# KuaiKan 全量代码审查报告（v3.1.2）

- **审查对象**：`/data/dsh/home/KuaiKan` 全部源码（约 16.3k 行 TS/TSX + 配置 + 测试）
- **基线 commit**：`5bf6408`（"发布 v3.1.2（代码审查修复：图片 alt 注入、存储破坏性写入、Ollama 不可用等 29 项）"）
- **审查方式**：逐文件通读 + 针对可疑点写脚本实证（marked 渲染、Tailwind 任意值、依赖源码）+ 两轮只读子代理审计（`components/**`、`lib/page-extraction|scroll-to-text` 等）
- **只读**：未修改任何源码，未执行 `npm run dev` / 未构建
- **当时门禁**：`npx tsgo --noEmit` = 0 错误；`npx eslint .` = 0 问题；`npx vitest run` = 17 文件 / 184 用例全通过（≈5.4s）

> 说明：本报告刻意不重复 `CODE_REVIEW_v3.1.1.md` 中已在 `5bf6408` 修掉的条目。行号基于上述 commit；带"疑似"的条目我无法在本机验证（无浏览器、无 jsdom），已给出一行人工验证方法。

---

## 0. 结论摘要

**没有发现可远程利用的 RCE / 凭据泄漏 / 认证绕过。** 注入面、密钥隔离、消息信任边界这三条最关键的安全线都经得起检查（见 §6）。问题集中在**长页面场景下的可用性与性能**、**输入预算正确性**、**错误分类**和**大量一致性/可维护性瑕疵**。

按严重度：

| 级别 | 数量 | 代表 |
|---|---|---|
| A 严重 | 3 | 输入预算漏算提示词开销；Token 查看器无上限渲染；页面提取"回退"实为双跑 |
| B 中 | 19 | 拉取模型列表无超时；5xx 未分类；错误块读不存在的字段；面板拖拽仅鼠标；快照整表读写 |
| C 低 | 45+ | 见 §3，多为一致性、死代码、i18n 混杂、a11y |
| D 疑似（需人工确认） | 7 | 悬浮球 `setPointerCapture` 可能吞掉"打开面板"的点击（若成立即 A 级） |

**最该先修的 5 件事**：A1（预算）、A2（Token 查看器）、B1（拉取超时）、B3（错误块字段）、A3（提取双跑）。

---

## 1. A 级（严重）

### A1 · 输入预算只扣页面正文，没扣提示词与输出预留 → 靠近上限的页面必然 400
- **位置**：`entrypoints/content/summary/useContentApp.ts:573-591`
- **代码**：
  ```ts
  const tokenLimit = currentModel ? getEffectiveInputTokenLimit(currentModel) : 0;
  textContent = await truncateByTokens(textContent, tokenLimit, settings.summaryInputExceedBehaviour);
  ```
  之后才把渲染好的 `systemMessage`（`:600-606`）、`Mustache.render(prompt.userMessage, view)`（`:608-610`，含整页文本、标题、URL、当前选区 `:593-598`）交给 `sendMessage()`。
- **影响**：不变量"实际发送 token 数 ≤ maxInputTokens"**每次请求都被破坏**，超出量正是提示词模板 + system + 选区 + 输出预留。一篇刚好卡在上限的页面仍会收到 provider 的 `context_length_exceeded`（400），也就是"快看"在最核心的场景下静默失败；当 `summaryInputExceedBehaviour = 'nothing'` 时更是完全不裁剪。`lib/input-token-limit.ts` 里的"安全系数"是按输入上限算的，同样没给输出留位置。
- **方向**：`budget = max(0, limit − countInputTokens(渲染后的 system) − countInputTokens(渲染后的 user) − reservedCompletionTokens)`，再做截断；`nothing` 行为下也至少要给出"预计超出"的提示。

### A2 · Token 查看器对每个 token 渲染一个 `<span>`，且上下两端都没有上限 → 长文直接卡死/杀标签页
- **位置**：`components/TokenViewerModal.tsx:129-141`、`entrypoints/background/token-count-bg.ts:214-217`、调用点 `entrypoints/content/summary/ContentAppFrame.tsx:379-399`
- **代码**：
  ```ts
  // token-count-bg.ts
  const pieces = ids.map((id) => ({ id, text: tokenizer.decode([id]) }));
  // TokenViewerModal.tsx
  pieces.map((p, i) => <span key={i} className={...} title={'Token ID: ' + p.id}>{p.text}</span>)
  ```
  入口是面板页脚一个**常驻可见**的按钮（`ContentAppFrame.tsx:379-387`），传入的是**未截断**的 `pageContent.textContent`。
- **影响**：中文大致 1–1.5 字符/token，300KB 的页面 ≈ 25 万 token → 约 100 万个 DOM 节点（span + 文本节点 + `title` 属性 + className）在**一次同步 React commit** 里挂载，无虚拟化、无 `memo`、无 `startTransition`、无上限、无 loading。结果是面板与宿主页面主线程阻塞数秒到数十秒，极端情况 Chrome 判定标签页无响应并杀掉（用户未保存的页面状态一起丢）。拖动滑杆时每个 `input` 事件重渲染整张列表并重算每个 token 的 `isTokenKept` 与颜色。后台一侧同样无上限：N 次 `decode()` + 一次多 MB 的 structured clone 回包。
- **方向**：预览窗口（首尾各 N 个 token）、虚拟列表，或把颜色图拼成一个字符串一次性渲染；后台对 `pieces` 加硬上限。

### A3 · `parsePageContent` 的"回退"提取器其实总是跑 → 每次挂载/刷新都双倍解析
- **位置**：`lib/page-extraction.ts:430`
- **代码**：
  ```ts
  return pickExtraction(primary(sourceDocument), fallback(sourceDocument));
  ```
- **影响**：JS 实参先求值，`fallback(...)` **无条件执行**，`pickExtraction` 只是决定用哪个结果。因此注释（`:424-426`）与 CHANGELOG 3.0.1#4 声称的"仅在主策略失败时回退"是错的。每次面板挂载、每次 SPA 内容变化触发 `refreshPageContentIfStale`、每次 popup 的 `extractText`，都要付 **Readability（`document.cloneNode(true)` 全文档克隆 + 解析）** 加 **DOM 启发式全量遍历**两份成本。这也放大了 B7/B8 的支出。
- **方向**：`const first = primary(sourceDocument); if (first?.textContent) return first; return fallback(sourceDocument);`，并补一条"primary 成功时不得调用 fallback"的单测（当前完全没有）。

---

## 2. B 级（中）

### B1 · 拉取远端模型列表没有超时、没有取消 → 按钮永久卡在 "Fetching"
- **位置**：`lib/model-settings-storage.ts:542-569`（`fetchRemoteModels`，无 `AbortSignal`、无 `setTimeout`）→ `entrypoints/options/pages/models/ModelEditor.tsx:188-223`
- **影响**：服务器接受连接后不响应（本地 LM Studio / llama.cpp 卡死很常见）时 Promise 永不 settle，`finally` 里的 `setIsLoading(false)`（`:220-222`）永不执行，按钮永远 disabled 且文案停在 "Fetching"，刷新页面才能恢复。`new URL(path, baseURL)` 在 baseURL 非法时抛裸 `TypeError`，落到通用 catch。
- **方向**：`AbortController` + 15s 超时；把 `TypeError` 转成"Base URL 格式不正确"。

### B2 · 5xx 完全没有分类，且 `retryable` 是死字段
- **位置**：`lib/error-taxonomy.ts:72`
- **影响**：500/502/503/529 全部落到 `{code:'unknown', status, retryable:false}`（只有 504 命中 `408 || 504` 的超时分支）。同时 `useContentApp.ts:209-210` 读出的 `classification.retryable` **全仓库无人消费**（已 grep 确认只有生产端），也就是说"是否可重试"这个决策根本不存在；将来一旦按它做自动重试，瞬时 5xx 永远不会被重试。
- **方向**：加 5xx/529 分支（`code:'provider'`、`retryable:true`），然后要么实现重试、要么删掉该字段。

### B3 · 错误 chunk 读取一个**从不存在的字段** `.error` → 带状态的错误被降级成"未知"
- **位置**：`entrypoints/background/ai-sdk-connect-bridge.ts:226-239`
- **代码**：`const rawError: unknown = anyChunk.error ?? anyChunk.errorText;`
- **实证**：`node_modules/ai` 中 UI message chunk 的 error 变体**只有** `{ type:'error'; errorText:string }`（`dist/index.d.ts`；`dist/index.mjs:8358-8382` 全部是 `safeEnqueue({type:"error",errorText:onError(error)})`）。代码注释声称"保留 status/code"是错的。
- **影响**：这条路径只能拿到一个字符串，于是"429 + 配额用尽"这类错误被归为 `unknown` / `retryable:false`，用户看到的是原始文本而不是本地化的限流文案。
- **方向**：删掉 `anyChunk.error`，改用 `streamText` 的 `onError` 捕获到的真实 error 对象做分类。

### B4 · 同一次失败会发出两帧错误
- **位置**：`ai-sdk-connect-bridge.ts:177-190`（`streamText.onError` → `postErrorFrame`）与 `:225-239`（UI 流的 error chunk 又发一帧）
- **影响**：一个 provider 错误触发两次 `send({type:'error'})`，第一次还会重置看门狗。目前靠 transport 的 `closed` 标志丢掉第二帧、且"带 status 的那帧先到"才没暴露——但这是 SDK 的实现细节，顺序一变 B3 就直接可见。
- **方向**：单帧（加 `streamFailed` 判定，或删掉 error-chunk 分支）。

### B5 · `cancel()` 是唯一不清理监听的销毁路径
- **位置**：`lib/ai-sdk-connect-transport.ts:181-191`
- **影响**：`closePort()`（`:59-69`）才会移除 `onMessage/onDisconnect/abortSignal` 三个监听并置 `closed`；`cancel()` 直接 `port.disconnect()`，依赖 Chrome 向同一端口重派 `onDisconnect`（仓库 mock 会，Chrome 未文档化）。若不重派：每次取消泄漏一组监听，且 `closed` 永远为 false。
- **方向**：`finally { closePort(); }`。

### B6 · `middle` 截断在 `0 < maxTokens < 标记自身 token 数` 时返回**比预算更多**的 token
- **位置**：`entrypoints/background/token-count-bg.ts:83-95`
- **影响**：`budget = Math.max(0, maxTokens - countTokens(marker))` 被夹到 0，随后仍拼出裸标记（约 12 token）。而 `getEffectiveInputTokenLimit` 可以合法返回 1（`lib/input-token-limit.ts:28`）。
- **方向**：`budget === 0` 时直接返回 `''`。

### B7 · `openai-compatible` 拿满额上限，却用的是另一套分词器 → 恰好最不靠谱的 provider 零余量
- **位置**：`lib/input-token-limit.ts:19-28`
- **影响**：`isOpenAiLike` 包含 `openai-compatible`，所以 OpenRouter / llama.cpp / LM Studio / Ollama(兼容层) 都拿 1.0 倍上限；但后台计数用的是内置 gpt-5 词表，对这些模型并不准。结果是"能精确计数的 provider 有折扣，不能精确计数的反而贴边请求"。
- **方向**：只有 `openai` / `open-responses` 用 1.0。

### B8 · 即使用户从不看 token 数字，每次开面板仍会加载分词器
- **位置**：`entrypoints/content/summary/useContentApp.ts:302,324,452` + `ContentAppFrame.tsx:372-378`
- **影响**：`countInputTokens(...)` 在面板初始化和 `refreshPageContentIfStale` 中无条件调用，只为渲染一个页脚徽标——不管 `enableTokenUsageView` 开没开、`maxInputTokens` 是不是 0。分词器词表被内联进 background.js（文档记录约 2.6MB），意味着每次开面板都让 Service Worker 冷启动多解析 2.6MB。
- **方向**：按开关 / `maxInputTokens > 0` 门控。

### B9 · 面板快照每次保存都整表读改写，且只有条数上限、没有体积上限
- **位置**：`entrypoints/background/panel-snapshot-bg.ts`（队列 + 全量读改写）、`lib/panel-snapshot.ts`
- **影响**：每个标签页把最多 `MAX_PANEL_SNAPSHOTS_PER_TAB=20` 个页面的完整助手消息（含 reasoning 段）存成**一张表**；每次节流持久化（流式期间 1 次/秒）与每次开关面板都重写整张表——写入量与该标签页的全部历史成正比。另外只按**条数**裁剪，`storage.session` 在 Chrome 上约 10MB 配额，多个长/带推理的摘要会让 `setItem` 失败（有日志，但内容静默丢失）。
- **方向**：按 key 分片写（`session:panel-snapshot-<tabId>-<pageHash>`），并加字符数上限 + 单条消息截断。

### B10 · 面板拖拽/缩放只有鼠标事件，且没有"松手丢失"兜底（悬浮球已经修过同一问题）
- **位置**：`components/container/internal/interactions.ts:65-66` 与 `:195-196`（`document` 的 mousemove/mouseup）、`:175`(`e.button !== 0`)、`components/container/PanelContainer.tsx:139`
- **影响**：(a) 面板完全无法用触摸/手写笔移动或缩放（悬浮球可以，因为它已迁移到 Pointer Events）；(b) 没有 `pointercancel` / `blur` / `buttons === 0` 兜底：一旦 `mouseup` 丢失（在别的窗口或 devtools 上松手、拖拽中 alt-tab、系统弹窗、右键菜单、取消的触摸），`isDraggingRef`/`isResizingRef` 会一直为 true，监听保持挂载，面板跟着光标跑到下一次按鼠标为止，同时页面还处于拖拽选择状态。Chrome 在按键期间的隐式鼠标捕获使常见情况不至于触发，所以定级中。
- **证据**：`CODE_REVIEW_v3.1.1.md:225` 记录过悬浮球同样的问题（"窗口外松开会让球卡在拖拽态"），`5bf6408` 用 `setPointerCapture` + `pointercancel` 修了球，**面板被落下**，于是同一功能里两套输入模型不一致。
- **方向**：统一改 Pointer Events + `setPointerCapture` + `pointercancel`/`lostpointercapture`。

### B11 · 引用 tooltip 挂在 `document.body`，而面板样式只存在于 shadow root → 无样式浮层
- **位置**：`components/ui/tooltip.tsx:18`（`<TooltipPrimitive.Portal>` 未传 `container`）+ `entrypoints/content/index.ts`（`cssInjectionMode: 'ui'`）
- **影响**：面板的 Tailwind/主题 CSS 只注入 shadow root，而 Radix Portal 默认挂到 `document.body`。唯一消费者是引用 chip 的 tooltip（`components/ai-elements/message.tsx:251-257`），于是它渲染在面板的样式体系、堆叠上下文和字号体系之外，表现为一个没有背景/配色的裸框。`ContentAppFrame.tsx:224` 的 sonner `<Toaster>` 属同类问题。
- **方向**：给 Portal 传 `container={shadowRoot}`（或把 tooltip 内容改为面板内联渲染）。
- **更正（见 §8）**：本条把 `<Toaster>` 也算作同类问题是**错的**。sonner@2.0.7 的 Toaster 就地渲染，不 `createPortal` 到 `document.body`；`entrypoints/content/index.ts:2` 已导入 sonner 的 CSS，而 `cssInjectionMode:'ui'` 会把 content CSS 注入 shadow root，所以它本来就有样式。本条只应描述 tooltip。

### B12 · 未保存拦截只覆盖路由跳转，关标签页/刷新照样丢
- **位置**：`hooks/useUnsavedChangesGuard.ts`（`useBlocker` + confirm）
- **影响**：只拦 React Router 内部导航。关闭设置标签页、刷新、直接输入新 URL 都没有 `beforeunload` 守卫——半个 API Key 敲到一半关掉标签页就没了，而这正是该 hook 声称要解决的场景（`PromptEditor`/`ModelEditor` 的 `savedRef` 逻辑都建立在它之上）。
- **方向**：同时注册 `beforeunload`（有改动时 `preventDefault`）。

### B13 · 导入既没有体积/条数上限，也没有 `isImporting` 守卫
- **位置**：`entrypoints/options/pages/models/ModelsListPage.tsx:112-162`
- **影响**：`JSON.parse(await file.text())` 对文件大小与行数无上限（一个几百 MB 的 JSON 会卡死设置页），且期间没有 busy 状态，文件选择器可以被重复打开、导入并发执行。默认值校验反而是**做了**的（`:135-139`），此处不构成缺陷。
- **方向**：加 `file.size` 上限（如 5MB）、行数上限（如 500）与 `isImporting` 标志。

### B14 · 存储层校验错误是英文，UI 其余部分是中文
- **位置**：`lib/model-settings-storage.ts:229-259`（`'Model name and model id are required.'`、`'Base URL is required.'`、`'Model name already exists.'`、`'Model not found.'`）、`lib/prompt-settings-storage.ts:98-110`（`'Prompt name, system message, and user message are required.'`）、`entrypoints/options/pages/models/{CreateModelPage,EditModelPage}.tsx`（`'Model created.'` / `'Model saved.'` / `'Model ID is missing.'` / `'Model was not found.'`）
- **影响**：这些字符串会经 toast 直接呈现给用户，和其余全中文界面混排。注意 `lib/i18n.ts:1-3` 已声明"本扩展现在仅中文（自用分支）"，所以**问题不是缺少 i18n，而是同一 UI 里中英不统一**。
- **方向**：统一为中文（或统一走 `lib/i18n.ts`）。

### B15 · 导出"不含密钥"时仍会带出 `extraBody`
- **位置**：`lib/model-transfer.ts:43-47`
- **代码**：`...(includeSecrets ? {} : { apiKey: '', headers: {} })`
- **影响**：只清空了 `apiKey` 和 `headers`，**没有清 `extraBody`**。而 `extraBody` 是用户可自由填写的原始 JSON（`ModelEditor` 明确引导填任意字段），代码在其他地方（`PublicModelConfigItem`、`toPublicModelConfig`）是把它当敏感字段排除的。用户在里面写的 `api_key`、签名、鉴权头都会随"不含密钥"的导出文件落到 `~/Downloads`。默认导出（`includeSecrets` 未传）因此可能泄漏凭据。
- **方向**：不含密钥时同时清空 `extraBody`；或明确把它归类为敏感字段并同步文档/UI 文案。

### B16 · 页面提取看不到 shadow DOM 与 iframe 内容，两个功能对"页面"的定义还不一致
- **位置**：`lib/page-extraction.ts:159`（`cloneNode(true)` 不克隆 shadow root）、`:211-234`（候选遍历只走 light DOM）
- **影响**：Web Component / iframe 渲染的正文提取为空 → `pickExtraction` 返回 undefined → 面板显示"没有内容"且没有任何诊断信息。而 `lib/scroll-to-text.ts:141-158` **会**下潜 shadowRoot 与同源 iframe，于是"提取"和"跳回原文"对同一页面的认知相反（前者说没有、后者能找到）。
- **方向**：至少给出"该页正文位于 shadow DOM/iframe 内，无法提取"的专门提示；`scroll-to-text` 与提取共用一次 DOM 遍历。

### B17 · NOISE 选择器只用于"候选过滤"，正文里仍带着导航/按钮/隐藏文本
- **位置**：`lib/page-extraction.ts:388`（`bestCandidate ? getElementText(bestCandidate.element) : ''`）配合 `:172`（`innerText || textContent`），NOISE 定义在 `:48-66`
- **影响**：`header/footer/nav/form/dialog/button/[role=navigation]/[aria-hidden]/[hidden]/.sr-only` 只影响谁能当候选；胜出元素的**整棵子树**文本仍会被拼进正文，导航、按钮、表单占位符都会进入 prompt、影响摘要质量与 token 计数。又因为 `innerText || textContent`，`display:none` 子树也会以 `textContent` 形式泄漏。script/style 不泄漏（这条是好的）。
- **方向**：先克隆胜出元素并删掉 NOISE 节点，再从克隆取文本。

### B18 · `scrollToPhrase` 在"索引非空但零命中"时不会重建索引 → 明明有原文却报找不到
- **位置**：`lib/scroll-to-text.ts:335`（`if (matches.length) { ... }`）
- **影响**：注释（`:331-334`）自己承认 MutationObserver 看不到 shadow root/iframe 内的变更；懒加载文章的索引会变成"非空的旧索引"，查找返回 `[]`，于是用户点引用 chip 得到"没有在页面中找到这段原文"，而那段话就在页面上。
- **方向**：零命中即失效并重建一次。

### B19 · DOM 启发式候选判定是 O(深度 × 页面大小)，且在渲染关键路径同步执行
- **位置**：`lib/page-extraction.ts:192-259`
- **影响**：acceptNode 对每个 DIV/SECTION/ARTICLE/MAIN 调 `isCandidateElement` → `:192` 取 `getElementText(element).length` → `:172-173` 的 `innerText` + `cleanExtractedText`（5 遍全局正则扫整棵子树文本）；`getCandidateMetrics`（`:243-259`）再加 5 次 `querySelectorAll` 和一次 `getElementText`。同一段文本会被每一层祖先反复清洗，全部同步跑在主线程，和 A3 的双跑叠加。
- **方向**：候选阶段只用 `textContent.length`，`innerText` 只留给最终胜出元素。

---

## 3. C 级（低）

按主题归并，每条含位置与要点。

**配置/常量**
- `constants/model-settings.ts:301-306` — `getModelProviderDefinition` 对未知 `providerId` 静默回退到 `MODEL_PROVIDER_DEFINITIONS[0]`（openai-compatible），一行坏数据会被当成通用兼容端点。
- `constants/model-settings.ts:475-488` — `getModelDisplayIcon` 是死导出（仅测试引用），且返回**裸** iconPath，一旦在 content script 里被使用就会因 `use_dynamic_url: true` 得到相对页面解析的错误 URL。
- 图标渲染：`ModelEditor.tsx:284,357-364,446` 用的是裸 `iconPath`，在设置页（扩展源）没问题，**不是 bug**，但与其它三处（`ModelsListPage.tsx:350`、`GeneralPage.tsx:424`、`popup/App.tsx:283`、`ModelSelector.tsx:45`）使用 `resolveModelIconUrl` 不一致。
- `constants/model-settings.ts:337-358` / `:323-331` — `createDefaultModelDraft`、`normalizeOllamaBaseURL` 逻辑正确；`findBaseURLPreset` 的回退链（精确路径 → 最长公共路径段 → 同主机唯一 → 首个）可接受。

**存储/迁移/日志**
- `lib/logger.ts:45-56` + `constants/general-settings.ts:51-53` — `isLogLevel` 用 `value in LOG_LEVELS`，对 `'constructor'`/`'toString'`/`'__proto__'` 等原型链键返回 true；若存储里出现 `logLevel: 'constructor'`，`LOG_LEVELS[effectiveLevel]` 变成函数，`number >= function` 恒 false，**所有日志被静默关闭**。只有手改存储才可达。
- `LOG_LEVELS` 重复定义：`lib/logger.ts:8-14` 与 `constants/general-settings.ts:49`（一份用于校验、一份用于排序）。
- `lib/settings-mutations.ts:52-118` — `applyModelMutation` / `applyPromptMutation` 的 `switch (request.op)` 没有 `default`，未知 op 会 resolve `undefined`，而返回类型声明为非可选。
- `lib/model-settings-storage.ts:587-623` — `extractRemoteModels` 对列表长度无上限。
- `lib/migration.ts` — `runFullMigration` 全仓库只有 `entrypoints/background/onInstall.ts:21`（`reason === 'update'`）一处调用：**手动降级/手工恢复存储后不会迁移**；`reason === 'install'` 分支为空（`:14-16`）。
- `lib/panel-snapshot.ts:41-52` — `getPageKey` 只去掉 hash（hash 路由除外），不剥离 `?utm_*`、不规范化结尾斜杠，同一篇文章经不同投放链接会得到**不同快照**。
- `lib/page-content-cache.ts:15,20` — `MAX_CACHE_ENTRIES=20`，每条同时持有 text 与 HTML（见 E12 类问题），是纯内存放大。

**内容脚本/面板**
- `entrypoints/content/summary/useContentApp.ts:94,350` — `settingsLoadedRef` 只写不读，死状态。
- `useContentApp.ts:502-615` — `summarize()` 没有重入保护：两个外部触发在 `statusRef` 变成 `'submitted'` 之前到达会开两条并发流（`:511-520` 的忙等只覆盖"已忙"状态）；`summarize` 的 `await sendMessage` 拒绝无人捕获（`void summarize(true)`）→ 可能未处理拒绝。
- `useContentApp.ts:600-610` — `setMessages([...])` 后同一 tick 立刻 `await sendMessage(...)`，依赖 AI SDK 同步改写 chat 状态；每次都整体**替换**消息列表（历史按设计丢弃，但恢复出的摘要也会被重跑清掉）。
- `entrypoints/content/scope.tsx:14-16,76-83` — 每次 `ping` 都读 `document.body.innerText`（强制布局），而 `control.ts:64-104` 最多会 ping 10 次。
- `entrypoints/content/scope.tsx:53-64` — 对整个 `document.documentElement` 注册 `{childList:true, subtree:true}` 的 MutationObserver，生命周期与标签页相同；重页面下是持续的观测开销（回调有 `host?.isConnected` 短路，故不致命）。
- `entrypoints/content/scope.tsx:22-24` — 若上一次上下文的宿主元素残留，`querySelector('webpage-summary-entrance')` 会让新挂载**直接返回**，面板再也不出现（需刷新页面）。
- `entrypoints/background/control.ts:46-55` — `isUnsupportedPageUrl` 把 `file:` 列为不支持，但当用户勾选"允许访问文件网址"时内容脚本其实会注入 `file://`，于是右键/快捷键路径会拒绝一个本可总结的页面。

**设置页/popup**
- `entrypoints/options/router.tsx:14-69` — 没有 catch-all 路由，手输 `#/nonsense` 会落到 React Router 默认错误页。
- `entrypoints/options/pages/WelcomePage.tsx` + `RoutePlaceholder.tsx` — `/welcome` 路由没有任何入口链接（全仓库 grep 只有路由与自身），是发布出去的占位 stub。
- `entrypoints/options/index.html:7` — `<title>Webpage Summary Options</title>` 是英文，popup 的是中文"快看网页总结"。
- `entrypoints/options/main.tsx:6` — 设置页 `import '../popup/style.css'`，跨入口复用弹窗样式表（耦合味道）。
- `entrypoints/popup/App.tsx:34` — `await sendExtMessage('seedPromptLibrary')` 没有 try/catch；后台未就绪时整个初始化 effect 拒绝，`models` 永远为空（设置页同名调用是包了 try/catch 的）。
- `entrypoints/popup/App.tsx:82-95` — `handleConfigChange` 乐观改本地 state，失败只 toast 不重读，选择器会显示一个并未持久化的值（`GeneralPage.tsx:239-269` 的做法是失败即重读，此处不一致）。
- `entrypoints/popup/App.tsx` — 整个 popup 没有任何测试。
- `GeneralPage.tsx` — 全仓库最集中的硬编码中文（`:64-72` 裁剪策略、`:79-83` 字号、`:273` 恢复默认确认、`:367-371` 主题、`:380/:398/:405/:482/:517` 分组、`:538` 日志级别），以及 `:132` 直接用 `amber-500/amber-50/amber-950` 字面量而非主题变量。
- `hooks/useWxtStorage.ts` — 乐观写入、失败只 log 不回滚（已在文档/上一轮审查中记录）；同时它是**唯一**让内容脚本直接写 `local:*` 的通道（主题、面板几何），是"后台是唯一写入者"规则的少数例外，建议在文档里显式豁免。
- `ModelsListPage.tsx:468-479` — `<Button asChild disabled={isBusy}>` 包 `<Link>`，`<a>` 不理会 `disabled`，忙碌守卫拦不住跳转编辑页。
- `ModelsListPage.tsx:217-219` — `handleDuplicate` 里 100ms 的 `setTimeout` 未在卸载时清理。
- `ModelsListPage.tsx:36-60` — 挂载 effect 只有 `[]`，且本页不 `storage.watch` 模型相关 key（`GeneralPage` 有），面板/popup 的改动在本页要等下一次变更才可见。
- `ModelsListPage.tsx:397` — `model.maxInputTokens ?` 让 0（即"无上限"）在"详情"里完全不可见。
- `ModelEditor.tsx:724-781` — `NumberField` 对非法输入只标红但 `onChange(0)` 照发，视觉上"有错"实际已持久化"无限制"。
- `ModelEditor.tsx:803-858` — `ModelPickerModal` 手写 `role="dialog" aria-modal="true"`，没有焦点陷阱、没有 Esc、没有点遮罩关闭。
- `ModelEditor.tsx:548-568` — 未入池模型用哨兵 option，`onChange` 故意 no-op（有注释，可接受）。
- `PromptEditor.tsx:46-58` — `savedRef.current = true` 在 `await onSubmit(draft)` **之前**置位，慢保存期间离开页面不会触发未保存确认（catch 里才重新武装）。
- `PromptsListPage.tsx:174,263` — `Default: {name}`（英文）与 `查看提示词内容` 硬编码中文，绕过 `lib/i18n.ts`。
- `general-settings` 基线差量写入（`lib/general-settings-storage.ts:41-58`）—— 设计正确（不与当前存储比对，避免并发写被回滚），但 `restoreDefaults`（`GeneralPage.tsx:271-291`）会一次性写全部键，从而覆盖这期间 ThemeProvider 单独写的主题。

**组件/交互**
- `components/icons/GithubIcon.tsx:1-4` — 解构出 `size: _size` 与 `..._props` 后完全丢弃，硬编码 `width/height=1024` + `className="size-6"`：调用方 `<GithubIcon size={18} />`（`OptionsLayout.tsx:53`）渲染成 24px，`className/style/aria-*` 全部丢失；`fill-rule`/`clip-rule` 是非法 React 属性名，dev 下每次渲染都报 `Invalid DOM property`。
- `components/theme-provider.tsx:42-91` — 主题类同时写到 shadow host（`:42-84`）和内层 `<div className={resolvedTheme}>`（`:87-91`），`assets/theme.css:9-10,49-51` 两套选择器都定义，属于冗余（已验证两条路径都生效，**不是 bug**）；`:83` 只移除媒体查询监听不移除类（宿主随 scope 销毁，无害）；`resolvedTheme` 初值 `'light'`（`:40`）到绘制后才纠正 → 深色用户开面板闪一下白。
- `components/container/RightFloatingBallContainer.tsx:152` — `el.setPointerCapture?.(e.pointerId)` 未包 try/catch（`:163-167` 的释放却包了）；失效 pointerId 会抛 `NotFoundError`，此时 `handleDragStart` 已执行完 → 拖拽态留在开而没拿到捕获。
- 同文件 `:23` — `initClosedBtnHidden` 声明后从未使用（死 prop）。
- 同文件 `:62-66` — 存储的 `top` 在 effect（绘制后）才应用，而元素在 `!isDragging` 时常驻 `transition-all duration-300` → 每次挂载都从静止位置动画到目标位置。
- 同文件 `:131-133` — 松手后始终吸附右边缘（`left=''`），水平拖拽只是视觉预览，不能停在左侧（设计如此，但没在 UI 上说明）。
- `components/container/internal/interactions.ts:114-118` — `top|topRight|topLeft` 分支只改 `height` 不写 `top`（几何错误，潜伏：`PanelContainer.tsx:144-146` 只渲染 bottom/left/bottomLeft 三个把手）。
- 同文件 `:121-126` — "动态内容约束"在 min/max 夹取**之后**执行，可把宽度顶到 `max-w-[100vw]` 之外并把手柄推出屏幕（今天因 `.kuai-reading` 是 `overflow-x-hidden` 而不可达）。
- `components/container/PanelContainer.tsx:100-134` — 修好的可及几何没有回写 `saveFloatingState`（`:40-52`），旧值留在存储里，每次挂载都要重新推导（自愈，所以定低）。
- 同文件 `:18-19` 与 `min-w-[384px] min-h-[224px]` — 默认尺寸用 `srem` 计算、最小尺寸用 px，字号调大 + 窄窗口时只有 `max-w/h-[100vh]` 兜底，可能超出视口。
- `components/ui/select.tsx:71` — `portal = false` 且**无任何调用方传 `portal`**（grep 0 命中），内容脚本根本不用 Select，属于死配置；今天不裁剪只是因为设置页没有 `overflow-hidden` 祖先。
- `components/TokenViewerModal.tsx:59-62` — `isTokenKept` 的 `middle` 边界用 `keep/2`，后台实际先扣掉截断标记的 token（`token-count-bg.ts:83-94`），两侧差约 8 token，而注释声称与后台一致。
- 同文件 `:98` — `maxSlider = Math.max(realTokens, maxInputTokens)`：短页面 + 高上限时滑杆行程远超出 `pieces.length`（偏 UX 困惑，可能是有意的）。
- 同文件 `:126,152` — `Loading tokens...` / `Max Input Limit:` 硬编码英文，其余标签走 `uiMessages`。
- 同文件 `:113-141` 的 `TOKEN_COLORS[(i*7)%17]` — 17 色 + 步长 7 互质（循环遍历后才重复，技巧正确），但这是 `assets/theme.css` 之外的第二套配色。
- `components/ui/tooltip.tsx`/`TokenViewerModal`/`ModelPickerModal` — 三处浮层都没有焦点陷阱与 Esc（组件库 Dialog 有，手写浮层没有）。
- `hooks/useWxtStorage.ts:54-57` — `getItem` 抛错时也把 `isLoaded` 置 true，读失败与"空值"不可区分。

**lib 其余**
- `lib/clipboard.ts:14-26` — 回退路径把 textarea 挂到页面 `document.body`（`finally` 里移除，OK），`execCommand('copy')` 已废弃但 http 页面确实只能这样，属必要妥协。
- `lib/page-selection.ts:10-18` — 模块级可变状态；依赖 `ContentEntrance` 在选区折叠时写入空串，否则会留下上一次的选区（未逐行核实该写入分支）。
- `lib/model-transfer.ts:6-7,66-68` — `MODEL_EXPORT_FILE_VERSION` 定义了但 `parseModelExportFile` 从不校验 `version`，未来 v2 文件会被当 v1 静默解析。
- `lib/model-transfer.ts:96` — `rows.filter(isRecord) as Record<string, any>[]`：生产代码里的 `Record<string, any>` 逃逸（此前 `as any` 的全量 grep 未覆盖这种写法，故 §5 的清单据此修正）。
- `lib/model-transfer.ts:157-168` — `downloadJsonFile` 在 `click()` 后立刻 `revokeObjectURL`，Chrome 可行，但对下载启动较慢的环境偏激进。
- `lib/scroll-to-text.ts:246-253` — 只检查 `parentElement` 的 `style.visibility/opacity`；`opacity` 不继承，`opacity:0`/被裁剪复制出的文本节点可能胜过后面的可见节点；未用 `checkVisibility()`/`aria-hidden`。
- `lib/scroll-to-text.ts:278-280` — 把 `::highlight(kuai-cite-target)` 注入 `doc.head` 或 shadow root 后**从不移除**，整标签页生命周期常驻；这是 `assets/theme.css` 之外第二处硬编码配色，深色模式下对比差，且可能被页面 CSP（无 `style-src 'unsafe-inline'`）拦掉。
- `lib/scroll-to-text.ts:58-73` — 每次建索引都构造与页面等长的归一化字符串 + `number[]`；`characterData:true` 的观察者让每次 body 变更都重建（大页面/频繁变更下每次点引用都要几百 ms、几 MB）。
- `lib/ai-sdk-connect-transport.ts:103,118` — `message as AiSdkConnectBridgeServerMessage` 后直接读 `frame.type`：null/原始类型帧会在 onMessage 里抛错，导致 `errorStream/closeStream` 都不执行、`closed` 保持 false，而客户端**没有超时**，面板会一直转直到用户手动停止。
- `lib/ai-sdk-connect-transport.ts:195-197` — `reconnectToStream()` 恒返回 null：恢复出的消息永远无法重新挂接活动流（有注释，属设计）。
- `entrypoints/background/ai-sdk-connect-bridge.ts:34-37` — 拒绝不可信 port 时只 `return`，从不 `disconnect()`，留下一个空 port。
- 同文件 `:303-319` — `errorForLog` 刻意只投影 `{name,status,message.slice(0,300)}`（防止 `APICallError.requestBodyValues` 里的整页文本进 SW 控制台）——这是**正确的隐私处理**，列此备忘。
- `entrypoints/background/timing-bg.ts:5` — `serviceWorkerStartedAt = timingNow()` 在生产环境也无条件执行（无害，但与别处的 DEV 门控不一致）。
- `entrypoints/background/cors-fix.ts:120-169` — 动态 DNR 规则 `urlFilter:'*'` + `initiatorDomains:[扩展id]`，给扩展自身发起的所有 xhr 回包 `set` 上 `Access-Control-Allow-Origin: chrome-extension://<id>` 与 `Allow-Methods/Headers: *`。范围限定在扩展发起者，不削弱站点安全，属可接受；只是"对所有 URL 无条件"偏宽，且不需要 `Allow-Credentials`（当前也没设）。另注：该文件使用 `Browser.declarativeNetRequest.Rule` 类型但未 import `Browser`，依赖环境全局类型，`tsgo` 通过。
- `wxt.config.ts:20-22` — 已移除 `activeTab`/`scripting`（真实的安全改进：扩展无法再编程注入代码）；`web_accessible_resources` 收敛为 `icon/*`+`llm-icons/*` 且 `use_dynamic_url: true`。保留意见：`host_permissions: ['<all_urls>']` 仍是最宽权限，也是"用户自定义远端图标 URL 可无提示加载"的前提。
- `types` — `lib/messaging.ts` 里若干 `ProtocolMap` 返回值声明为裸 `number`/`string`/`void` 而非 `Promise<...>`，靠 `@webext-core/messaging` 的推导兜底。
- `.gitignore` 没有 `.env*` 规则，而 WXT 会读 `.env` 并把 `WXT_*` 内联进产物（`git add -A` 可能提交、打包可能外带）。
- `README.md:37` — "当前版本 **3.1.0**" 与 `package.json` 的 `3.1.2` 不一致。
- `.github/workflows/quality.yml:23-33` — 跑 `npm ci` → compile → test → lint（Node 22 + npm 缓存），但**没有版本一致性校验**（package.json / package-lock 顶层与 `packages[""]` / 构建出的 manifest），而这正是该文件头部注释自己点名的风险；当前四处都是 3.1.2，尚未漂移。
- `test/mocks/wxt-browser.ts` 只暴露 `storage.local` + `runtime.connect`（没有 `runtime.getURL`/`runtime.id`/`storage.session`/`storage.watch`）；`test/mocks/imports.ts` 的 `storage.watch` 是 no-op、`getItem` 恒 null，因此 `lib/logger.ts:31-38` 从未被真正执行；第一个用到 `browser.runtime.getURL` 的测试（如 `lib/model-icon.ts`）会抛令人困惑的 `TypeError`。

**死代码（全仓库零引用，已 grep 确认）**
- `components/ai-elements/message.tsx`：`MessageActions`、`MessageAction`、`MessageBranchContent`、`MessageBranchSelector`、`MessageBranchPrevious`、`MessageBranchNext`、`MessageBranchPage`、`MessageToolbar`
- `constants/model-settings.ts`：`ModelProviderDefinition`（类型）、`getModelDisplayIcon`
- `constants/prompt-settings.ts`：`PromptTemplateVariableDescriptionKey`
- `lib/model-settings-storage.ts`：`getDefaultModelConfig`
- `lib/prompt-settings-storage.ts:386`：`seedDefaultPromptIfNeeded`（实际生效的是 `:372` 的 `seedPromptLibraryInBackground`）
- `entrypoints/options/pages/RoutePlaceholder.tsx` + `WelcomePage.tsx`（仅由无入口的 `/welcome` 路由使用）

---

## 4. D 级（疑似，需人工确认）

> 本机无浏览器（无 chromium 可执行文件、无 playwright/puppeteer），以下都无法自动验证，每条附一行人工检查法。

**D1（若成立 = 严重）· 悬浮球的 `setPointerCapture` 可能吞掉"点击打开面板"**
- `components/container/RightFloatingBallContainer.tsx:139-153`：pointerdown 在**外层**球 div 上调用 `setPointerCapture`；而"打开面板"的 `onClick` 挂在调用方提供的**子** div 上（`entrypoints/content/ContentEntrance.tsx:226`）。
- 依据：设置捕获后 `pointerup` 派发给捕获元素，`click` 目标是 pointerdown/pointerup 两个目标的最近公共祖先（即外层 div），子元素的 `onClick` 不会触发（[W3C 讨论 #356](https://lists.w3.org/Archives/Public/public-pointer-events/2021JulSep/0035.html)、[同类报告](https://stackoverflow.com/questions/79241108/missing-pointerup-event-in-child-element-after-setting-pointercapture-on-parent)，规范线程本身[仍未定论](https://lists.w3.org/Archives/Public/public-pointer-events/2025OctDec/0073.html)）。作者已经为关闭按钮专门绕过捕获（`:147` 的 `closest('[data-close-btn]')`），说明这个坑是真实存在的。`5bf6408` 之前用的是 document 级 mousemove/mouseup（无捕获），点击是好的。
- **人工验证**：点一下悬浮球。面板不打开 → 就是这个 bug。
- 方向：把"打开"逻辑放到捕获元素上（`onPointerUp` + 拖拽距离阈值），或首次移动超过阈值时才惰性捕获。

> **已处理（用户人工确认后）**：D1 成立。按用户决定直接**移除悬浮球功能**，而不是修捕获逻辑——`components/container/RightFloatingBallContainer.tsx` 已删除，`enableFloatingBall` 设置项（`constants/general-settings.ts`）、设置页开关、`lib/i18n.ts` 的 `badgeLabel`/`hideFloatingBall`/`enableFloatingBall` 文案及 `AGENTS.md`/`README.md` 相关描述一并清理。D2 中悬浮球那半随之失效（`RightFloatingBallContainer.tsx:80-81,85` 的 `offsetLeft/offsetTop`），面板的坐标假设部分仍成立。本改动已随 **3.1.3** 发布。

**D2（依页面而定）· 视口坐标数学假设 shadow host 的包含块就是视口**
- `RightFloatingBallContainer.tsx:80-81,85` 用 `offsetLeft/offsetTop`，`interactions.ts:227-231` 写 `right/top`；`PanelContainer.tsx` 用 `position: fixed`。若页面祖先（`body`/`html`）带 `transform`/`filter`/`perspective`/`will-change`/`contain: paint`，该祖先成为包含块 → 球/面板落点错误，`window.innerWidth/Height` 夹取也失准（球可能被拖到屏幕外或拖拽时跳动）。
- **人工验证**：在带 `body{transform:translateZ(0)}` 的页面上拖拽，观察是否偏移。

**D3（若成立 = 中）· 页面缓存签名可能被面板自身文本污染而永久失效**
- `lib/page-content-cache.ts:38` 用 `document.body?.innerText` 做签名；面板宿主是 `<body>` 的子元素（`scope.tsx:32-36`，anchor `'body'`、append `'last'`）。若 Chrome 的 `innerText` 会包含 open shadow root 的文本，那么面板每次重新渲染都会改变签名，`getCachedPageContent` 永远判为过期，`refreshPageContentIfStale`（`useContentApp.ts:428-440`）于是每次都重新整页提取（叠加 A3 的双跑）。
- **人工验证**：控制台执行 `document.body.innerText.includes('总结此页')`。为 false 则本条不成立。

**D4 · 同一次失败的"两帧错误"顺序依赖 SDK 实现**
见 B4。今天靠"带 status 的帧先到"才没暴露；SDK 升级后顺序反转会让 B3 直接对用户可见。建议直接从结构上消除（单帧），而不是依赖顺序。

**D5 · `{type:'done'}` 与端口断开在同一微任务里赛跑**
`ai-sdk-connect-bridge.ts:274-276` 发出 `done` 后，外层 `.finally(() => finish())` 立刻断开端口。若 Chrome 在投递排队的 `done` 之前拆管，内容脚本会看到 `onDisconnect` 并把一次**成功**的总结报成 "AI SDK connect bridge disconnected before completion."。Mojo 通常会排空已写消息，故可能不会发生，且没有任何测试覆盖。

**D6 · 120s 看门狗把首 token 等待也计入空闲**
`ai-sdk-connect-bridge.ts:127-137` 的看门狗只由 `send()` 重置；长 CoT/推理模型或冷启动本地服务在 >120s 内没有任何输出就会被中止并报超时。没有 keepalive/存活信号，建议为首 token 单独设一个更宽的预算。

**D7 · 未验证项**
`.output/chrome-mv3/manifest.json` 不存在（从未构建），因此"打包产物落后两个版本"这一风险只能在 CI 层面防范（见 C 级版本一致性条目），无法直接核对产物。

---

## 5. E 级：测试缺口

- `entrypoints/background/ai-sdk-connect-bridge.ts` **完全没有测试文件**：`postErrorFrame`/`getErrorMessage` 分类、看门狗→abort→错误帧、error-chunk 分支（B3）、`!sawContent` 分支、重复帧（B4）、done-then-disconnect（D5）全无覆盖。
- `test/lib/ai-sdk-connect-transport.test.ts` 从不触发 `cancel()`（B5）、`start()` 内 `postMessage` 抛异常、或已 abort 的信号。
- `test/background/token-count-bg.test.ts` 覆盖 nothing/front/back/middle/默认/负数/0/NaN/小数，但**没有** `0 < maxTokens < markerTokens` 的 `middle` 用例（B6），也没有 `truncateByTokensWithTiming` / `splitTokensWithTiming` / `countInputTokensWithTiming` 的用例。
- 没有任何测试断言 A1 的端到端预算不变量——即"实际发送的 token 数 ≤ 上限"。这条单测是 A1 的唯一防回归手段。
- `test/lib/summary-timing.test.ts` 仅一个用例。
- `test/lib/error-taxonomy.test.ts`（13 例）没有 5xx/502/503/529 用例（B2）。
- `test/lib/idle-timeout.test.ts` 只测纯模块，不测"桥接层确实发了错误帧并 abort"。
- `test/lib/page-extraction.test.ts`（89 行）只导入 `cleanExtractedText`、`pickExtraction` 和手搓的 `WebpageContent`：`parsePageContent`/`readabilityParseRead`/`domHeuristicParseRead`/NOISE 与打分/`textContentToHtml`/iframe/shadow DOM **从未被执行**。加一条"primary 有文本时不得调用 fallback"即可抓住 A3。
- `test/lib/scroll-to-text.test.ts:4-6` 自己声明 DOM 部分"需要真实浏览器"而跳过。
- `vitest.config.ts` 是 `environment: 'node'`，**完全没有 DOM 环境**：拖拽/缩放的监听配对、夹取、`pointercancel`、卸载清理这些我靠阅读确认的保证没有任何回归网（需要 jsdom/happy-dom）。
- 组件测试只有一个 `test/components/message.test.ts`（纯函数）。`TokenViewerModal`（连导出的纯函数 `isTokenKept` 都没测——一个 `middle` 边界用例就能抓住 C 级的边界不一致）、`PanelContainer`、`interactions`、`RightFloatingBallContainer`、`theme-provider`、`components/ui/**`、`GithubIcon`（3 行渲染断言就能抓住"丢弃 size"）全部为 0。
- 没有任何测试约束 `splitTokensWithTiming` 返回的 `pieces` 数组大小/形状（A2 的唯一防线）。
- `entrypoints/popup` 无测试。

> **状态（见 §8）**：上面第 1、2、3、4、6、7、8、10、11 条与 A2 的 `pieces` 形状约束均已在测试补网中关闭（新增 `test/background/ai-sdk-connect-bridge.test.ts`、`test/components/token-viewer-modal.test.ts`、`test/components/github-icon.test.tsx`，并扩充了 transport / error-taxonomy / page-extraction / token-count / migration / focus-trap / scroll-to-text / GithubIcon 用例）。**仍然开放**：`PanelContainer`、`interactions`、`theme-provider`、`components/ui/**`、popup 的渲染级测试（需 React 渲染库），以及 `summary-timing` 的单例覆盖。

---

## 6. 已确认无问题（重要，避免过度修复）

**注入面（实证）** — 用仓库内 `marked@18.0.4` 复现 `message.tsx` 的 renderer（只覆写 `html`/`link`/`heading`/`image`）后逐条验证：
- 围栏/inline code：`<`/`>` 被 marked 默认转义（`<pre><code>&lt;b&gt;x&lt;/b&gt;`）→ 无注入。
- 表格单元格：默认 `table` renderer 会 `parseInline`，因此覆写后的 `html` 分支生效，`<img src=x onerror=…>` → `&lt;img …&gt;` → 无注入。
- 裸 HTML 行 → 转义；`![<img src=x onerror=…>](…)` → 只输出转义后的 alt，永不产出 `<img>`（`message.tsx:112`）。
- `javascript:` 链接被 `isSafeUrl` 拦成 `href="#"`，且 `href` 经 `escapeHtml`（覆盖 `& < > " '`）+ `target=_blank rel=noopener noreferrer`；`isSafeUrl` 先剥离控制字符再判协议，靠 `"` 之类的属性逃逸也被转义挡住。
- 全仓库 `dangerouslySetInnerHTML` **只有** `components/ai-elements/message.tsx:603` 一处（`:603` 的兜底分支 `html || \`<p>${escapeHtml(children)}</p>\`` 也是转义的），无 `insertAdjacentHTML`/`outerHTML`/`innerHTML =`；无 `eval`/`new Function`/字符串形式 `setTimeout`。
- **唯一残留**：引用标记写在代码块里时，`⟦kuai-cite:N⟧` 占位符会留在 `<code>` 内，随后被 `buildCitationChips` 替换成一个可点击 chip（`⟦ ⟧` 不在 `escapeHtml` 的转义集里）。后果是"代码示例里出现引用 chip"，属低危体验问题，**不是**注入（chip 自身的 phrase/display 都经过转义）。

**密钥隔离（实证）** — `constants/model-settings.ts:290-299` 的 `PublicModelConfigItem`/`toPublicModelConfig` 剥掉 `apiKey`/`headers`/`extraBody`，且 `entrypoints/content/summary/useContentApp.ts:278`（`models.map(toPublicModelConfig)`）、`:373`、`:493` 三处都实际调用 → 内容脚本侧永远拿不到密钥。全仓库只有后台桥接与设置页/popup 持有完整行。

**消息信任边界** — `lib/background-trust.ts:11-35` 的 `isTrustedSender(sender)` 校验 `sender.id === browser.runtime.id`，在 `control.ts:16`、`panel-snapshot-bg.ts`、`settings-mutations-bg.ts`、`ai-sdk-connect-bridge.ts:34` 等入口处生效；manifest **没有** `externally_connectable`，网页无法给扩展发消息。这是纵深防御，而非唯一防线。

**架构规则** — "后台是唯一写入者"在模型/提示词设置上成立：设置页/popup/面板只发 `mutateModelSettings`/`mutatePromptSettings` RPC（`lib/settings-mutations.ts` + `settings-mutations-bg.ts`，单一 `createQueue()` 串行化），读取才直接用 `load*`。已知例外只有 `useWxtStorage` 写主题与面板几何（见 C 级）。

**监听清理** — `interactions.ts:65-66/:195-196` 的 document mousemove/mouseup 用**同一函数标识**通过 `detachRef` 移除（mouseup 时、每次新 start 开头、以及 `useEffect(() => () => detach(), [])`），句柄在读事件时取 ref，无过期闭包；`PanelContainer.tsx:128` 的 window resize 在 `:131` 用同一 `handleResize` 标识移除并 `cancelAnimationFrame(:132)`。

**日志/隐私** — 全仓库 `console.*` 只出现在 `lib/logger.ts` 与 DEV 门控的 `lib/summary-timing.ts`；没有任何调用点记录页面正文或凭据（`popup/App.tsx:135-139` 只记 `textLength`）；`SUMMARY_TIMING_ENABLED = import.meta.env.DEV`（`lib/summary-timing.ts:8`）保证计时帧在生产环境不可能产生。`scroll-to-text` 只用归一化索引 + 节点/偏移映射，不构造任何选择器/XPath，无转义面。

**主题/样式** — `assets/theme.css` 无 hex 字面量（HSL 通道 + 单一 `--primary: 142 71% 32%`）；`entrypoints/content/style.css:36-42` 保持 12/13/15/17px 四档字号；Tailwind 3.4.19 确实能编译裸 `[--radix-*]` 任意值（内存 postcss 验证过）。

**其它** — 无 `it.skip/describe.skip/it.todo/xit`；`tsconfig` 覆盖全部源码目录 + `test/**` + `vitest.config.ts`；无 `@ts-ignore/@ts-expect-error/@ts-nocheck`；无对 `localStorage/sessionStorage` 的直接使用；空 catch 只有 `panel-snapshot-bg.ts:25` 与 `settings-mutations-bg.ts:47` 两处队列错误吸收（有意）。

---

## 7. 建议的修复顺序

1. **A1**（输入预算，唯一会"静默失败"的功能性缺陷）+ 补一条预算不变量单测
2. **B1**（拉取无超时，用户可直接撞上）、**B3**（错误块字段，改一行即可）、**B9**（快照写入放大，越用越慢）
3. **A2**（Token 查看器，长文必现的卡死）
4. **B10/B11**（拖拽与 tooltip 的交互/样式缺陷，以及 A3 的性能双跑）
5. **D1** 的人工确认（点一下悬浮球即可）——若成立优先级提到最前
6. 其余 B/C 级按主题批量清理：i18n 统一、死代码删除、测试补网（jsdom）

> 需要我按这份清单直接开始改吗？建议分批：先 A + B1/B3/B9，每批附上对应单测。

---

## 8. 修复状态（已随 3.1.3 发布）

用户确认 D1 后**移除悬浮球功能**（`components/container/RightFloatingBallContainer.tsx` 等 8 个文件，+9/−270），并按 §7 的顺序完成 §7 第 1–6 步的绝大多数条目。修复完成时发布口径由用户定为"只改代码，先不发布"，所以当时版本号、`CHANGELOG.md`、tag、zip、commit 均未动；之后用户要求**发布 3.1.3**，本节的修复已随该版本发布（版本号 → 3.1.3，`CHANGELOG.md` 顶部新增 `## [3.1.3]`）。

**当前门禁**：`npx tsgo --noEmit` = 0；`npx eslint .` = 0；`npx vitest run` = **23 文件 / 279 用例全通过**（审查时是 17 文件 / 184 用例）。`npm run build` = 0（Σ 4.26 MB）：两轮收尾后各验证过一次，popup/options 共同引用 `assets/page-*.css`（内含主题变量与 base 层），`manifest.json` 已随 3.1.3 归档。

**A 级**：A1、A2、A3 全部修复。
**B 级**：B1–B19 全部修复。
**D1**：经用户人工确认为真实缺陷，按用户决定移除整个悬浮球功能（而非修 `setPointerCapture`）。

| 条目 | 状态 | 落点 |
|---|---|---|
| 悬浮球（D1） | 移除功能 | `RightFloatingBallContainer.tsx` 删除 + 相关设置项/文案清理 |
| A1 输入预算 | 修复 | 新增 `lib/summary-input-budget.ts`（输出预留 1024 / 提示词开销实测 / slack 32）+ `summarize()` 先实测提示词再裁剪 + 预算不变量单测 |
| A2 Token 查看器 | 修复 | 后台 `MAX_TOKEN_PIECES = 4000` + 返回 `totalTokenCount`，弹窗提示"仅预览开头" |
| A3 双提取器 | 修复 | `pickExtractionLazily(primary, fallback)`，回退不再双跑 |
| B1 拉取超时 | 修复 | `REMOTE_MODEL_FETCH_TIMEOUT_MS = 15_000` + `AbortSignal` + 卸载中止 |
| B2 5xx 分类 | 修复 | 错误分类新增 `server`（5xx，retryable）；toast 带"重试"动作 |
| B3/B4 错误块 | 修复 | 读真实 `errorText`、一次失败只发一帧、去掉 `as any` |
| B5 cancel 拆除 | 修复 | `closed`/`closePort` 提升到 `sendMessages()` 作用域 + 回归测试 |
| B6 中间截断 | 修复 | 预算为 0 时返回空串（不再把标记当正文发出去） |
| B7 安全系数 | 修复 | `openai-compatible` 不再享受"完整上限"豁免（只给 90%） |
| B8 token 门控 | 修复 | 三处计数与徽标都按 `enableTokenUsageView` 门控，关闭时不发 RPC |
| B9 快照读改写 | 修复 | 索引 + 每页分片键 `session:panel-snapshot-page-<tabId>-<pageKey>`，128KB/32KB 上限，LRU 不驱逐刚写入的页 |
| B10 拖拽 | 修复 | 面板拖拽/缩放全改 Pointer Events（+ `pointercancel`/`lostpointercapture`、`button !== 0` 守卫） |
| B11 tooltip 浮层 | **部分修复，报告原结论需更正** | 只有 tooltip 一半成立：新增 `lib/portal-container.ts`，`tooltip.tsx` 的 Portal 挂 shadow root。**sonner 一半被证伪**：sonner@2.0.7 的 Toaster 是就地渲染（不 `createPortal` 到 body），且 `entrypoints/content/index.ts:2` 已导入它的 CSS + `cssInjectionMode:'ui'` 会把 content CSS 注入 shadow root，所以它本来就有样式 |
| B12 beforeunload | 修复 | 未保存拦截补 `beforeunload` |
| B13 导入上限 | 修复 | 8MB / 1000 行上限 + `isImporting` 并发守卫 |
| B14 英文报错 | 修复 | 存储层校验错误全部中文化 |
| B15 导出密钥 | 修复 | 不含密钥导出时同时清空 `extraBody` |
| B16 shadow DOM / iframe | 修复 | 新增 `lib/page-flatten.ts`：提取结果 <200 字时克隆扁平化影子根/同源 iframe 重试一次；`lib/page-extraction.ts` 接入；jsdom 测试网 |
| B17 NOISE 未剥离 | 修复 | 胜出元素 clone 后剥离 NOISE 与不可见节点，块级元素后补换行 |
| B18 引用零命中 | 修复 | 零命中时失效索引重建一次 |
| B19 候选判定量长 | 修复 | 改用 `textContent.length`（不再是 5 次全局正则 + `innerText` 强制回流） |
| C 级 | 大部分修复 | `LOG_LEVELS` 去重 + `Object.hasOwn`、`.gitignore` 补 `.env*`、README 版本、CI 版本号一致性步骤、导入版本校验、`revokeObjectURL` 延迟、死 `portal` 配置、路由兜底、`caution` 配色 token、死导出删除（`MessageActions`/`MessageBranch*`/`MessageToolbar`/`seedDefaultPromptIfNeeded`）、GeneralPage 硬编码中文全部走 i18n、ModelPickerModal/TokenViewerModal 补 Esc + 聚焦、`theme-provider` 去掉调试日志并按系统偏好初始化、`ModelsListPage` 补 `storage.watch`、`file://` 页面不再被当作"不支持"、`options/main.tsx` 不再跨入口 import popup 的样式表（新增 `assets/page.css`）、孤儿 stub `WelcomePage`/`RoutePlaceholder` 删除、`timing-bg` 的 `serviceWorkerStartedAt` 按 DEV 门控、bridge 拒绝不可信 port 时断开、`scroll-to-text` 高亮样式用完即删 + ASCII 快路径 |

### 第二轮收尾（用户口径：继续清小项、不新增开发依赖）

| 条目 | 状态 | 落点 |
|---|---|---|
| 焦点陷阱 | 修复 | 新增 `lib/focus-trap.ts`（`nextFocusIndex` / `getFocusableElements` / `getActiveElement` 下钻 shadow root / `focusNextInside`）+ `test/lib/focus-trap.test.ts`（8 例）；`TokenViewerModal` 与 `ModelPickerModal` 的 keydown 里拦截 Tab 并环绕 |
| 写失败回滚（hook） | 修复 | `hooks/useWxtStorage.ts` 的 `setStorageValue` 记住 `previousValue`，`storage.setItem` 失败且期间没有更新的写时回滚 state |
| 写失败回滚（popup） | 修复 | `popup/App.tsx` 的 `handleConfigChange` / `handleModelIdChange` 失败时把乐观修改回滚后再 toast |
| 孤儿存储键 | 修复 | `lib/migration.ts` 的 `OBSOLETE_RAW_KEYS` 增加四个悬浮球键，`CURRENT_MIGRATION_VERSION` 3 → **4**；`test/lib/migration.test.ts` 新增断言（含"旁边的 `panel-font-size` 必须存活"） |
| 动态宽度越界 | 修复 | `components/container/internal/interactions.ts` 的"Dynamic Content Constraint"算出的宽度重新夹取到 `minW/maxW`（原实现可能超过视口上限） |

### 第三轮：补测试网（§5 缺口，未新增依赖）

| 条目 | 状态 | 落点 |
|---|---|---|
| bridge 完全无测试（§5 最大缺口） | 修复 | 新增 `test/background/ai-sdk-connect-bridge.test.ts`（11 例）：端口名过滤、不可信 sender 断连、正常流 + `done` + 端口释放、同端口只开一次流、只发记账帧的空流按错误处理、error-chunk 分类、`onError` 与 error chunk 只发一帧（`status` 来自原始错误对象）、缺模型配置、看门狗超时（`advanceTimersByTimeAsync`）、abort 帧、流中 `emitDisconnect()` 后不再 post |
| 测试替身缺 `runtime.onConnect` | 修复 | `test/mocks/wxt-browser.ts` 增加 `TEST_EXTENSION_ID`、`MockPort.name`/`.sender`、`__emitConnect`/`__resetMockRuntime`（合并进已有的 `runtime` 对象，避免重复键覆盖） |
| error chunk 无 status → 归类 `unknown` 且不可重试 | 修复（新发现） | `entrypoints/background/ai-sdk-connect-bridge.ts` 新增 `statusFromMessage()`（只认开头的 `[HTTP 429]` / `429`，用 `(?!\d)` 避免把 "5000 tokens exceeded" 当成 500），`postErrorFrame` 的 status 回退链变为 `statusCode ?? status ?? statusFromMessage(message)` |
| `start()` 内 `postMessage` 抛异常（§5 缺口） | 修复 | `lib/ai-sdk-connect-transport.ts` 用 try/catch 包住请求帧：抛错时走 `errorStream()` 正常失败并拆除监听器，不再让异常从 `ReadableStream` 构造器逸出而留下死端口上的监听器 |
| 已 abort 的信号（§5 缺口） | 修复 | 同文件测试新增"传入已 abort 的 signal"用例：只发 `abort` 帧、流立即结束、监听器清零 |
| 连接断开的错误文案是英文 | 修复 | 两条 bridge 自身故障文案中文化（`与后台服务的连接已断开，请重试。` / `无法连接后台服务，请重试。`）——它们会原样出现在面板上（`error-taxonomy` 无对应 code） |
| `isTokenKept` 无覆盖（§5 缺口） | 修复 | 新增 `test/components/token-viewer-modal.test.ts`（6 例）：`front`/`back`/`middle` 的头尾切分、奇数预算偏向尾部、先扣 `middleMarkerTokens`、标记吃掉整个预算时全不保留 |
| `GithubIcon` 丢弃 `size`（C 级） | 修复 | 新增 `test/components/github-icon.test.tsx`（3 例，`react-dom/server` 静态渲染）：默认 24 而非字形的 1024、`size={18}` 生效、`className` 合并且其余 svg props 透传 |
| `truncateByTokensWithTiming` / `countInputTokensWithTiming` 无覆盖（§5 缺口） | 修复 | `test/background/token-count-bg.test.ts` 新增两组用例：`countInputTokensWithTiming` 的 model/计数/有限耗时，以及 `truncateByTokensWithTiming` 与 `truncateByTokens` 在四种策略下文本与计数完全一致的对照（防止两条路径漂移），外加 `nothing` 策略下"计数仍描述全文"的语义 |

### 审查结论的更正（实证后推翻的条目）

- **B11 的 sonner 一半**：见上表，sonner 不 portal 到 body，原本就有样式。报告 B11 只应描述 tooltip。
- **`GeneralPage.restoreDefaults` 会覆盖主题**（C 级）：不成立。主题存在独立的 `local:theme`（`THEME_STORAGE_KEY`），不属于 `GeneralSettings`，`saveGeneralSettings(defaults)` 不会碰它。
- **客户端流式请求无超时**（C 级）：部分不成立。后台 `ai-sdk-connect-bridge.ts` 用 `PROVIDER_IDLE_TIMEOUT_MS` + `createIdleWatchdog` 中止流并回送 error 帧，客户端能收到；只有后台进程本身意外消失时客户端才会一直挂着。客户端仍未自设超时（保持现状）。

### 复查后有意不改的条目（连同理由）

- `hooks/useWxtStorage.ts` 读失败仍 `setIsLoaded(true)`：有默认值兜底，改成 false 会让 UI 永远 pending。
- `lib/page-selection.ts` 模块级 selection 变量：注释已说明是 content-script 单例设计。
- `components/TokenViewerModal.tsx` 的 `TOKEN_COLORS` 彩虹配色：按 token 下标取色，装饰用途，非告警配色。
- `ModelEditor.tsx` NumberField 把非法/空输入归一成 0：只影响表单 draft，`text` state + `aria-invalid` 已是合理形态。
- `PromptEditor.tsx` 在 `await onSubmit(draft)` 之前置 `savedRef.current = true`：有意为之，避免保存后的导航触发未保存拦截，catch 会重新置 false。
- `theme-provider.tsx` 宿主 + 内层 div 同时写主题类：冗余但无害，删除无法在本机做视觉验证。
- `lib/messaging.ts` 的 `ProtocolMap` 里若干返回值声明为裸 `number`/`string`/`void`（C 级）：**经实证不是缺陷**。`@webext-core/messaging` 的 `sendMessage` 类型是 `Promise<GetReturnType<ProtocolMap[K]>>`，`onMessage` 的 handler 允许返回 `T` 或 `Promise<T>`——所以裸类型才是正确的"返回值"写法；改成 `Promise<T>` 会让客户端调用变成双层 Promise，并把 `panel-snapshot-bg.ts` 的同步 handler 判成类型错误（实测 `TS2339: Property 'pieces' does not exist on type 'Promise<SplitTokensResult>'`）。已在 `lib/messaging.ts` 顶上补注释说明这一点。

### 仍未做

- **popup 的组件测试**：需要额外引入 `@testing-library/react` + `user-event`（jsdom 已装），属新增开发依赖的决策，按用户"不新增开发依赖"的口径留待确认。popup 的交互回归目前只有类型检查与人工验证。
- **仍需 DOM 渲染环境的组件**：`PanelContainer`、`components/container/internal/interactions.ts`（拖拽/缩放监听配对、夹取、`pointercancel`、卸载清理）、`theme-provider`、`components/ui/**` 仍无测试——这些断言需要 React 渲染库，同属"不新增依赖"的搁置项。已用 jsdom（`// @vitest-environment jsdom` 逐文件声明）覆盖的部分见上表。
- `truncateByTokensWithTiming` / `countInputTokensWithTiming` 两个 RPC 包装已补用例；`test/lib/summary-timing.test.ts` 仍只有 1 例。
- 发布流程（版本号 / CHANGELOG / zip / tag / push）：按用户口径暂不执行。
- 其余 C 级低危项已在"复查后有意不改"里逐条给出理由；`scroll-to-text` 的页面索引其实早已有 `cachedIndex` + `MutationObserver` 失效机制（E11 的另一半也一并有了 ASCII 快路径），`TokenViewerModal` 的 `maxSlider = Math.max(realTokens, maxInputTokens)` 经复核是合理上限，不属缺陷。
