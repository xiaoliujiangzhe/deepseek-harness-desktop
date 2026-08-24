# Changelog

本文件记录 DeepSeek Harness Desktop 的改动。版本号沿用 `package.json` 的 `version`。

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/)，按「新增 / 变更 / 修复 / 文档」分组。

## [0.4.0] — 2026-08-24

### 新增

- 内置浏览器升级为多标签工作台，支持新建、切换和关闭标签页，并保留隐藏标签的页面状态。
- 增加页面加载进度、错误状态、页内查找、50%–200% 缩放、系统浏览器打开和常用浏览器快捷键。
- 接管 Harness 的 HTML 文件引用：点击会话中的 `.html` / `.htm` 文件时，在右侧工作台启动本地预览，不再交给系统默认浏览器。
- 本地 HTML 预览支持同目录 JS、CSS、图片等相对资源，并在文件变化时自动刷新。

### 变更

- 浏览器标签继续使用隔离的 Electron `WebContentsView` 和独立持久会话；隐藏侧边工作台不再重复加载当前网页。
- 浏览器左边缘支持拖动调整宽度，查找栏展开时会同步调整网页视图，不遮挡页面内容。
- 前进和后退改用 Electron 35 的 `navigationHistory` 接口。

### 安全

- 本地预览服务仅监听 `127.0.0.1` 随机端口，只接受当前工作区内的 HTML，并将资源访问限制在已打开 HTML 所在目录。
- HTML 文件接管只处理 Harness 已解析出的绝对路径；其他文件类型继续沿用 Harness 原始行为。

### 验证

- Node.js 自动化测试 21 项通过。
- 已在 Windows 开发版中人工验证多标签、页面加载、面板布局和宽度调整。

## [0.3.1] — 2026-08-24

### 修复

- 插件目录增加 6 小时内存与磁盘缓存；已有缓存时立即本地搜索，过期缓存可继续使用并后台刷新。
- 桌面网络请求改用 Electron 网络栈，并增加整体超时、体积限制和临时网络错误重试，以更好地跟随 Windows 系统代理。
- 修复无 npm 发布、但仓库已包含构建成品的 GitHub 插件无法安装的问题。安装前锁定 40 位 commit SHA，校验 manifest、bundle patch、入口文件和生命周期脚本，再从持久本地源码缓存安装。
- 安装包新增锁定版本的便携 pnpm，最终用户不再需要自行安装 pnpm。

### 安全

- GitHub 插件若含 `preinstall`、`install`、`postinstall`、`prepare` 或 `prepack` 脚本，仍拒绝一键安装，并提示等待作者发布 npm 或 Release 成品包。
- GitHub 源码下载增加路径、符号链接、文件数量和解压体积校验；插件安装仍备份 web profile，失败时恢复。

### 验证

- 使用隔离临时 profile 实测安装 `MeteorNOX/DeepSeek-Balance-Whale-Widget`：锁定 commit、安装 `dsh-whale-widget 0.2.9` 并确认进入 bundle 列表。

## [0.3.0] — 2026-08-24

### 新增

- 新增 C · Builder's Notebook 启动页、官方鲸鱼图标和 `XLJZ / BUILD` 构建签名。
- 新增 C · 分屏工作台：右侧提供隔离内置浏览器，不再自动打开系统浏览器；插件中心位于设置窗口左侧独立的「插件中心」栏目，不改动原生「插件」页。
- 浏览器入口改为左侧边栏小图标，可点击或使用 `Ctrl+Alt+B` 显示/隐藏右侧面板，不遮挡 Session。
- 插件安装改用仓库声明的 npm 包名，避免自动放行 Git 源码的第三方构建脚本；新增卡片内安装进度、重试状态和中文错误提示。
- 聊天中的外部网页链接会显示为可点击链接，并直接在右侧内置浏览器打开。
- 新增 GitHub `dsh-plugin` Topic 搜索、bundle 声明过滤、安装/卸载、profile 备份和失败恢复。
- 新增安装包内便携 Node.js 运行时选择链，构建时固定 Node `v24.18.0`。

### 变更

- 插件安装默认关闭第三方安装脚本，安装后要求重启桌面端完成插件树验证。
- 浏览器只允许 HTTP/HTTPS，独立会话分区，默认拒绝权限请求。

### 文档

- 新增 `docs/release-0.3.0.md`、工具界面设计规格和方向选择记录。

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
