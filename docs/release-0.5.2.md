# DeepSeek Harness Desktop v0.5.2

本版本修复 `v0.5.1` 通用对话入口无法恢复聊天记录的问题。

## 修复

- 返回“通用对话”时恢复上一次会话，不再每次新建空白 Session。
- 从 `v0.5.1` 升级时，自动跳过旧版本误建的空白 Session，优先找回最近一条已有聊天内容的通用会话。
- 只恢复属于通用 Workspace 的顶级 Session，不会误选其他工作区或子 Agent 会话。
- 仅当通用 Workspace 确实没有可用 Session 时才创建新会话。

## 数据说明

`v0.5.1` 只是创建了额外的空白 Session，并未删除原聊天日志。升级到 `v0.5.2` 后原有通用对话会自动重新出现。

## 验证

- `npm test`：49 项通过。
- `npm run verify:harness`：Harness `0.1.1-rc.2` 校验通过。
- 使用真实 `v0.5.1` 数据完成“切换其他工作区 → 返回通用对话”验证，恢复为同一条包含“你好”的会话。
- `npm run dist:win`：Harness `0.1.1-rc.2`、便携 Node.js `v24.18.0`、pnpm `11.21.0` 的打包验收通过。

## 下载与校验

- 安装包：`DeepSeek-Harness-Setup-0.5.2.exe`（149,115,967 bytes）
- SHA256：`10D33B7F0D5069F5A64A5CD154ED24D78BF44057EDECD124E417CEE03A54D784`
- 应用内更新需要同一 Release 中的 `.exe.blockmap` 和 `latest.yml`，请勿单独删除。
