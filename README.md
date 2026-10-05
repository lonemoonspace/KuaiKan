<h1 align="center" style="display: flex; flex-direction: row;justify-content:center; align-items: center; gap:.25em;">
 <img src="./assets/16.png" width="26"/>
 <span> KuaiKan 快看 </span>
</h1>
<p align="center">用你自己的大模型 API Key 总结网页内容的浏览器扩展（自用精简版，不上架应用商店）。</p>

## 简介

KuaiKan 是一个纯本地运行的网页总结扩展：不依赖后端服务、不采集任何遥测数据。右键菜单或 popup
一键触发，调用你自己配置的模型（OpenAI / Anthropic / Google / Ollama / 任意 OpenAI 兼容接口等）
生成结构化总结，支持自定义 Prompt 模板、站点定制提取规则、超长内容裁剪策略等。

本仓库是 [ctxinf/webpage-summary](https://github.com/ctxinf/webpage-summary) 的私有 fork，
已针对个人自用做了精简（移除多语言、会话恢复/摘要库、副本与侧边栏面板、商店发布流程等），
不再面向公开分发。

## 构建

```bash
npm install
npm run build
```

构建产物在 `.output/chrome-mv3`。如需生成 zip 包，运行 `npm run zip`。

其他命令：`npm run compile`（类型检查）、`npm run test`（Vitest）、`npm run lint`。

## 在 Chrome 中加载

1. 打开 `chrome://extensions`
2. 打开右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3` 目录

## 版本归档

每个发布版本的 zip 存放在 `release/<version>/`，用于回滚或在另一台机器上安装
（在 `chrome://extensions` 里把 zip 解压后按上面的步骤加载）。当前版本 **3.1.3**。

发布步骤见 [AGENTS.md](AGENTS.md) 的「构建与发布」一节。

## 致谢

灵感来自 [chatGPTBox](https://github.com/josStorer/chatGPTBox) 与上游项目
[ctxinf/webpage-summary](https://github.com/ctxinf/webpage-summary)。
