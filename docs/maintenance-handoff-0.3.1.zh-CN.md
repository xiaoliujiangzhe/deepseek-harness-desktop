# DSH Desktop 0.3.1 维护交接记录

日期：2026-08-24

## 修复背景

`v0.3.0` 发布后发现两项插件中心问题：

1. 每次搜索都会重新下载约 1.75 MB 的 curated registry，慢速网络下会长时间转圈。
2. DSH CLI 对 GitHub spec 的失败提示是通用提示，桌面端据此把已经包含构建成品、且没有生命周期脚本的仓库也误判为“需要运行第三方构建”。

失败实例是 `MeteorNOX/DeepSeek-Balance-Whale-Widget`。其 `package.json` 声明 `dsh.bundle.patch` 和 `main: lib/index.js`，仓库包含入口成品，没有 lifecycle scripts，因此可以在完成安全校验后安装。

## 0.3.1 实现

### 插件目录

- `src/plugin-manager.js` 增加内存和磁盘缓存，磁盘路径为 `~/.dsh/desktop-marketplace-cache/plugins.json`。
- 缓存有效期 6 小时；已有旧缓存时立即显示并在后台刷新。
- 每次搜索只过滤已加载 catalog，不再重复下载。
- 请求限制整体时间和最大响应体积。
- `src/main.js` 正式运行时使用 Electron `net.fetch`，以便跟随 Chromium / Windows 网络代理，并对 429、断线和超时做有限重试。

### GitHub 成品源码安装

- renderer 向 IPC 发送结构化条目：`source`、`installSpec`、`repositoryUrl` 和显示名称。
- 通过 GitHub API 将 HEAD 锁定为 40 位 commit SHA。
- 在该 commit 上读取并校验 `package.json`、bundle patch 和 main/module/exports 入口。
- 拒绝 `preinstall`、`install`、`postinstall`、`prepare` 和 `prepack`。
- 下载精确 commit 的 tar.gz，拒绝不安全路径、符号链接、超量文件和超大解压内容。
- 验证后的源码保存在 `~/.dsh/desktop-plugin-sources/<package>-<commit前12位>`，再以本地 `file:` spec 调用官方 `dsh plugin --profile web add --ignore-scripts`。
- 安装完成后检查依赖和 `dsh.profile.bundles`；未激活则恢复 profile 备份。

### 自带 pnpm

- `package.json` 锁定 `pnpm 11.21.0`。
- electron-builder 将 pnpm 放到 `resources/runtime/pnpm`，由包内 Node 启动。
- `scripts/verify-packaged-harness.js` 会检查最终安装包内 DSH、Node 和 pnpm 的实际版本。

## 验证命令

```powershell
npm test
npm run verify:harness
npm run verify:plugin-github
npm run dist:win
```

`verify:plugin-github` 只使用临时 DSH_HOME，不修改用户真实 `~/.dsh`。2026-08-24 实测得到：

- package：`dsh-whale-widget`
- version：`0.2.9`
- commit：`2b258781620edac2b94956bca98c9bfa78d0d62f`
- `activeBundle`：`true`

commit 和插件版本属于外部仓库动态数据，以以后重新运行验证命令的实际输出为准。

## 发布

- 版本为 `0.3.1`，不要删除已经发布的 `v0.3.0`。
- 发布前确认 `release/DeepSeek Harness Setup 0.3.1.exe` 生成，并在干净 Windows x64 环境覆盖安装测试。
- 不提交 `release/`、`node_modules/`、`runtime/node/node.exe`、`~/.dsh`、`.env.image.local` 或任何 API Key。
