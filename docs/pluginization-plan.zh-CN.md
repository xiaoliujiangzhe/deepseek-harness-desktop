# DSH Desktop 功能插件化方案

状态：产品与技术方案已记录，尚未开始拆分
记录日期：2026-08-26

## 结论

桌面端新增能力适合逐步插件化，但不能把所有功能都做成普通 DSH Bundle。推荐采用两层结构：Electron 保留操作系统能力和安全边界，具体产品功能尽量由 DSH 插件提供界面与业务逻辑，并通过受限的 Desktop Bridge 请求桌面能力。

```text
DSH Desktop Core
├─ Electron 窗口、托盘、更新、便携 Node / pnpm
├─ WebContentsView、本机文件、进程管理和安全 IPC
└─ Desktop Bridge（稳定、最小化、显式授权）
                     ↓
DSH Feature Plugins
├─ general-chat
├─ archive-center
├─ appearance
├─ desktop-browser
├─ workbench
├─ marketplace
└─ desktop-maintenance
```

完整版安装包应离线携带一组已经验证的官方内置插件。用户首次启动不依赖 GitHub、npm 或代理；插件中心仍可安装、停用、更新和卸载额外插件。

## 功能边界

### 可基本作为纯 DSH Bundle

- 通用对话：入口、历史列表、会话切换、重命名、分叉和归档尽量使用 Harness 已有 RPC。
- 外观：主题、背景、字号和界面增强在官方可扩展区域内实现。
- 面向 DSH 的轻量 UI 增强：不依赖本机文件、窗口或进程权限的功能。

### 适合“DSH 插件 UI + Desktop Bridge”

- 归档中心：列表 UI 可插件化；当前 Harness 没有恢复与永久删除 RPC，操作必须请求桌面桥接。
- 内置浏览器：插件负责入口、状态和交互；Electron 负责 `WebContentsView`、下载、权限与导航拦截。
- 文件/IDE 工作台：插件负责文件树、编辑器和 Diff UI；Electron 负责受限文件访问、PTY、搜索和进程生命周期。
- 插件中心：插件负责目录、搜索、版本和操作反馈；Electron 负责下载、校验、安装目录与重启。
- 诊断修复：插件负责检查结果和操作流程；Electron 负责读取环境、备份配置和受控修复。
- 桌面更新：插件负责通道、进度和提示；Electron 负责下载校验、安装器与重启。
- 本地预览与下载中心：插件负责工作台 UI；Electron 负责本地协议、下载任务及系统文件操作。

### 必须留在 Electron 核心

- 主窗口、托盘、单实例、开机与退出生命周期。
- 启动/停止 Harness、便携 Node 与 pnpm、端口发现和崩溃恢复。
- `WebContentsView` 隔离、导航策略、权限请求、下载和外部链接安全策略。
- 自动更新安装器、签名验证以及所有可接触任意本机文件或进程的底层 IPC。

以上分类是基于当前仓库实现得出的边界，不代表官方 DSH 对未来插件 API 的承诺。升级 Harness 后需要重新核实。

## 建议的插件仓库

当前 `src/plugin-manager.js` 的 GitHub 安装流程要求仓库根目录存在 `package.json`、`dsh.bundle.patch` 和可直接加载的成品入口。因此现阶段最兼容的组织方式是一插件一仓库：

- `dsh-xljz-general-chat`
- `dsh-xljz-archive-center`
- `dsh-xljz-appearance`
- `dsh-xljz-desktop-browser`
- `dsh-xljz-workbench`
- `dsh-xljz-marketplace`
- `dsh-xljz-desktop-maintenance`
- `dsh-xljz-desktop-suite`：只声明并聚合完整版默认插件，不复制各插件源码。

以后若插件管理器正式支持 monorepo 子目录，再考虑合并仓库。当前不要先假定这一能力存在。

## Desktop Bridge 设计约束

- Bridge 使用少量、带版本号的能力接口，例如 `desktopBridge.v1.archives.restore()`，不能暴露通用 `fs`、`shell` 或任意 IPC 调用。
- 每项请求都要验证调用来源、参数 schema、当前 Workspace 和真实路径边界。
- 高风险操作必须在主进程展示原生确认；网页或插件不能自行绕过。
- 写配置、恢复归档、删除会话前保留维护备份，并向用户明确备份位置和恢复边界。
- 内置浏览器加载的远程页面永远不能获得 Bridge；只有受信任的 DSH 应用页面和已批准插件可以请求能力。
- 插件清单应声明所需能力。安装与首次启用时显示权限，升级增加权限时重新确认。
- Bridge API 保持向后兼容；废弃能力至少跨一个桌面端版本保留明确错误和迁移说明。

## 完整版内置与第三方分发

- 发布构建固定内置插件版本，并将成品放进安装包；不在安装时从远程仓库临时拉取。
- 内置清单记录插件名、版本、源码仓库、提交哈希、权限和兼容的 Desktop Bridge/Harness 版本。
- 内置插件默认启用，但除维持启动与安全所必需的核心插件外，应允许用户停用。
- 第三方插件进入插件中心前至少校验 manifest、入口文件、来源地址和兼容范围；“出现在搜索结果”不能等同于“经过安全审核”。
- 安装或更新失败要保留旧版本并给出可复制的错误信息，不能留下半安装目录。

## 兼容性清单

每个插件发布时至少声明并验证：

- 插件自身版本和仓库提交。
- 最低/最高 DSH Desktop 版本。
- 最低/最高 Harness 版本；当前桌面端随包版本为 `0.1.1-rc.2`。
- Desktop Bridge API 版本及所需权限。
- Windows 架构和是否依赖便携 Node、pnpm、Git 或其他外部程序。
- 升级、降级、停用、卸载和离线首次启动结果。

## 推荐迁移顺序

1. 先定义 `Desktop Bridge v1`、权限清单和内置插件 manifest，不立即移动现有功能。
2. 抽离纯 UI/低权限的外观插件，验证插件装载、停用、升级和回滚流程。
3. 抽离通用对话；归档查看沿用 Harness RPC，恢复/删除通过 Bridge。
4. 抽离插件中心和诊断中心，补齐安装事务、错误反馈、代理和缓存策略。
5. 抽离浏览器与工作台 UI，保留 `WebContentsView`、文件和进程能力在 Electron 核心。
6. 建立 `desktop-suite` 和发布兼容矩阵，之后完整版按锁定清单内置插件。

迁移期间应保持现有内置实现可回退。只有新插件在正常用户数据和隔离用户数据中都通过安装、升级、停用、卸载、离线启动和桌面端升级测试后，才删除旧实现。

## 本轮归档功能的插件化判断

- 归档列表、筛选、空状态、恢复/删除按钮和结果提示可以迁入 `dsh-xljz-archive-center`。
- `session.list`、`workspace.list` 和归档 RPC 优先通过 Harness 官方能力调用。
- 当前随包 Harness `0.1.1-rc.2` 没有 unarchive/session delete RPC；恢复和删除仍必须由 Electron 停止 Harness 后，经 Desktop Bridge 受控修改持久层并自动重启。
- 如果未来官方提供恢复/删除 RPC，应优先迁移回官方 RPC，并删除对应的持久层写入桥接。

## 已核实依据

本方案基于仓库内以下文件核实：

- `node_modules/@deepseek-ai/dsh/README.zh.md`
- `node_modules/@deepseek-ai/dsh/config/agent-presets/cordis/skills/cordis-plugin-development/SKILL.md`
- `node_modules/@deepseek-ai/dsh-client-ui-workspace/README.md`
- `src/plugin-manager.js`

这些依据对应当前锁定依赖。官方包后续更新可能改变 API，发布前必须重新检查，不能把本文当作永久不变的官方规范。
