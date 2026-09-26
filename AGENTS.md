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
7. 校验：解开 zip 确认里面 `manifest.json` 的 `version` 与目标版本一致
8. 提交、打 tag `v<version>`、推送到 GitHub（`origin` = github.com/lonemoonspace/KuaiKan）
9. 用 `gh release create v<version> release/<version>/kuai-kan-<version>-chrome.zip` 发
   GitHub Release，说明取自 `CHANGELOG.md` 对应版本条目

最终保留两份产物：

- 压缩包 `release/<version>/kuai-kan-<version>-chrome.zip`（归档 / 回滚用，同时附在
  GitHub Release 上）
- 解压版 `.output/chrome-mv3/`（Chrome 加载已解压扩展用）

`release/` 目前**不**被 `.gitignore` 忽略；如果以后不想让归档进版本库，取消 `.gitignore`
末尾那行 `# release/` 的注释即可。

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
| 验证 | Zod |
| 正文提取 | @mozilla/readability |
| Markdown | marked（`components/ai-elements/message.tsx` 内动态导入，模块级单例 renderer） |
| 测试 | Vitest（`test/`，`npm run test`）；`test/**/*.ts(x)` 和 `vitest.config.ts` 也在 `tsconfig.json` 的 `include` 里，`npm run compile` 一并类型检查 |
| Lint | ESLint flat config，`react-hooks` 两条规则 + `@typescript-eslint/no-unused-vars`（`npm run lint`） |
| 模板 | Mustache（Prompt 变量渲染） |
| Token 计数 | gpt-tokenizer（background 动态导入，通过 `truncateByTokens*`/`countInputTokens*` RPC 服务 content） |
| 扩展通信 | @webext-core/messaging + 自建 connect bridge |
| 存储 | WXT Storage（`browser.storage.local`） |

---

## 入口点 (entrypoints)

| 入口 | 说明 |
|---|---|
| `entrypoints/content/` | 注入网页的 content script，Shadow DOM 挂载总结面板和悬浮球 |
| `entrypoints/background/` | 后台脚本，处理右键菜单、LLM 流式调用、首次 prompt 播种 |
| `entrypoints/popup/` | 扩展图标弹窗 |
| `entrypoints/options/` | 设置页，管理模型、Prompt 与通用设置 |

---

## 通信架构

### 普通消息（控制面）
基于 `@webext-core/messaging`，用于短 RPC 和控制事件。协议文件：`lib/messaging.ts`（`ProtocolMap` 是唯一权威定义）。

当前消息：`openOptionPage`（content→background）、`loadPanelSnapshot` / `savePanelSnapshot`（content→background，按发送方标签页读写面板快照）、`invokeSummary`（background→content 打开/触发总结）、`seedPromptLibrary`（各上下文→background，后台单飞执行播种，避免并发重复初始化）、`ping` / `extractText`（popup→content）、token 计数与裁剪 RPC（`countInputTokens*` / `truncateByTokens*` / `splitTokensWithTiming`）。

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
| `local:enable-floating-ball` 等布尔开关 | `boolean` | 各开关（定义见 `GENERAL_SETTING_DEFINITIONS`，含 `enable-tokan-usage-view`——拼写 TOKAN，保持兼容勿改） |
| `local:migration-version` | `number` | 迁移幂等标记（`lib/migration.ts`） |

动态键：`local:<storageKey>-floating-state`（`PanelContainer`）、`local:right-floating-ball-top-<key>`（`RightFloatingBallContainer`）。

面板快照：`session:panel-snapshots-<tabId>`（`browser.storage.session`，仅内存、重启浏览器即清空），
`Record<pageKey, { open, messages, updatedAt }>`，每个标签页最多 20 个页面（LRU），标签页关闭时由后台删除。
`pageKey` 是去掉页内锚点的 URL（`#/`、`#!` 开头的 hash 路由保留），见 `lib/panel-snapshot.ts`。
content script 读不到 `storage.session` 也不知道自己的 tabId，所以一律经后台 RPC 读写；只存 assistant 消息，
不存带整页正文的 system/user 消息。

---


## 模型配置（React 重写版）

Provider 描述表：`constants/model-settings.ts`。支持：OpenAI Compatible、OpenAI、Open Responses、Anthropic、Google Generative AI、Ollama。

- Base URL 不是独立 provider，而是 provider 下的快捷 URL（OpenRouter = OpenAI Compatible + 快捷 URL）
- CRUD：`lib/model-settings-storage.ts`
- Provider factory：`lib/model-provider.ts`，`createLanguageModelFromConfig(config)`
- extraBody / headers 按 JSON object 存储，通过 provider 自定义 fetch 合并到 JSON body
- 供应商分组标签（`getModelVendorLabel`）和图标（`getModelDisplayIcon`）都经
  `findBaseURLPreset` 按 host 匹配 preset（忽略协议/大小写/尾部斜杠/`/v1` 等路径差异），
  同 host 但路径不同的多个 preset 按最长公共路径段匹配

---

## 面板结构

自用精简后只保留两种面板：

| 面板 | 说明 |
|---|---|
| 页面内浮动面板 | 默认开启，可拖拽缩放；`components/container/PanelContainer.tsx` |
| Popup 面板 | 简洁，仅 model/prompt 选择和总结，默认固定 |

侧边栏面板、副本面板（多开浮动面板）已删除。


---

## 已知问题与坑

| 问题 | 详情 |
|---|---|
| `TOKAN` 拼写错误 | storage key `local:enable-tokan-usage-view`，重写时保持兼容，不改 key |
| Markdown `html: true` XSS | 已核查：`MessageResponse` 对 html token 做 `escapeHtml`，链接经 `isSafeUrl` 白名单（http/https/mailto），未见直接 XSS；改动模板时仍需注意 |
| `ollama-ai-provider` 兼容性 | 仍是旧 ProviderV1 类型，通过类型强转接入 AI SDK 6，运行时兼容性待测 |
