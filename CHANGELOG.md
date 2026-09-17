# Changelog
## [3.0.0]
1. remove: 移除「站点定制」整页，包括站点黑白名单与自定义提取规则。`SiteCustomizationPage`、`lib/site-rules-storage.ts`、`constants/site-rules.ts` 及其测试一并删除；content script 不再按 URL 决定是否注入，正文提取只走通用方式（Readability / DOM 启发式）
2. remove: 移除提示词页的「总结语言」设置与 `lib/summary-language.ts`。三个内置预设改为直接写「简体中文」（同时删掉「输出语言不是中文时把小标题译成该语言」的说明）；`{{summaryLanguage}}` 变量保留、值恒为「简体中文」，已保存的自定义提示词不会失效。内置预设只对新播种生效，已有的三条预设需要删除后重新播种才会更新
3. remove: 移除「配置管理」页。导入导出迁到模型页（列表页右上角），范围收窄为模型配置，导出内容包含 `apiKey` 在内的全部字段；导入按 id 覆盖，导入条目缺 `apiKey`/`headers`/`modelIds` 时按「同端点」原则继承本地值，并兼容识别旧版整库导出文件里的 `model-configs`。存储键不变
4. change: 「界面」设置并入「通用」设置，`/interface` 路由移除、索引重定向到 `/general`。设置项重新分组为：界面与显示（主题、悬浮球、Token 用量）、触发、右键菜单、默认模型与提示词、页面内容提取、超长内容裁剪、高级（日志级别、快捷键）；删掉两张硬编码示意图与每行的「Default」提示框，通用设置改为逐项即时保存（改动立即落库，失败回滚），底部保留「恢复默认值」
5. change: 设置页整体收紧排版。通用设置从「7 个大标题区块」改为「轻分组标签 + 行式设置项」的连续列表；单选类设置（页面内容提取、超长内容、日志级别）由「一个选项一张卡」改为行内分段控件或下拉，选项说明随当前选择显示；开关行与单选项统一为同一种行结构。左侧导航去掉 WORKSPACE / PREFERENCES 分组标题、只留三项，页面标题由 `text-2xl` 收到 `text-xl`。模型页与提示词页的卡片默认只显示一行主信息，provider / baseURL / API 模式 / 价格与提示词正文折进可展开的「详情」
6. remove: 移除快捷键功能。`manifest.commands` 的命令注册与后台的 `browser.commands.onCommand` 监听一并删除，`Alt+S` / `Command+Shift+S` 不再打开面板；通用设置里那一行「快捷键」跳转也移除。打开面板剩三个入口：悬浮球、右键菜单、popup 按钮
7. change: 三个内置预设的引用约束由「短句尽量照抄原文」收紧为「短句必须照抄原文」。与 2.1.0 起的模糊定位并存（定位失败会提示并置灰），但要求模型更贴近原文。仅新播种的 Prompt 生效

## [2.3.0]
1. feat: 模型配置新增「模型池」——设置在模型编辑页点 Fetch 拉回的模型列表现在随配置一起保存（`ModelConfigItem.modelIds`），不再选完即丢；Model Name 下方多一个下拉，可在池里直接切换这条配置使用的模型。旧数据没有该字段时退化为只有当前模型一项，存储键与迁移逻辑不变
2. feat: popup 收敛为两栏：配置 + 模型（当前配置的模型池，可直接切换）。提示词栏移除
3. feat: 页面内面板的选择器同样收敛为两栏（配置 + 模型池），提示词栏移除，提示词只在设置页修改。切换模型后写回该配置并立即刷新；设置页 / popup 的模型改动也会实时同步到已打开的面板，不需要刷新页面
4. change: 两栏的选项一律显示配置名与模型 ID，不再按厂商分组渲染（分组标题在收起态不可见，展开时是噪音）；第一栏标题由「供应商」改为「配置」
5. fix: 导入配置时，若导入文件不含模型池（旧版本导出），保留本地已拉取的模型池，避免导入后模型列表消失
6. change: 新建「OpenAI Compatible」配置时，Extra Body JSON 默认预填 `{"thinking": {"type": "disabled"}}`（关掉推理模型的思考）。该默认挂在 provider 定义上（`defaultExtraBody`），官方 OpenAI / Anthropic / Google / Ollama / Open Responses 不预填——它们会把未知的顶层参数当成 400。切换 provider 时 Extra Body 跟随重置为该 provider 的默认值，避免把上一个端点的开关带过去。已有配置不受影响

## [2.2.1]
1. fix: 首字耗时插桩（`lib/summary-timing.ts`）在 2.1.0 / 2.2.0 的发布包里常开，每次总结都往宿主页面控制台打印 `console.table`，后台还会多发 `timing` 调试帧。现在只在开发构建（`import.meta.env.DEV`）启用，发布包里整条链路不执行、不打印、不发帧
2. fix: 耗时插桩的结束帧永远发不出去 —— 首个正文片段发帧后一次性守卫就把流结束时的 `final: true` 帧吞掉了。改为首个正文片段一帧、流结束一帧
3. fix: popup 的供应商分组把同一厂商拆成两组（例如 `https://api.deepseek.com` 与 `https://api.deepseek.com/v1` 分别显示为「DeepSeek」和「api.deepseek.com」），切换后另一组的模型从下拉里消失；图标判定也与分组判定不一致（带尾斜杠时分组认 preset、图标不认）。新增 `findBaseURLPreset`，按 host 匹配 preset（忽略协议、大小写、尾斜杠与 `/v1` 等路径差异），分组与图标共用
4. fix: 导入配置时，同 id 的模型若 `providerId` 或 `baseURL` 已经变了，不再从本地继承 API Key 与自定义 headers，避免把密钥带到另一个端点
5. fix: 引用定位删掉最后的 `window.find` 兜底 —— 它会选中页面文字，可能误触发划词总结入口和站点自己的选区气泡，与「不改动页面选区」的设计相矛盾。DOM 匹配失败时直接提示找不到
6. perf: 引用定位的页面文本索引改为缓存复用，页面 DOM 变化时自动失效（命中节点已脱离文档时重建一次），不再每点一次引用就遍历全页；精确匹配的候选位置上限 50 个
7. perf: 「DOM 启发式」正文提取不再白跑一遍完整的 Readability（结果无人使用），同一次提取内对元素 `innerText` 做缓存，减少重复排版计算
8. perf: 超长内容策略为「不截断」时，截断 RPC 直接返回原文，不再加载分词器并整篇编码
9. fix: 站点黑白名单改动后，已打开标签页的 popup 状态与正文抽取立即按新规则响应；从禁用变为允许时自动挂载悬浮球（从允许变为禁用时，已显示的悬浮球/面板仍需刷新页面才会消失）
10. chore: 存储里未知 `providerId` 或缺字段的模型行被丢弃时打一条 warn 日志（不含密钥），不再静默消失
11. refactor: token 计数的结果类型与常量合并到 `lib/token-count-types.ts`，前后台不再各维护一份；删除若干未使用的变量与导入
12. chore: `npm run compile` 的检查范围纳入 `test/` 与 `vitest.config.ts`；ESLint 增加 `@typescript-eslint/no-unused-vars`（warn）
13. docs: 设置页站点规则提示「minimatch」更正为实际使用的「picomatch」；`AGENTS.md` 修正过时内容（不存在的 Browser AI provider、两个已删除的存储键、已修复的「右键菜单开关不实时」、帧协议补 `timing` 帧），发布流程改为同时推送 GitHub 并发 GitHub Release；删除已完成的 `docs/SIMPLIFY_PLAN.md` 与历史审查报告 `docs/REVIEW-2026-09-10.md`
14. docs: 补记 2.2.0 条目漏写的用户可见改动（见下方 2.2.0 第 3-6 条）

## [2.2.0]
1. remove: 模型设置里的「思考等级（Reasoning Effort）」整套功能 —— popup 的快捷切换下拉、模型编辑页的下拉与「该模型支持的等级」提示、远程模型列表里的 `reasoning.effort_levels` / `default_effort_level` 解析、`setModelReasoningEffort` 写入口，以及模型行上的 `reasoningEffort` / `reasoningEffortLevels` 两个字段。请求体参数现在统一走 `Extra Body JSON` 一条路，不再有「下拉选的值」与「Extra Body 里手写的同名字段」两套来源互相覆盖。需要关掉推理模型的思考时直接写进 Extra Body，例如 DeepSeek V4/V4.1-Flash：`{"thinking": {"type": "disabled"}}`。旧版本写入的模型行若带这两个遗留键，读取时会被丢弃，其余字段不受影响
2. test: 移除 reasoning effort 的 14 个用例，并补一条回归保护 —— 旧版本写入的行带着遗留 reasoning 键时仍能正常加载、且这些键不会出现在返回结果里（用例数 107 → 93）
3. change: 三个内置 Prompt 预设整体精简重写 —— 小标题直接写成 `## 核心结论` / `## 关键要点` / `## 详细内容` / `## 注意事项`，并注明输出语言不是中文时译成该语言；引用要求从「短语必须逐字取自原文」放宽为「短句尽量照抄原文」，与 2.1.0 引用定位改为模糊匹配配套（逐字要求既难以做到，也不再是定位成功的前提）。仅新播种的 Prompt 生效
4. feat: popup 增加「供应商」下拉，模型按供应商分组（按 base URL 预设名区分同为 OpenAI Compatible 的 DeepSeek、OpenRouter 等），模型下拉显示「自定义名称（模型 ID）」
5. feat: 面板里显示模型的推理过程，默认折叠，标题栏显示推理耗时与字数；推理内容按纯文本显示，不做 Markdown 解析
6. feat: 新增首字耗时诊断插桩（`lib/summary-timing.ts`），在控制台打印从面板初始化到首字渲染的时间线（该版本在发布包里也处于开启状态，2.2.1 起仅开发构建启用）

## [2.1.0]
1. fix: 点击引用 chip 跳转原文在不少页面静默失效 —— 原实现依赖 `window.find` + Scroll-to-Text Fragment，搜不到 Shadow DOM / 同源 iframe 内的文字，要求模型逐字引用（全半角标点、空白、引号、跨段换行任一不同即失败），且同文档 `:~:text=` 跳转不可靠、遇到 hash 路由直接放弃。改为自行遍历 DOM 文本节点（含 open shadow root 与同源 iframe，跳过扩展自身面板），NFKC 归一后只比对字母数字；整句不命中时退回最长命中片段（中文 ≥6 字 / 英文 ≥16 字母，且不短于原句 35%）；多处命中优先可见位置，必要时展开折叠的 `<details>`；`scrollIntoView` 支持内层滚动容器；用 CSS Custom Highlight API 高亮 4 秒，不改动页面选区（不会误触发划词总结入口）
2. feat: 引用原文找不到时弹出提示，并把该 chip 置灰
3. test: 为引用匹配的归一化与模糊匹配补 7 个用例

## [2.0.0] 转为纯自用扩展
1. fix:内置总结 Prompt 预设硬编码「请使用简体中文」，通用设置里的「摘要语言」设置形同虚设；三个预设现在统一引用 `{{summaryLanguage}}` 变量。仅新播种的 Prompt 生效，已有 Prompt 需要手动新建或删除重新播种
2. fix: 引用溯源标记 `⟦引用:...⟧` 锁死中文字面量，摘要语言换成其他语言后标记会被模型一起翻译掉导致引用 chip 静默失效；标记格式改为语言无关的 `⟦cite:...⟧`（兼容旧版中文标记）
3. remove: 会话恢复、摘要库、导出对话（Markdown/JSON）整套基建（`lib/chat-archive.ts`、`lib/chat-session-storage.ts`、`lib/summary-library-storage.ts`、options `/library` 路由），顺带修掉「会话按 host 存导致同站不同文章串台」的问题
4. remove: 副本面板（多开浮动面板）与「新建面板」开关
5. remove: 侧边栏面板形态，只保留浮动面板；`PanelContext` 整体删除，面板恒为浮动模式
6. remove: UI 多语言机制，只保留简体中文；`lib/i18n.ts` 从 1821 行精简到 300 余行
7. remove: Firefox 兼容分支（`declarativeNetRequest` 早退、content script 的 stream polyfill、右键菜单 `page_action`/`about:addons` 分支）
8. remove: Chrome Web Store / GitHub Release 发布流程、`release/` 历史归档、`.github/`、演示图片与视频；`README.md` 重写为自用安装说明
9. fix: 内置 Prompt 预设里规定的小标题仍是中文字面量（`## 核心结论` 等），把摘要语言切成英文时会与「用 English 输出」的指令自相矛盾、产出中英混杂；改为「用输出语言命名，中文只说明含义」
10. remove: 零引用死代码 —— `ai-elements/prompt-input.tsx`（1463 行，0.8.0 删掉追问输入框后的孤儿）、`ai-elements/conversation.tsx`、`shimmer.tsx`、`ui/collapsible.tsx`、`ui/settings-card.tsx` 等，`components/ui/` 从 18 个组件降到 11 个
11. remove: 未使用依赖 `js-tiktoken`、`markdown-it`、`eventemitter3`、`react-use`、`web-streams-polyfill`、`cmdk`、`nanoid`、`use-stick-to-bottom` 及随组件删除而失去引用的若干 `@radix-ui/*`
12. chore: 面板与 popup 残留的硬编码英文文案改为中文（含工具栏图标悬停提示 `action.default_title`）；清理已失效的历史文档（`plan.md`、`docs/UX_OPTIMIZATION_PLAN.md`、两份历史 review 报告、`web-ext.config.ts.example`、`agent-browser.json`）
13. test: 引入 vitest，为纯函数补 52 个用例（迁移逻辑的 `local:` 前缀不变量与幂等性、错误分类的 status 优先与 `abort` 整词匹配、token 截断四种策略、站点规则 glob、正文清洗）
14. perf: 流式渲染不再每收到一个 chunk 就把整段文本重新 `marked.parse` 一次（长摘要下开销随长度呈二次方增长，且每帧摧毁重建 DOM）。改为首帧立即渲染 + 每 100ms 至多一次尾沿渲染，marked renderer 提为模块级单例只构造一次。注：流式过程中划词选中仍会被刷新打断，只是频率从「每 chunk」降到「每 100ms」，彻底解决需要按 markdown 块做增量 DOM 更新，未做
15. chore: 补最小 ESLint 配置（只开 `react-hooks` 两条规则）—— 此前代码里散落着 `eslint-disable` 注释但项目根本没有 ESLint 配置；复核后删除 5 处失效注释，保留并注明自动总结 effect 那处承重的 disable

## [1.6.0]
1. fix (critical): **updating the extension no longer wipes your configuration.** The 1.4.0 migration treated WXT's `local:` area prefix as part of the real storage key, so on every upgrade it deleted the live `model-configs` / `prompt-configs` / `default-*` / `site-filter-*` / `site-customization-list` keys and rewrote them under names nothing reads — losing all models (and their API keys), prompts and site rules. Because the surviving `prompt-library-seeded` flag short-circuited the seeder, the sample prompt was not recreated either. The migration now addresses raw keys, rewrites the model list in place, **recovers data stranded by the old migration**, and re-seeds the prompt library if it was emptied
2. fix: the popup no longer claims "this page is ready to summarize" on sites disabled by your white/blacklist — it now honors the content script's `ok` flag instead of only checking for a reply, so Summarize can no longer silently do nothing
3. fix: saving on the options pages no longer reverts settings changed elsewhere since the page loaded (e.g. dismissing the floating ball on a page, then toggling anything in Settings, used to bring the ball back). Writes are now scoped to the fields you actually edited
4. fix: opening or closing a second floating panel no longer clears the sidebar's page-squeeze style, which left the sidebar overlapping the page content
5. fix: real provider errors are no longer swallowed as "stopped" — the error classifier matched the bare substring `abort` anywhere in a message, including provider response bodies, which suppressed both the toast and the header error indicator. HTTP status now takes precedence and abort matching is whole-word
6. fix: importing a configuration file exported without API keys (the default) no longer erases your stored keys and custom headers — they are merged back in per model id
7. fix: triggering a summary with no model (or no prompt) configured now shows an actionable error linking to settings, instead of doing nothing at all
8. fix: conversations longer than 40 messages no longer lose their system prompt when restored — the leading system message is preserved across trimming
9. fix: legacy V1 model rows now actually get their provider icon and base URL backfilled (the guard that enabled it could never be true); a legacy row that already has a base URL is still never rewritten
10. fix: dragging or resizing a panel that unmounts mid-gesture no longer leaks `mousemove`/`mouseup` listeners on the page
11. fix: the popup's Summarize button showed the *copy* action's loading spinner
12. fix: the popup's page-status banner was hardcoded Chinese; it is now translated in all nine supported languages
13. fix: token usage cost — the uncached input count could go negative, and the cached-token discount was hardcoded to 1/10 (correct for Anthropic, wrong for OpenAI at 1/2 and Google at 1/4)
14. fix: the token preview highlighted the wrong region for the `back` and `middle` truncation strategies — it always visualized `front`. It now mirrors the strategy actually applied
15. chore: remove the unreachable per-site prompt rule storage (`SitePromptRule`), which had no UI and no callers

## [1.5.1]
1. fix (critical): the Summarize button and auto-summarize were no-ops — the memoized handler froze models/prompts/page content at their mount-time empty values; it now reads live state through a per-render ref
2. fix: config migration no longer prefers the stale legacy model list over `local:model-configs`, and never rewrites a custom baseURL just because the model name matches a preset label
3. fix: corrupt `local:chat-sessions` rows no longer crash panel initialization/rendering — rows are validated at load and usage is coerced to numbers
4. fix: panel init failures (prompt seeding / storage / extraction) are non-fatal — the panel stays usable and logs instead of silently half-initializing
5. fix: context menus rebuild live when the toggle or UI language changes; seeding failures no longer dead-initialize the panel/popup
6. fix: provider/model icons now load in the in-page panel (`llm-icons/*` is web-accessible)
7. fix: the export dropdown portaled outside the Shadow DOM (invisible/unclickable) now renders inside the panel's shadow container
8. fix: citation chips double-escaped phrase text (and mangled markup inside phrases) — markers are extracted before Markdown rendering and escaped exactly once, so clicks scroll to the quoted phrase reliably
9. fix: Markdown images with javascript:/data: URLs are dropped (same whitelist as links)
10. fix: switching model/prompt is persisted for the current session; "Clear conversation" is queued behind in-flight saves so a deleted session cannot resurrect
11. fix: `{{currentSelection}}` is preserved when a click inside the panel collapses the page selection
12. fix: classify UI-stream errors (no more generic "An error occurred.") and surface an error when a provider stream ends without output
13. fix: various robustness — deferred `URL.revokeObjectURL` for downloads (Firefox), text-fragment fallback no longer clobbers SPA hash routes, underscore locale tags (`zh_TW`) resolve correctly, YAML front-matter escapes newlines, options-page URLs are resolved against the extension origin

## [1.5.0]
1. feat: restore the conversation per site — reopening the panel (or refreshing the page) brings back the current site's chat, isolated across hosts (40 messages per session, 50 hosts LRU, main panel only)
2. feat: summary library — star a summary from the panel, then browse, search, delete, export and one-click revisit it in the new options `/library` page (max 500 entries)
3. feat: export conversation — panel dropdown offers "Export Markdown" (front-matter header, system messages excluded), "Copy Markdown" and "Copy JSON"
4. feat: cache extracted page content per URL with a lightweight DOM signature, so panel copies and reopened panels skip re-extraction and re-tokenization
5. feat: friendlier errors — HTTP/CORS/timeout failures are classified (auth / rate-limit / model-not-found / timeout / permission / aborted) with actionable en/zh copy; auth errors deep-link to model settings; user-stopped streams never surface an error
6. feat: citation traceability (phase 1) — prompts emit `⟦引用:原文短句⟧` markers, rendered as clickable chips that scroll the page back to the quoted phrase
7. docs: record `local:chat-sessions` and `local:summary-library` storage keys in AGENTS.md

## [1.4.0]
1. fix: stop the external-trigger auto-summary abort/restart loop (trigger now fires exactly once per request)
2. fix: honor the "Token usage" toggle when rendering usage in the summary panel
3. fix: run the model-config migration on real `local:` storage keys and make it idempotent per version
4. fix: keep the new-model form draft stable so a failed save no longer wipes the user's input
5. feat: add long-input truncation strategies (keep front / keep head+tail / keep end / send as-is), selectable in General settings
6. fix: populate the `{{currentSelection}}` prompt variable from the live page selection
7. fix: UI-language override now reaches content scripts and the background via storage.local mirror
8. fix: stop Mustache from HTML-escaping page content before it reaches the LLM
9. fix: disabled (whitelist/blacklist) sites no longer answer extractText; correct the duplicate-mount guard to the real host element
10. fix: guard useWxtStorage against an initial-snapshot overwriting a concurrent watch update
11. fix: config export without API keys also strips model headers (potential Authorization leakage)
12. fix: first-run prompt seeding is single-flight through the background, preventing duplicate "Sample" prompts
13. fix: fall back when `crypto.randomUUID` is unavailable on http pages
14. fix: replace Tailwind 4-only classes (`shadow-xs`, `backdrop-blur-xs`, `h-4.5`) with Tailwind 3 equivalents
15. fix: remove dead `openPopupPage` message and widen the content-panel probe window on trigger
16. fix: remove unused resize code; centralize storage-key literals on `GENERAL_SETTING_DEFINITIONS`
17. chore: rename legacy `package-lock.json` to `kuai-kan`, drop the stale `pnpm-lock.yaml`, delete leftover `compile.log`, fix the `Commad` message-key typo
18. docs: sync AGENTS.md storage keys, entrypoints, messaging protocol and known-issues with the code

## [1.3.0]
1. fix: summary panel fonts no longer change size across websites — Shadow DOM typography is now pinned to a fixed 16px reference (`--webpage-summary-panel-srem`) instead of page-dependent `rem` units
2. fix: floating/sidebar panel min sizes use fixed px so the panel size stays stable regardless of the site's root font-size

## [1.2.0]
1. security: harden Markdown fallback rendering and URL validation
2. fix: treat user cancellation as normal stream completion
3. fix: route external summary triggers through extension messaging
4. fix: align popup availability with site access rules
5. fix: improve usage token and cache accounting

## [1.1.0]
1. improve: restructure summaries with conclusions, key points, and content-type-aware sections
2. improve: enhance summary readability with visual callouts for conclusions, warnings, actions, and evidence
3. improve: strengthen source-grounding and unsupported-information guidance

## [1.0.0]
1. release: publish the stable 1.0.0 Chrome extension artifacts

## [0.8.1]
1. fix: stop-and-restart race on the summary button
2. fix: render assistant messages without hard-coded slice offset
3. fix: token usage export MIME mismatch
4. fix: sanitize markdown output before injecting HTML
5. fix: functional storage updates now use the latest value
6. fix: guard bridge stream finish after errors / typed finish usage
7. fix: restore default popup after one-shot popup items
8. fix: avoid page scroll while dragging the floating ball on touch devices
9. fix: use Command+Shift+S on macOS to avoid clashing with Save Page
10. chore: remove dead container components and unused imports

## [0.8.0]
1. rename project to KuaiKan
2. beautify summary rendering and prompts; comparisons render as lists/tables
3. remove chat input box from summary panel
4. export/import configuration as JSON/TXT file

## [0.7.7]
1. fix: fetch model list no longer requires the config name to be filled
2. hide reasoning chain in summary panel
3. build: chrome-only release artifacts
4. chore: remove dead sample code

## [0.7.5] - 2026-06-10
1. remove browser-ai provider
2. remove cookies permissons (unused)

## [0.7.3] - 2026-06-01
Complete refactoring!
Main features:
1. Brand new UI, comprehensively improved user experience
2. Sidebar mode (switching between floating panel and sidebar)
3. Clip content by token count now (by string length before)
4. Optimized AI providers settings, added support for response APIs
5. Completely redesigned settings interface

More:
1. Model config supports custom body
2. Support for fetching AI provider's models list on the model config page
3. Token usage visualization panel


Dependency changes:
1. vue3 -> react
2. ai-sdk@4.x -> ai-sdk@6.x
3. Self-implemented chat UI -> ai-elements
4. Self-implemented content<->background communication protocol supporting chat -> ai-sdk-ui + custom transport over connect API
5. String counting -> token counting (brings an extra 3MB bundle size)
 



## [0.6.2] - 2026-02-01
feature: shadowRoot support for selectors in site customization setting. @linkecoding


## [0.6.1] - 2025-12-01
1. optimize the descriptions and ordering of the general settings.
2. feature: add configuration options to enable/disable context menu items.
3. feature: add a configuration option to allowing “Add to Selection” to send directly.
4. update moonshot-web-ai-provider version, kimi chats are now deleted after the summary completes.

## [0.6.0] - 2025-09-14
1. switch size unit from `rem` to `--webpage-summary-panel-srem`, avoid some sites' html root font-size setting to affect the style of shadow root.
2. feature: add `currentSelection` prompt template variable.

## [0.5.0] - 2025-08-17
1. change project structure from monorepo workspace to regular.
2. update wxt version from 0.19 to 0.20
3. change pnpm to bun (required by wxt@0.20)
4. fix: in some websites (reddit, bilibili, ...), responsive css font sizes to fail.
5. remove some console logs
6. optimize appearance styles
7. feature: provide config to enable/disable chatbox
8. implement the logic for stopping summarize
9. implenent whitelist/blacklist
10. implement site custom selectors

## [0.4.2] - 2025-07-18
update moonshot-web-provider.
delete chatgpt-web-provide because of the the official crackdown on such behavior.

## [0.3.5] - 2025-06-08
fix chat boxt input being affected by single-key shortcuts in sites like github. 

## [0.3.3] - 2025-04-21

fix model name component error in web provider config

## [0.3.2] - 2025-04-20

use dynamic rules to achive scecure declare.

## [0.3.1] - 2025-04-20

feature: support web providers.

## [0.2.2] - 2025-03-25

1. fix `--webpage-summary-panel-top` not working
2. add video tutorial in welcome page

## [0.2.1] - 2025-03-12

1. feature: a context menu item and a command for adding selection to chat input.
2. feature: add clear/reset for clearing all the messages in panel's dialog.
3. feature: support creating multiple panels (for comparing summary of different models or prompts)
4. add adaptation to SPA (Single Page Application), input page content will change when SPA change route.
5. fix: now chatting directly without first summarizing will send messages with page context.
6. fix: draggable functionality using `px` causing it out of view in screen adjustment situations such as changing from vertical to horizontal.
7. fix: write to clipboar failed in page of http protocol
8. optimize prompt item view, add prompt preset view for creating prompt with, add another two prompt presets, and with langs of `zh-CN` and `zh-TW`.

## [0.1.5] - 2025-02-27

1. input length calculation now does not include continuous '\n', ' '

## [0.1.4] - 2025-02-27

1. fix: double panel appears when trigger by action/contentMenu under `on click` permission mode
2. add language:zh for chrome store
3. toaster background color: transparent -> white(80%)
4. fix: error hint not show when call llm failed.( streamText() feature changes when updating @ai-sdk version)
5. fix: openai-compatible default baseURL has no effect.

## [0.1.3] - 2025-02-26

1. adaption to firefox
2. new feature: export/import settings

## [0.1.2] - 2025-02-25

1. add multiple llm providers.
2. fix `open setting` context button not work outside page
3. fix page problems: model config list page: add i18n, use full width, model edit: query problems

## [0.1.1] - 2025-02-24

1. change shortcut of user chatbox: `Shift+Enter : Submit` -> `Shift+Enter: newline` and `Enter: Submit`
2. welcome page on first install
3. improve browser extension declaration(fix permission lacks problem in Edge)
4. clean up some unused codes

## [0.1.0] - 2025-02-23

### The first fully functional version
