# DeepSeek Harness Desktop

DeepSeek Harness 的桌面版外壳。它封装官方 npm 包中的 `dsh web` CLI，发布版固定携带一个经过验证的 Harness 版本，避免 CLI 和 Web 插件混用不同版本。每次打开应用时会**自动启动本地 `dsh web` 服务**，用带**读条特效的启动画面**等待服务就绪，然后在原生窗口里打开浏览器界面。关闭窗口会**最小化到系统托盘**、服务继续常驻，从托盘菜单「退出」时才真正停掉服务。

## 工作原理

```
启动 App
  └─ 启动画面（读条特效）
       ├─ 定位系统 Node 运行时（不用 Electron 内置 Node，避免 node-pty/sharp 等原生模块 ABI 不匹配）
       ├─ 解析安装包内的官方 @deepseek-ai/dsh CLI
       ├─ 版本升级时备份旧的生成型插件目录（不动会话、附件、设置和凭据）
       └─ spawn: node <bin.js> web --port 0   （--port 0 让 OS 自动选空闲端口，永不冲突）
            ├─ 捕获 stdout 的 `dsh web: http://127.0.0.1:<port>` 就绪行
            ├─ HTTP 探测确认可访问
            └─ 就绪 → 主窗口 loadURL(就绪地址)，关闭启动画面
```

关键点：

- **自动启动 / 自动停止**：App 启动时拉起 `dsh web`，从托盘「退出」时用 `taskkill /T /F` 清理整棵进程树。
- **`--port 0`**：让系统分配空闲端口，避免与已运行的 `dsh web`（例如默认的 3080）冲突；实际端口从就绪行解析。
- **共享数据**：不覆盖 `DSH_HOME`，会话/配置与命令行版本共用 `~/.dsh`。
- **读条特效**：启动画面用真实阶段驱动进度（解析环境 → 启动服务 → 端口绑定 → HTTP 探测 → 就绪），百分比做缓动动画、渐变进度条带流光扫过特效。
- **系统托盘**：关窗不退出，缩到托盘、服务常驻；单击托盘图标切换显示/隐藏，右键菜单可「显示 / 打开工作目录 / 退出」。单实例：重复双击快捷方式只唤起已有窗口。
- **主界面皮肤（外观自定义）**：集成进 Harness 网页自己的「设置 → 通用设置」里，新增一个「桌面外观」区块，可**上传图片当背景**、调背景模糊/变暗、改字体字号、布局密度、强调色，并支持**自定义 CSS**，保存后实时生效。深浅色模式在 Harness 设置里切换。
- **DeepSeek 原生多模态**：Harness `0.1.1-rc.2` 内置 `deepseek-v4-flash-vision-exp`，可直接向 DeepSeek 官方路由发送图片，不再依赖桌面项目的识图兜底补丁。
- **可恢复升级**：检测到旧 Harness 插件目录时先改名备份，再由新 CLI 重建；`sessions`、`attachments`、`settings.yaml`、`.credentials.yaml` 和 `cordis.patch.yml` 不参与迁移。
- **检查更新（Harness 更新）**：「设置 → 通用设置」里的「Harness 更新」区块显示桌面版实际启动的版本。应用只检查和提醒，由维护者更新锁定依赖并发布新安装包。

## 目录结构

```
src/
  main.js        Electron 主进程（窗口、生命周期、单实例、IPC）
  server.js      服务管理器（定位 Node、spawn dsh web、就绪探测）
  preload.js     启动画面 IPC 桥
  loading.html   启动画面
  loading.css    读条特效样式
  loading.js     进度动画 + 错误处理
scripts/
  gen-icon.js    无依赖生成 assets/icon.png
test/             桌面升级迁移等 Node.js 单元测试
vendor/           仅供维护者对照官方源码（不进入安装包）
vendor-patches/   已退役的历史识图补丁存档
```

## 环境要求

- Node.js ≥ 18（本机已验证 v24）
- npm（默认走 `registry.npmmirror.com`，见 `.npmrc`）

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

官方仓库（`deepseek-ai/deepseek-harness`）以 `master` 分支为最新，不发布 GitHub Release。桌面版在「设置 → 通用设置」里提供「Harness 更新」区块，只做**版本检查与提醒**，不在应用内自动升级。

- **检查更新**：比对桌面版实际启动的 npm Harness 版本与官方 `master` 分支的 `package.json` 版本。
- **升级方式**：维护者在 `package.json` 和锁文件中固定新版本，通过测试后发布新桌面安装包。客户端不在用户机器上临时重建 Harness。

> 追新频率建议按需：不必官方每次提交都升，通常每几个版本、或有你确实需要的新功能/bugfix 时再升一次。

## 参考

GitHub 上已有若干社区 Electron 桌面壳，本实现是独立的最小可用版本：

- [foolgry/dsh-desktop](https://github.com/foolgry/dsh-desktop) — Electron shell + embedded Node
- [kevenxz/dsh-desktop](https://github.com/kevenxz/dsh-desktop) — Windows 客户端（窗口 + 托盘 + 共享 profile/会话）
- [cc1252/deepseek-harness-desktop](https://github.com/cc1252/deepseek-harness-desktop) — Windows Electron 封装
- [ChisaAlter/Deepseek-Harness-Desktop](https://github.com/ChisaAlter/Deepseek-Harness-Desktop) — 主题/背景个性化

官方 CLI 与仓库：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)、`@deepseek-ai/dsh`（`dsh web` 启动浏览器 UI）。
