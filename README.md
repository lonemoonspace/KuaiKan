<h1 align="center">
  <img src="./assets/16.png" width="26" alt="KuaiKan logo"/>
  KuaiKan 快看
</h1>

<p align="center">
  用你自己的大模型 API Key 总结网页内容的浏览器扩展。<br/>
  纯本地运行 · 无后端服务 · 不采集任何遥测数据
</p>

<p align="center">
  <a href="https://github.com/lonemoonspace/KuaiKan/actions/workflows/quality.yml"><img src="https://github.com/lonemoonspace/KuaiKan/actions/workflows/quality.yml/badge.svg" alt="quality"/></a>
  <a href="https://github.com/lonemoonspace/KuaiKan/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"/></a>
  <a href="https://github.com/lonemoonspace/KuaiKan/releases"><img src="https://img.shields.io/github/v/release/lonemoonspace/KuaiKan" alt="release"/></a>
</p>

## 简介

KuaiKan 是一个网页总结浏览器扩展（Chrome / Edge，Manifest V3）：在任意网页上通过
右键菜单、快捷键面板或工具栏 popup 一键触发，调用**你自己配置的模型**生成结构化总结。
所有请求从你的浏览器直连模型服务商，不经过任何第三方服务器。

主要特性：

- **多模型接入**：OpenAI、Anthropic、Google Generative AI、任意 OpenAI 兼容接口
  （DeepSeek、Kimi、OpenRouter、Ollama 本地模型等），可保存多套配置随时切换
- **自定义 Prompt 模板**：Mustache 变量渲染，内置「页面总结 / 简要总结」等模板，可自由增删
- **流式输出**：基于 Vercel AI SDK v6，总结逐字呈现；跨标签页切换后面板快照自动恢复
- **智能正文提取**：`@mozilla/readability` 与 DOM 启发式双引擎，正文不足时自动回退
  shadow DOM / 同源 iframe 扁平化提取
- **超长内容处理**：精确 token 计数（gpt-tokenizer），支持头部 / 中部 / 尾部三种裁剪策略，
  自动预留输出与提示词预算，避免 `context_length_exceeded`
- **可拖拽面板**：页面内 Shadow DOM 浮动面板，支持拖拽、缩放、字号调节、深浅色主题
- **隐私优先**：无遥测、无后端、API Key 仅存在浏览器本地 `storage.local`，
  导出配置时默认剔除密钥

## 安装

**方式一：下载构建好的 zip（推荐）**

1. 到 [Releases](https://github.com/lonemoonspace/KuaiKan/releases) 下载最新版的
   `kuai-kan-<version>-chrome.zip`
2. 解压到任意目录
3. 打开 `chrome://extensions`，开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择解压出来的目录

**方式二：从源码构建**

```bash
git clone https://github.com/lonemoonspace/KuaiKan.git
cd KuaiKan
npm install
npm run build
```

构建产物在 `.output/chrome-mv3`，按上面第 3–4 步加载即可。
（`npm run zip` 可额外生成 zip 包。）

## 使用

1. 首次安装后打开**设置页**（右键扩展图标 → 选项），添加一个模型配置：
   选服务商、填 API Key 与模型名即可；Ollama 等本地模型填本机地址即可，无需 Key。
2. 在任意网页上：
   - **右键菜单** → 「总结此页」，或
   - 点击工具栏的扩展图标打开 **popup** → 点「总结」
3. 页面右侧出现总结面板，流式输出结果；面板可拖拽、缩放，关闭后同页重开会恢复对话。

设置页里还可以调整：正文提取方式、超长裁剪策略、面板字号、主题（跟随系统/浅色/深色）、
Token 用量视图、日志级别等。

## 技术栈

React 19 + TypeScript · [WXT](https://wxt.dev) + Vite · Tailwind CSS + Radix UI / shadcn 体系 ·
Vercel AI SDK v6 · `@mozilla/readability` · marked · Mustache · gpt-tokenizer ·
`@webext-core/messaging` · Vitest

架构与开发约定（通信协议、存储键、发布流程、已知坑）都写在
[AGENTS.md](AGENTS.md) 里，改代码前建议先读。

## 开发

```bash
npm run dev       # WXT 开发模式（热重载，自动打开浏览器）
npm run compile   # tsgo --noEmit 类型检查
npm run test      # Vitest
npm run lint      # ESLint
```

提交前请跑完整闸门：`npm run compile && npm run test && npm run lint`
（CI 会在 push / PR 上重复这三步，见
[quality.yml](.github/workflows/quality.yml)）。

## 贡献

欢迎 Issue 与 Pull Request。提交 PR 前请：

1. 阅读 [AGENTS.md](AGENTS.md) 中的架构约定（尤其是「通信架构 / 写入串行化」与
   「已知问题与坑」两节，很多看似 bug 的行为是有意为之）；
2. 确保闸门全绿，新增行为补上测试；
3. 如涉及用户可见变化，在 [CHANGELOG.md](CHANGELOG.md) 的 `Unreleased` 或对应版本条目里说明。

安全问题（尤其是 API Key 泄露、注入风险相关）请按
[SECURITY.md](.github/SECURITY.md) 私下报告，不要开公开 Issue。

## 致谢

本项目是 [ctxinf/webpage-summary](https://github.com/ctxinf/webpage-summary) 的 fork，
针对个人使用场景做了大量精简与重写；灵感同时来自
[chatGPTBox](https://github.com/josStorer/chatGPTBox)。

## License

[MIT](LICENSE)
