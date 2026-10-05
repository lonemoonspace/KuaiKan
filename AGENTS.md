# AGENTS

## 调试约定

- **不要运行 `npm run dev`**，这个常驻后台，如需重启通知用户手动操作
- **不要使用 AgentBrowser 进行测试**

---

## 构建与发布

本项目纯自用，不上架 Chrome Web Store。「发布」指在本地归档一份可回滚的 zip，随后提交、
打 tag 并推送到 GitHub，发一个 GitHub Release 存档（不涉及应用商店审核）。

日常开发只需：

1. `npm run compile`（`tsgo --noEmit`）类型检查
2. `npm run test`（Vitest）
3. `npm run build`，产出 `.output/chrome-mv3`，在 Chrome 里加载已解压扩展

发布新版本时按顺序执行：

1. 改版本号，**三处必须同步**：`package.json` 的 `version`、`package-lock.json` 的顶层
   `version` 和 `packages[""].version`（后者容易漏，`npm install` 会把它改回去）
2. `CHANGELOG.md` 增加对应版本条目
3. 跑完整闸门：`npm run compile` && `npm run test` && `npm run lint`
4. 清掉 `.output` 下的旧 zip（`rm -f .output/*-chrome.zip`），避免旧包被误拷进新版本目录
5. `npm run zip`，产出 `.output/kuai-kan-<version>-chrome.zip`
6. 归档：`mkdir -p release/<version>` 并把 zip 拷进去
7. 校验：解开 zip 确认里面 `manifest.json` 的 `version` 与目标版本一致；**再确认
   `.output/chrome-mv3/manifest.json` 也是目标版本**（那份是 Chrome「加载已解压扩展」用的，
   曾经落后源码两个版本还没人发现）
8. 提交、打 tag `v<version>`、推送到 GitHub（`origin` = github.com/lonemoonspace/KuaiKan）
9. 用 `gh release create v<version> release/<version>/kuai-kan-<version>-chrome.zip` 发
   GitHub Release，说明取自 `CHANGELOG.md` 对应版本条目

最终保留两份产物：

- 压缩包 `release/<version>/kuai-kan-<version>-chrome.zip`（归档 / 回滚用，同时附在
  GitHub Release 上）
- 解压版 `.output/chrome-mv3/`（Chrome 加载已解压扩展用）

`release/` 里的 **zip 有意入库**；第 7 步解出来的 `release/**/kuai-kan-*-chrome/` 目录
（只是校验副本）在 `.gitignore` 里，别再提交它。如果以后不想让归档进版本库，取消
`.gitignore` 里那行 `# release/` 的注释即可。

需要分析产物体积时用 `ANALYZE=1 npm run build`（输出 `.output/stats.html`，默认关闭，
否则每次构建都会重写一个 ~1MB 的报告）。提交前跑一遍闸门即可，CI（`.github/workflows/quality.yml`）
会在 push / PR 上重复这三步。

---

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | React + TypeScript |
| 构建 | WXT + Vite |
| 包管理 | npm（仅保留 `package-lock.json`，勿再引入 pnpm-lock） |
| 样式 | Tailwind CSS + tailwindcss-animate；颜色、字体 token 统一在 `assets/theme.css`（面板 `:host` 与 popup/设置页 `:root` 共用一套，只有一个主色），面板正文排版在 `entrypoints/content/style.css`（字号四档 12/13/15/17px，全部基于 `--webpage-summary-panel-srem`） |
| 组件库 | Radix UI (React) + shadcn/ui 体系 + `ai-elements` |
| 图标 | Lucide React |
| 工具 | CVA, clsx, tailwind-merge |
| AI | Vercel AI SDK v6（`ai/react` `useChat`） |
| LLM provider | @ai-sdk/openai, anthropic, google 等 |
| 验证 | 无自有校验库：`zod` 只是 `ai` 的 peer 依赖（源码零引用，不要把它当成项目的 schema 工具；本仓库的校验都在 `lib/model-settings-storage.ts` / `lib/prompt-settings-storage.ts` 的手写清洗函数里） |
| 正文提取 | @mozilla/readability |
| Markdown | marked（`components/ai-elements/message.tsx` 内动态导入，模块级单例 renderer） |
| 测试 | Vitest（`test/`，`npm run test`）；`test/**/*.ts(x)` 和 `vitest.config.ts` 也在 `tsconfig.json` 的 `include` 里，`npm run compile` 一并类型检查。`vitest.config.ts` 的 include 是 `test/**/*.test.{ts,tsx}`（只写 `.ts` 会让新增的 `.tsx` 测试静默不跑） |
| Lint | ESLint flat config，`react-hooks` 两条规则 + `@typescript-eslint/no-unused-vars`，三项都是 **error**（`npm run lint`）；ignores 覆盖 `.wxt/.output/next/release` |
| CI | `.github/workflows/quality.yml`：push / PR 上跑 `npm ci` + compile + test + lint |
| 模板 | Mustache（Prompt 变量渲染） |
| Token 计数 | gpt-tokenizer（background 动态导入，通过 `truncateByTokens*`/`countInputTokens*` RPC 服务 content）；注意词表会被打进 `background.js`，见「已知问题与坑」 |
| 扩展通信 | @webext-core/messaging + 自建 connect bridge；后台每个入口都用 `lib/background-trust.ts` 断言发送方是本扩展 |
| 存储 | WXT Storage（`browser.storage.local`） |

---

## 入口点 (entrypoints)

| 入口 | 说明 |
|---|---|
| `entrypoints/content/` | 注入网页的 content script，Shadow DOM 挂载总结面板 |
| `entrypoints/background/` | 后台脚本，处理右键菜单、LLM 流式调用、首次 prompt 播种 |
| `entrypoints/popup/` | 扩展图标弹窗 |
| `entrypoints/options/` | 设置页，管理模型、Prompt 与通用设置 |

---

## 通信架构

### 普通消息（控制面）
基于 `@webext-core/messaging`，用于短 RPC 和控制事件。协议文件：`lib/messaging.ts`（`ProtocolMap` 是唯一权威定义）。

当前消息：`openOptionPage`（content→background）、`loadPanelSnapshot` / `savePanelSnapshot`（content→background，按发送方标签页读写面板快照）、`mutateModelSettings` / `mutatePromptSettings`（各上下文→background，模型/Prompt 的增删改移与设默认都走这里）、`invokeSummary`（background→content 打开/触发总结）、`seedPromptLibrary`（各上下文→background，后台单飞执行播种，避免并发重复初始化）、`ping` / `extractText`（popup→content）、token 计数与裁剪 RPC（`countInputTokens*` / `truncateByTokens*` / `splitTokensWithTiming`）。

**写入串行化**：`local:model-configs` / `local:prompt-configs` 的每个变更都是「读全量 → 改 → 写全量」。写入方分散在面板、popup、设置页，所以**必须**经 `mutateModelSettings` / `mutatePromptSettings` 在后台排队执行（`entrypoints/background/settings-mutations-bg.ts` 的 `createQueue()`，与面板快照同一套思路）。各上下文**不要**直接调用 `lib/model-settings-storage.ts` / `lib/prompt-settings-storage.ts` 里的写函数，那会绕过队列并丢更新；读函数（`loadModelSettings` 等）可以直连。

**发送方校验**：后台每个消息入口和 bridge 端口都用 `lib/background-trust.ts` 断言 `sender.id === browser.runtime.id`（manifest 没有 `externally_connectable`，所以这层是纵深防御，改 manifest 时别把它当成唯一屏障）。

### Connect Bridge（LLM 流式通道）
正式接口：`lib/ai-sdk-connect-bridge.ts` + `lib/ai-sdk-connect-transport.ts`

帧协议：
```ts
ClientFrame: { type: 'send-messages'; requestId; chatId; messages: UIMessage[] } | { type: 'abort' }
ServerFrame:  { type: 'chunk'; chunk: UIMessageChunk } | { type: 'error'; message } | { type: 'done' }
            | { type: 'timing'; marks: Record<string, number>; final: boolean }
```

`timing` 帧仅在开发构建（`import.meta.env.DEV`）发送，见 `lib/summary-timing.ts`：有正文
片段时发两帧（首个正文片段一次 `final: false`，流结束一次 `final: true`），没有正文片段
时流结束只发一次 `final: true`。

流程：content `useChat({ transport: new AiSdkConnectTransport() })` → port → background `registerAiSdkConnectBridge()` → `createLanguageModelFromConfig()` → `streamText()` → `result.toUIMessageStream()` → 逐帧发回 content。

`reconnectToStream()` 返回 `null`（direct transport 策略）。

---

## 存储键 (Storage Keys)

统一 `local:` 前缀，存放在 `browser.storage.local`。键常量定义在 `constants/general-settings.ts`、`constants/model-settings.ts`、`constants/prompt-settings.ts`（不存在的 `src/constants/storage-key.ts` 仅见于旧文档）；业务代码不要写裸字面量键。

| Key | 类型 | 说明 |
|---|---|---|
| `local:model-configs` | `ModelConfigItem[]` | LLM 模型配置列表 |
| `local:prompt-configs` | `PromptConfigItem[]` | Prompt 模板列表 |
| `local:default-model-id` | `string` | 当前默认模型配置 ID |
| `local:default-prompt-id` | `string` | 当前默认 Prompt ID |
| `local:prompt-library-seeded` | `boolean` | Prompt 库是否已播种 |
| `local:summary-input-exceed-behaviour` | `front/middle/back/nothing` | 超长内容裁剪策略 |
| `local:page-text-extract-method` | `readability/dom-heuristic` | 正文提取方式 |
| `local:log-level` | `debug/info/warn/error/silent` | 日志级别 |
| `local:panel-font-size` | `small/medium/large` | 面板正文字号（14/16/18px 基准单位，只作用于阅读区，见 `PANEL_FONT_SIZE_REM_PX`） |
| `local:enable-auto-begin-summary` 等布尔开关 | `boolean` | 各开关（定义见 `GENERAL_SETTING_DEFINITIONS`，含 `enable-tokan-usage-view`——拼写 TOKAN，保持兼容勿改） |
| `local:migration-version` | `number` | 迁移幂等标记（`lib/migration.ts`） |

动态键：`local:<storageKey>-floating-state`（`PanelContainer`）。

面板快照：`session:panel-snapshots-<tabId>`（`browser.storage.session`，仅内存、重启浏览器即清空），
`Record<pageKey, { open?, messages, updatedAt }>`（`open` 只在用户手动开关面板时写入，未写入时由「新页面自动打开面板」设置决定），每个标签页最多 20 个页面（LRU），标签页关闭时由后台删除。
`pageKey` 是去掉页内锚点的 URL（`#/`、`#!` 开头的 hash 路由保留），见 `lib/panel-snapshot.ts`。
content script 读不到 `storage.session` 也不知道自己的 tabId，所以一律经后台 RPC 读写；只存 assistant 消息，
不存带整页正文的 system/user 消息。

---


## 模型配置（React 重写版）

Provider 描述表：`constants/model-settings.ts`。支持：OpenAI Compatible、OpenAI、Open Responses、Anthropic、Google Generative AI、Ollama。

- Base URL 不是独立 provider，而是 provider 下的快捷 URL（OpenRouter = OpenAI Compatible + 快捷 URL）
- CRUD：`lib/model-settings-storage.ts`（**写操作只能从后台调用**，见「通信架构 / 写入串行化」）
- Provider factory：`lib/model-provider.ts`，`createLanguageModelFromConfig(config)`
- **Ollama 走 OpenAI 兼容端点**：`ollama-ai-provider` 的模型仍是 specification v1，AI SDK 6 会在运行时抛
  `AI_UnsupportedModelVersionError`，所以 `providerId: 'ollama'` 由 `createOpenAICompatible` 实现，
  base URL 经 `normalizeOllamaBaseURL` 统一成 `.../v1`（旧版本存下来的 `.../api` 在读取时就地改写）
- extraBody / headers 按 JSON object 存储，通过 provider 自定义 fetch 合并到 JSON body；headers 的值必须是字符串，设置页在提交前校验（`cleanHeaders` 会把非字符串值丢掉）
- 供应商分组标签（`getModelVendorLabel`）和图标（`getModelDisplayIcon`）都经
  `findBaseURLPreset` 按 host 匹配 preset（忽略协议/大小写/尾部斜杠/`/v1` 等路径差异），
  同 host 但路径不同的多个 preset 按最长公共路径段匹配；`<img src>` 一律经 `lib/model-icon.ts` 的
  `resolveModelIconUrl()` 生成（`web_accessible_resources` 用了 `use_dynamic_url`，裸路径不解析）
- **写入语义**：加载对坏行是宽容的（跳过 + warn），写回时会把这些**认不出的行原样保留**在数组末尾，
  不会被一次编辑顺带删除；导入时若所有行都无法识别则整体拒绝并抛错。导出 JSON 默认剔除
  `apiKey` / `headers`，要带上凭据必须显式确认

---

## 面板结构

自用精简后只保留两种面板：

| 面板 | 说明 |
|---|---|
| 页面内浮动面板 | 默认开启，可拖拽缩放；`components/container/PanelContainer.tsx` |
| Popup 面板 | 简洁，仅模型配置/模型选择 + 总结 + 复制页面，默认固定；**没有** Prompt 选择器（Prompt 只在设置页改）。两个下拉都会写全局默认项，切换前留意 |

侧边栏面板、副本面板（多开浮动面板）已删除。


---

## 已知问题与坑

| 问题 | 详情 |
|---|---|
| `TOKAN` 拼写错误 | storage key `local:enable-tokan-usage-view`，重写时保持兼容，不改 key |
| Markdown 转义管线 | `MessageResponse` 把 marked 的输出整体交给 `dangerouslySetInnerHTML`，所以**任何** renderer 分支返回未转义文本都是注入点。当前：`html` token 转义、`link` 走 `isSafeUrl` 白名单 + 转义、`image` **不渲染 `<img>`**（只返回转义后的 alt 文本——模型输出受页面影响，渲染图片等于让页面驱动一次真实外发请求，且相对路径会命中被访站点），citation chip 的占位符只在文本上下文替换（跳过标签内部）。改 renderer 时先看 `test/components/message.test.ts` 里针对渲染管线的用例（含 `![<img …>](javascript:…)` 回归） |
| `background.js` 2.6MB | `gpt-tokenizer/model/gpt-5` 只导入 `o200k_base` 词表，但打包时词表（2.22MB）被内联进 background 入口，产物里没有独立 tokenizer chunk，SW 冷启动要解析整份。这是"精确计数"的代价：要变小只能换近似分词器、或把计数挪到 offscreen document（属架构改动，未做） |
| 面板宿主可被页面干扰 | 宿主是页面 `<body>` 的普通子元素：页面清空/重建 body 会带走面板（现在有 MutationObserver 重挂），页面也可以**预先**创建同名 `<webpage-summary-entrance>` 让面板永不挂载（`scope.tsx` 的重复挂载守卫）。后者无解，属已知限制 |
| react-router 漏洞告警 | `npm audit --omit=dev` 报 10 条（9 low / 1 high），全部来自 `react-router@7`，官方 **No fix available**。命中的是 SSR / RSC / `deserializeErrors` 等本扩展不使用的路径；`useNavigate`/`<Link>` 的开放重定向需要用户可控的跳转目标，本扩展只跳字面路由。升级依赖时重新评估 |
| Ollama 旧 provider | 已解决：`ollama-ai-provider` 与 `picomatch` 已从依赖中移除，`providerId: 'ollama'` 改由 OpenAI 兼容客户端实现（见「模型配置」）。若将来要恢复原生 provider，必须先确认它实现了 specification v2/v3 |
