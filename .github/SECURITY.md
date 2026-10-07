# 安全政策

## 报告漏洞

**请不要**通过公开 Issue 报告安全漏洞。请使用
[GitHub 私密安全公告](https://github.com/lonemoonspace/KuaiKan/security/advisories/new)
提交，维护者会尽快响应。

值得报告的方向举例：

- 模型输出渲染管线（marked → `dangerouslySetInnerHTML`）的注入绕过——这是本项目
  最敏感的攻击面，现有防护与回归测试见 [AGENTS.md](../AGENTS.md) 的「已知问题与坑」
- API Key 或其他凭据的非预期外发（例如被拼进不该去的请求、被页面脚本读到）
- content script 与 background 之间信任边界的问题（`lib/background-trust.ts`）
- 配置导入路径的恶意文件处理

## 范围说明

- 本扩展申请的 `host_permissions: <all_urls>` 是功能必需（要在任意页面注入面板），
  本身不算漏洞；但**页面能借此驱动扩展做出超出预期的事**（如让后台携带凭据请求
  攻击者指定的地址）属于有效报告。
- 「页面可以预先创建 `<webpage-summary-entrance>` 元素阻止面板挂载」是**已知限制**，
  见 AGENTS.md，不算漏洞。

## 支持版本

仅最新 release 版本接收安全修复。
