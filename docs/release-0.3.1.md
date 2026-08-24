# DeepSeek Harness Desktop v0.3.1

## 本次修复

- 插件索引下载后缓存 6 小时。搜索在本地完成，过期时继续显示旧缓存并后台刷新。
- 插件目录和 GitHub 下载使用 Electron 网络栈，支持 Windows 系统代理，并带整体超时、响应体积限制和有限重试。
- GitHub 插件安装不再统一误判为“需要构建”。桌面端先锁定 commit SHA，再检查 `package.json`、`dsh.bundle.patch`、入口文件和生命周期脚本。
- 无安装脚本且仓库已包含 `main` / `module` / `exports` 成品入口的 GitHub bundle，可下载到 `~/.dsh/desktop-plugin-sources` 后安装。
- 安装包内新增 pnpm 11.21.0；用户无需预装 Node、npm 或 pnpm。

## 安全边界

- 不执行 GitHub 插件的 `preinstall`、`install`、`postinstall`、`prepare` 或 `prepack` 脚本。
- 有上述脚本的插件必须由作者发布 npm 或 Release 成品包后才能一键安装。
- 安装前备份 web profile；命令失败或插件未进入 bundle 列表时自动恢复配置。

## 已验证

- `npm test`：19 个测试通过。
- 真实 GitHub 安装测试：`MeteorNOX/DeepSeek-Balance-Whale-Widget` 成功解析为 `dsh-whale-widget 0.2.9`，锁定 commit `2b258781620edac2b94956bca98c9bfa78d0d62f`，并进入隔离 profile 的 bundle 列表。
- `npm run verify:harness`：应在发布前再次执行并以实际命令输出为准。
- `npm run dist:win`：应在发布前完成，并确认输出 `release/DeepSeek Harness Setup 0.3.1.exe`。

## v0.3.0 用户升级

无需删除 GitHub 上的 `v0.3.0`。发布 `v0.3.1` 后，用户直接运行新安装包覆盖安装即可；`~/.dsh` 中的会话、设置、凭据和附件不会由安装器删除。
