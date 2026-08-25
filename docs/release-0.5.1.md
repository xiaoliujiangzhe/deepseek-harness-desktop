# DeepSeek Harness Desktop v0.5.1

本版本在 `v0.5.0` 的内置文件编辑器基础上增加“通用对话”入口。

## 新增

- 左侧栏增加一级“通用对话”，无需先选择项目目录即可开始聊天。
- 通用对话在应用私有目录中运行，不会把用户主目录或任意真实项目伪装成通用区。
- 侧栏收起时入口自动变成紧凑图标；当前通用会话会显示选中状态。
- 工作区分组视图隐藏内部兼容 Workspace，通用会话由独立入口创建。
- 需要已有项目文件时，默认边界说明会提示用户切换到对应工作区。

## 实现说明

Harness `0.1.1-rc.2` 的 Web UI 仍要求会话选择 Workspace，因此桌面端在 Electron 用户数据目录中维护一个专用目录，并复用官方 `workspace.create`、`workspace.rename` 与 `session.create` 接口。它属于桌面产品层的“无须用户选择项目”体验，不修改官方 Harness 包。

## 验证

- `npm test`：46 项通过。
- `npm run verify:harness`：Harness `0.1.1-rc.2` 校验通过。
- 隔离 Electron userData / DSH_HOME：入口、Session 创建、选择恢复和输入框可用均已确认。
- `npm run dist:win`：Harness `0.1.1-rc.2`、便携 Node.js `v24.18.0`、pnpm `11.21.0` 的打包验收通过。

## 下载与校验

- 安装包：`DeepSeek-Harness-Setup-0.5.1.exe`（149,115,714 bytes）
- SHA256：`BB34E799F9DAB3132DEE2DCC373BE07C75232F345F80A76529BCD731A0ECE594`
- 应用内更新需要同一 Release 中的 `.exe.blockmap` 和 `latest.yml`，请勿单独删除。
