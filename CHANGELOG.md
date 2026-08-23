# Changelog

本文件记录 DeepSeek Harness Desktop 的改动。版本号沿用 `package.json` 的 `version`。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，按「新增 / 变更 / 修复 / 文档」分组。

## [0.2.1] — 2026-08-23

### 修复

- 修复 electron-builder 没有将 Harness 自动安装的 peer dependencies 带入安装包，导致安装版以 `ERR_MODULE_NOT_FOUND` 退出的问题。
- 将当前 Harness 运行时需要的 peer packages 明确列为桌面应用生产依赖，避免被 electron-builder 依赖裁剪。

### 新增

- 新增构建后验收：`npm run dist:win` 完成后直接运行 `release/win-unpacked` 内的 DSH CLI；若缺包或 Harness 版本不一致，构建流程失败，禁止发布。

### 发布说明

- `v0.2.0` 的源码开发模式可运行，但已发布的 Windows 安装包缺少运行时依赖，不应继续分发。

## [0.2.0] — 2026-08-23

### 新增

- Harness 固定升级到 `0.1.1-rc.2`，使用官方原生 `deepseek-v4-flash-vision-exp` 多模态链路。
- 新增 rc.6 到 rc.2 的可恢复迁移：只改名备份生成型插件目录，不动会话、附件、设置、凭据和用户 Cordis 补丁。
- 新增 Node.js 单元测试，覆盖版本比较、迁移与用户数据保留。

### 变更

- 发布版和开发版默认都使用根目录锁定的官方 npm Harness；vendored CLI 仅在 `DSH_DESKTOP_USE_VENDOR=1` 时用于维护调试。
- 「Harness 更新」显示实际选中的 CLI 版本，不再用未打包的 vendor 版本误报当前版本。
- 历史识图兜底补丁退役，不再进入桌面版运行链路。
- 禁用 electron-builder 的原生模块重建；DSH 的 `node-pty` 等模块由系统 Node 运行，不加载进 Electron ABI。

## [0.1.0] — 初始版本

### 新增

- Electron 桌面壳：自动启动本地 `dsh web` 服务（`--port 0` 自动选空闲端口）、带读条特效的启动页、系统托盘（关窗不退出、服务常驻）、单实例。
- **外观自定义（桌面外观）**：集成进「设置 → 通用设置」，支持上传背景图、背景模糊/变暗、界面透明度、字体字号、布局密度、强调色、自定义 CSS，实时生效。
- 系统托盘菜单：显示 / 打开工作目录 / 开发者工具 / 退出。

### 修复

- 启动脚本 `install.cmd` / `.vbs` 因中文编码在 Windows 下闪退（改 ASCII + CRLF）。
- 桌面快捷方式图标空白（PNG → 多尺寸 ICO）。
- 窗口标题被网页改写成「<会话> — DeepSeek Harness」（锁定标题）。
- 背景图不显示 / 文字看不清（目标改到 `body`、避免 `background` 简写重置、分层透明度保证面板文字清晰）。
- 外观设置区块偶发不出现（observer 时机 + 轮询兜底）。
