# v0.4.0 功能路线（已落地）

本文记录已确认并落地的功能边界。当前开发版本为 `0.4.0`；安装包是否可发布仍以 `npm run dist:win` 完成并通过打包后验收为准。

## 1. DSH 插件仓库（已落地）

目标：在桌面端提供插件发现、详情、安装、启用/禁用和卸载入口。

当前可确认的发现来源是 GitHub 的 [`dsh-plugin` Topic](https://github.com/topics/dsh-plugin)。官方 Harness README 建议插件作者给仓库添加该 Topic，但目前没有确认存在由 DeepSeek 官方维护的统一插件注册表或插件市场。

当前实现支持经过固定清单验证的插件，不把 Topic 下的任意仓库直接当作可安全安装的插件。会校验：

- 插件名称、版本和入口
- 支持的 Harness 版本（当前桌面版为 `0.1.1-rc.2`）
- 来源仓库和发布版本
- 所需权限和额外依赖
- 安装脚本及可疑的 `postinstall` 行为

安装目标沿用官方 DSH `web` profile 目录：

```text
%USERPROFILE%\.dsh\plugins\
```

安装和卸载必须先备份 profile，安装后验证插件树能够启动；失败时自动回滚。不能覆盖桌面应用本身的 `node_modules`，也不能把 API Key 写入插件日志。

## 2. 桌面端内置浏览器（v0.4.0 工作台已落地）

目标：用户可以在 DeepSeek Harness 桌面窗口中直接打开网页，不自动跳转到系统默认浏览器。

当前交互：

- DSH 对话仍保留为主视图
- 使用可拖动宽度的右侧面板和多标签栏
- 提供地址栏、后退、前进、刷新、查找、缩放和外部打开
- 浏览器页面在独立的 Electron `WebContentsView` 中加载
- 浏览器页面不注入 DSH 的 preload，不获得 Node.js 或桌面 IPC 权限
- 点击会话中的 HTML 文件引用时，在本机临时服务中预览并支持保存后自动刷新

实现时只允许 `http`/`https` 页面，拦截 `file:`、自定义协议和未授权的窗口打开；下载、剪贴板、摄像头、麦克风等权限需要单独处理。浏览器是否持久化 Cookie/登录状态需要作为明确的设置，不能默认复用 DSH 的会话数据。

“能显示网页”与“让 DSH 智能体代替用户点击网页”是两个范围：前者是本轮内置浏览器功能，后者还需要截图、DOM、点击、输入和权限确认的工具桥接，不能默认一起实现。

## 3. 内置便携 Node.js（选择链已落地，干净机验证待做）

目标：让没有预装 Node.js 的 Windows x64 电脑也能直接安装并运行桌面版，同时不影响用户已有的 Node、npm 或版本管理工具。

推荐目录：

```text
DeepSeek Harness\
└─ resources\
   └─ runtime\
      └─ node\
         └─ node.exe
```

桌面端使用绝对路径启动内置 `node.exe`，不得修改系统或用户环境变量，不得覆盖系统 Node，不得修改 `NVM_HOME`，也不得注册全局 npm。用户在 PowerShell 中执行 `node --version` 时仍应得到原有系统 Node 版本。

建议运行时优先顺序：

1. `DSH_DESKTOP_NODE`：仅供维护者或高级用户显式覆盖。
2. 安装包携带并经过发布测试的便携 Node.js。
3. 系统 Node.js：仅作为兼容回退。
4. Electron 内置 Node：最后回退；原生模块可能存在 ABI 不兼容，不能作为正式保证。

需要同步完成：

- 固定并记录内置 Node 的具体版本、来源和校验值
- 确认 `node-pty`、`sharp` 等原生依赖与该 Node ABI 匹配
- 插件子进程如需 Node，只为该子进程注入临时 `PATH`，不修改系统 `PATH`
- 增加打包后运行时检查，确认安装包内的 Node 能启动 DSH CLI
- 在没有安装系统 Node 的干净 Windows x64 环境测试安装、文字会话、图片输入和终端工具
- 建立内置 Node 安全更新流程

## 4. 设计约束

- 插件中心和浏览器必须在最终安装版中测试；每次发布记录最终安装包路径和 SHA256。
- 每次涉及主进程或打包依赖的改动，都要运行 `npm test`、`npm run verify:harness` 和 `npm run dist:win`。
- 插件安装失败不能让主 DSH 服务进入不可启动状态。
- 浏览器和插件功能都不应读取、上传或暴露用户的 `.credentials.yaml`、API Key、会话和附件。
- 内置 Node 不能改变用户系统上的 Node、npm、NVM 或环境变量配置。
