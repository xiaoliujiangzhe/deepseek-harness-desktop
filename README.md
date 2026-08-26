# DeepSeek Harness Desktop

DeepSeek Harness 的桌面版外壳。它封装官方 npm 包中的 `dsh web` CLI，发布版固定携带一个经过验证的 Harness 版本，避免 CLI 和 Web 插件混用不同版本。每次打开应用时会**自动启动本地 `dsh web` 服务**，用 C 版工程启动页等待服务就绪，然后在原生窗口里打开 Harness 界面。关闭窗口会**最小化到系统托盘**、服务继续常驻，从托盘菜单「退出」时才真正停掉服务。

## 工作原理

```
启动 App
  └─ 启动画面（读条特效）
       ├─ 定位内置便携 Node（无内置时回退系统 Node，最后才使用 Electron Node）
       ├─ 解析安装包内的官方 @deepseek-ai/dsh CLI
       ├─ 版本升级时备份旧的生成型插件目录（不动会话、附件、设置和凭据）
       └─ spawn: node <bin.js> web --port 0   （--port 0 让 OS 自动选空闲端口，永不冲突）
            ├─ 捕获 stdout 的 `dsh web: http://127.0.0.1:<port>` 就绪行
            ├─ HTTP 探测确认可访问
            └─ 就绪 → 主窗口 loadURL(就绪地址)，关闭启动画面
```

关键点：

- **自动启动 / 自动停止**：App 启动时拉起 `dsh web`，从托盘「退出」时用 `taskkill /T /F` 清理整棵进程树。
- **通用对话**：侧栏提供独立入口，无需先选择项目。入口可展开全部非空历史、切换聊天或明确新建；每条历史提供重命名、分叉和归档菜单，返回入口时恢复上次会话。独立“已归档”中心可以跨工作区查看、恢复或删除归档会话；高风险删除带二次确认并先生成维护备份。顶部“新会话”在当前已是空白通用对话时会给出反馈，不再制造重复空白记录。桌面端在自身用户数据目录维护一个隔离工作区以兼容 Harness 的 Workspace/Session 机制，需要现有项目文件时再切换到真实工作区。
- **`--port 0`**：让系统分配空闲端口，避免与已运行的 `dsh web`（例如默认的 3080）冲突；实际端口从就绪行解析。
- **共享数据**：不覆盖 `DSH_HOME`，会话/配置与命令行版本共用 `~/.dsh`。
- **读条特效**：启动画面用真实阶段驱动进度（解析环境 → 启动服务 → 端口绑定 → HTTP 探测 → 就绪），百分比做缓动动画、渐变进度条带流光扫过特效。
- **系统托盘**：关窗不退出，缩到托盘、服务常驻；单击托盘图标切换显示/隐藏，右键菜单可「显示 / 打开工作目录 / 退出」。单实例：重复双击快捷方式只唤起已有窗口。
- **C 版分屏工作台**：保留 DSH 对话为主视图，右侧使用隔离的 Electron `WebContentsView` 提供多标签浏览器。新标签进入桌面端主页，地址栏可输入网址或直接搜索；支持书签、最近访问、拖动宽度、标签恢复、前进/后退、刷新、页内查找、缩放、下载中心和外部打开，聊天中的外部网页链接会直接在右侧打开。
- **网页进入聊天**：可把网页选中文字附带标题与 URL 引用到当前草稿，也可把当前可见网页截图作为图片加入草稿；图片继续走 Harness 原生附件限制和发送流程，不会自动发送。
- **本地 HTML 预览**：点击会话中的 `.html` / `.htm` 文件引用，会在右侧工作台启动仅监听本机的临时预览服务。JS、CSS、图片等相对资源可正常加载，保存文件后页面自动刷新。
- **内置文件编辑器**：点击会话中的常见文本或代码文件，会在右侧工作台直接打开，不再默认跳到记事本或 IDE。支持多文件标签、行号、查找、自动换行、`Ctrl+S` 保存、磁盘重载和外部编辑器备用入口；也可从工具栏主动选择当前工作区内的文件。保存使用内容版本校验和同目录原子替换，外部修改冲突时不会静默覆盖。
- **插件中心**：位于主界面工具栏的独立侧边工作台，不改动 Harness 原生「插件」页；使用 dsh-market 同源的 `awesome-dsh-plugin` curated 目录。目录缓存 6 小时，后续搜索直接在本地过滤。支持安装、更新、启用、停用和卸载；GitHub 来源会先锁定 commit，并校验 package manifest、bundle patch、成品入口和生命周期脚本。修改前备份 web profile，失败自动恢复。
- **诊断与修复中心**：从主界面工具栏独立打开，检查桌面运行时、Harness profile、代理和公共网络端点；可备份运行配置、安全修复凭据 version、清理插件目录缓存，并导出不包含 API Key 的脱敏报告。
- **主界面皮肤（外观自定义）**：集成进 Harness 网页自己的「设置 → 通用设置」里，新增一个「桌面外观」区块，可**上传图片当背景**、调背景模糊/变暗、改字体字号、布局密度、强调色，并支持**自定义 CSS**，保存后实时生效。深浅色模式在 Harness 设置里切换。
- **DeepSeek 原生多模态**：Harness `0.1.1-rc.2` 内置 `deepseek-v4-flash-vision-exp`，可直接向 DeepSeek 官方路由发送图片，不再依赖桌面项目的识图兜底补丁。
- **可恢复升级**：检测到旧 Harness 插件目录时先改名备份，再由新 CLI 重建；`sessions`、`attachments`、`settings.yaml`、`.credentials.yaml` 和 `cordis.patch.yml` 不参与迁移。
- **桌面更新中心**：从主界面工具栏打开，显示桌面版本、Harness、便携 Node.js 和 pnpm；支持 Stable / Preview 通道、自动/手动检查、用户确认下载、下载进度、跳过版本和重启安装。开发预览版只显示状态，正式安装包通过 GitHub Releases 更新。

## 目录结构

```
src/
  main.js        Electron 主进程（窗口、生命周期、单实例、IPC）
  general-chat.js  通用对话的私有工作区初始化与默认边界说明
  server.js      服务管理器（定位 Node、spawn dsh web、就绪探测）
  embedded-browser.js  隔离多标签浏览器视图（导航、查找、缩放、权限策略）
  diagnostics.js   运行环境检查、配置备份、安全修复与报告脱敏
  local-preview-server.js  本地 HTML 预览、资源限制与自动刷新
  text-file-editor.js  工作区文本文件校验、编码识别、冲突检测与原子保存
  plugin-manager.js    GitHub 插件索引与官方 DSH plugin 命令适配
  preload.js     启动画面 IPC 桥
  loading.html   启动画面
  loading.css    读条特效样式
  loading.js     进度动画 + 错误处理
scripts/
  render-brand-assets.js  从官方鲸鱼 SVG 生成 PNG / ICO / 托盘图标
  stage-portable-node.js  构建时固定并校验便携 Node 运行时
test/             桌面升级迁移等 Node.js 单元测试
vendor/           仅供维护者对照官方源码（不进入安装包）
vendor-patches/   已退役的历史识图补丁存档
```

## 环境要求

- Node.js ≥ 18（构建机当前固定使用 v24.18.0；安装包运行不要求用户预装 Node）
- npm（默认走 `registry.npmmirror.com`，见 `.npmrc`）
- 安装包已携带 Node.js 和 pnpm；最终用户无需预装 Node、npm 或 pnpm

## 安装与运行

**双击启动（推荐，无需命令行）**：

- 双击项目里的 **`启动 DeepSeek Harness.vbs`**（静默启动，不弹黑窗口），
  或双击 **`DeepSeek Harness.lnk`** 快捷方式（带图标，可直接拖到桌面）。
- 首次使用若提示缺少运行时，双击 **`install.cmd`** 完成一次性安装（约数分钟）。

**命令行方式**：

```powershell
npm install        # 安装 @deepseek-ai/dsh + electron（含 Electron 二进制）
npm test           # 验证桌面版迁移逻辑
npm start          # 启动桌面版
npm run runtime:node # 将构建机 Node v24.18.0 暂存为安装包运行时
```

> 沙箱/受限环境下若 npm 缓存目录不可写，可把缓存重定向到项目内：
> `npm install --cache ./.npm-cache`，并设置 `$env:ELECTRON_CACHE = ".\.electron-cache"`。

## 常见问题

- **`npm install` 在下载 Electron 二进制时失败（连接被重置）**：`.npmrc` 默认走 npmmirror 镜像；若该镜像在你的网络下不可用，删除 `.npmrc` 改用官方源，或手动指定：`$env:ELECTRON_MIRROR = "https://github.com/electron/electron/releases/download/"` 后再 `npm install`。
- **`npm start` 报找不到 electron / dsh**：多半是 `npm install` 未完整执行（例如带了 `--ignore-scripts`）。删除 `node_modules` 与 `package-lock.json` 后重新 `npm install`。
- **启动画面一直卡住或报「服务在就绪前退出」**：通常是系统 Node 未在 PATH 上，或 `~/.dsh` 目录权限异常。可设置 `DSH_DESKTOP_NODE` 指向 Node 可执行文件后重试。
- **想固定端口**：把 `settings.json` 里的 `port` 从 `0` 改为具体端口号。

## 打包成安装包

```powershell
npm run dist:win   # electron-builder → release/ 下的 NSIS 安装包
```

`dist:win` 会在打包前运行 Harness 校验、便携 Node 暂存和官方鲸鱼图标生成。`runtime/node/node.exe` 被 `.gitignore` 忽略，不应提交到 GitHub；安装包会把它放进 `resources/runtime/node/node.exe`，并将锁定的 pnpm 放进 `resources/runtime/pnpm`。构建后的自动验收会分别启动 DSH、Node 和 pnpm；发布前仍应在干净 Windows x64 环境再验证一次。

## 配置

首次运行会在 `%APPDATA%/deepseek-harness-desktop/settings.json`（Electron `userData` 目录）生成：

```json
{
  "workspace": "C:\\Users\\<你>",   // dsh 启动时的工作目录（默认工作区根）
  "port": 0                         // 0 = 自动分配空闲端口；也可写死端口号
}
```

可用环境变量：

- `DSH_DESKTOP_NODE`：指定 Node 可执行文件绝对路径（覆盖自动探测）。
- `DSH_TELEMETRY_DISABLED`：透传给 dsh，禁用遥测。

## DeepSeek 多模态

Harness `0.1.1-rc.2` 的 `deepseek-official` 提供方已内置 `deepseek-v4-flash-vision-exp`，并把它声明为 `text + image` 输入。在「设置 → 模型」选择该模型后可直接发送图片。

API Key 默认从凭据引用 `DEEPSEEK_API_KEY` 解析。模型的实时可用性、价格、图片限制和账户权限以 [DeepSeek 官方视觉文档](https://api-docs.deepseek.com/zh-cn/guides/vision/) 为准。

## Harness 更新

官方仓库（`deepseek-ai/deepseek-harness`）以 `master` 分支为最新，不发布 GitHub Release。桌面版更新中心提供两类检查：桌面应用从 GitHub Releases 下载已验证安装包；Harness 上游检查只提供维护提示，不在用户机器上自动重建 Harness。

- **桌面版升级**：维护者发布新的 GitHub Release，应用检查 `latest.yml`，用户确认后下载并重启安装。
- **Harness 上游检查**：比对桌面版实际启动的 npm Harness 版本与官方 `master` 分支的 `package.json` 版本；维护者还需检查 commit 变化，再在 `package.json` 和锁文件中固定新版本。
- **升级方式**：通过测试后重新构建桌面安装包。客户端不在用户机器上临时重建 Harness。

> 追新频率建议按需：不必官方每次提交都升，通常每几个版本、或有你确实需要的新功能/bugfix 时再升一次。

## 参考

GitHub 上已有若干社区 Electron 桌面壳，本实现是独立的最小可用版本：

- [foolgry/dsh-desktop](https://github.com/foolgry/dsh-desktop) — Electron shell + embedded Node
- [kevenxz/dsh-desktop](https://github.com/kevenxz/dsh-desktop) — Windows 客户端（窗口 + 托盘 + 共享 profile/会话）
- [cc1252/deepseek-harness-desktop](https://github.com/cc1252/deepseek-harness-desktop) — Windows Electron 封装
- [ChisaAlter/Deepseek-Harness-Desktop](https://github.com/ChisaAlter/Deepseek-Harness-Desktop) — 主题/背景个性化

官方 CLI 与仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)、`@deepseek-ai/dsh`（`dsh web` 启动浏览器 UI）。
