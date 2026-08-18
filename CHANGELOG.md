# Changelog

本文件记录 DeepSeek Harness Desktop 的改动。版本号沿用 `package.json` 的 `version`（当前 `0.1.0`），尚未打正式 tag/Release。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，按「新增 / 变更 / 修复 / 文档」分组。

## [Unreleased]

### 新增

- **识图模型兜底（走正路 · vendored 源码定制）**：主模型是纯文本（如 DeepSeek-V4）时，发图片会先用一个「识图模型」把图片描述成文字，再把描述交给主模型。涉及识图兜底插件、agent-loop 重写挂钩、base bundle 挂载、apiproxy 入口放行与暴露白名单。
- **设置界面「识图模型」下拉框**：在「设置 → 模型」直接选择识图模型，无需手改 `settings.yaml`。
- **模型编辑「图片输入」开关 + 识图下拉框只列支持图片的模型**：`llm.models` 接口随模型返回 `inputModalities`；给模型勾「图片输入」后它才会出现在识图下拉框里。
- **Electron 壳优先使用 vendored 构建的 CLI**：`vendor/deepseek-harness/apps/cli/lib/bin.js` 存在时用它（含识图兜底等定制），否则回退 npm `@deepseek-ai/dsh`。

### 变更

- **「Harness 更新」从「一键更新」改为「检查 + 提醒」**：设置里的区块只检查官方 `master` 分支版本并提示「官方最新 vX（当前 vY）」，不再在应用内自动下载/重放补丁/重建。升级改为重打补丁后手动跑 `setup-harness.cmd`（维护者任务），避免在用户机器上因补丁冲突或目录占用而失败。

### 修复

- 修复 `vision/describe` 事件未进 `known-event-types` 导致重启后重开会话报 `SessionFormatUnsupportedError`（构建前补 `gen-persistence-catalog`）。
- 修复识图下拉框在模型能力变更后不刷新（把 namespace 视图纳入 effect 依赖）。
- 修复发图入口在纯文本主模型时被直接拒绝、走不到识图兜底（配置了识图兜底时放行）。
- 修复 apiproxy 设置暴露白名单漏掉 `vision-fallback`，导致下拉框永远不显示。
- 修复 `vision-fallback` 的 `purpose: 'vision-describe'` 类型不兼容（当前 master 的 purpose 联合类型更窄）。
- 修复 `llm-vision-fallback` 未注册进 `tsconfig.host.json` references（tsc 不编译 / tsdown 报 UNRESOLVED_ENTRY）。
- 修复 `llm-vision-fallback` 缺 `maxOutputTokens`/`timeoutMs` 必填配置导致 boot 失败。

### 文档

- README 更新：vendored 源码构建方式、识图模型兜底使用说明、Harness 更新说明。
- 新增 `vendor-patches/`（对 vendored 源码的改动存档）与 `vendor-patches/manifest.json`（补丁清单）。

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
