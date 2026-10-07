## 改动说明

<!-- 这个 PR 做了什么、为什么这么做 -->

## 自检清单

- [ ] 已阅读 [AGENTS.md](../AGENTS.md) 的架构约定（通信架构 / 写入串行化、已知问题与坑）
- [ ] `npm run compile` 通过
- [ ] `npm run test` 通过，新增行为补了测试
- [ ] `npm run lint` 通过
- [ ] 用户可见的变化已写入 [CHANGELOG.md](../CHANGELOG.md)
- [ ] 未在任何上下文直接调用 `model-settings-storage` / `prompt-settings-storage` 的写函数（一律走 `mutateModelSettings` / `mutatePromptSettings` 后台队列）

## 验证方式

<!-- 你在哪些页面 / 什么配置下手动验证过 -->
