# DeepSeek Harness Desktop v0.5.3

本版本紧急修复 `v0.5.2` 桌面功能未初始化的问题。

## 修复

- 恢复右侧可拖动工具栏。
- 恢复内置浏览器、文件编辑器、插件中心、诊断中心和更新中心入口。
- 恢复桌面外观注入。
- 恢复独立“通用对话”入口，并继续隐藏内部兼容 Workspace。
- 保留 `v0.5.2` 的会话恢复逻辑，返回通用对话时仍会打开上一次聊天。

## 原因

`v0.5.2` 在 Electron 沙箱 preload 中加载了本地 CommonJS 模块，导致 preload 在初始化时终止。`v0.5.3` 将会话选择移到主进程受限 IPC，并增加防回归测试。

## 升级说明

由于 `v0.5.2` 的更新中心入口也未显示，请从本 Release 手动下载安装 `v0.5.3`。安装不会删除现有会话、设置、凭据或插件。升级完成后应用内更新恢复正常。

## 验证

- `npm test`：50 项通过。
- `npm run verify:harness`：Harness `0.1.1-rc.2` 校验通过。
- 使用正式用户数据验证工具栏、独立通用对话入口与原“你好”会话恢复正常。

## 发布资产

- 安装包：`DeepSeek-Harness-Setup-0.5.3.exe`，149,116,108 bytes，SHA256：`06080900451CF44C62715DCCBF1ED3FE1A5744E8BF7E1DA4C0088A3680457376`。
- blockmap：`DeepSeek-Harness-Setup-0.5.3.exe.blockmap`，154,873 bytes，SHA256：`2EC62F358E2868C22070E4121BE20886EBF3DEE464F0C3F6CEF41C711808BD03`。
- 更新元数据：`latest.yml`，361 bytes，SHA256：`32266BFDC198E14C89C4C71145C880E2C7C5B576A1D996452DA48E1B5EE74A10`。
