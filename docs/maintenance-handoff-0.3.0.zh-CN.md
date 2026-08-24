# DSH Desktop 0.3.0 维护交接记录

> 给 DSH / Codex 后续维护者：本文记录本轮桌面端改动、验证方式和未完成事项。
> 不要把本机凭据、`~/.dsh` 用户数据或安装包构建产物提交到 GitHub。

## 当前目标

本轮目标是把桌面端升级为更完整的本地工作台，并为启动页加入原创鲸鱼娘形象。项目目录为：

```text
C:\Users\XLJZ\Projects\dsh
```

当前 `package.json` 桌面版本为 `0.3.0`，Harness 校验版本仍以 `npm run verify:harness` 的实际输出为准。

## 已完成的桌面功能

### 启动页

- 保留 C · Builder's Notebook 工业网格视觉方向、六阶段进度、错误详情、工作目录选择、重试按钮和 `XLJZ / BUILD` 签名。
- 使用原创 Q 版蓝白鲸鱼娘立绘：抱着饭碗、拿勺子偷吃白饭，饭碗中有发光颗粒。
- 已从纯品红背景中抠除背景，透明素材为：
  - `assets/whale-girl-token-rice.png`（启动页使用）
  - `assets/whale-girl-token-rice-source.png`（保留的原始生成图）
- 启动动画包括角色轻微浮动和发光颗粒落入饭碗；`prefers-reduced-motion` 时会关闭动画。
- 当前启动文案是：`鲸鱼娘正在偷吃你的白饭`。不要擅自改回 Token 文案，除非用户再次提出。

相关代码：`src/loading.html`、`src/loading.css`、`src/loading.js`。

### 内置浏览器

- 右侧隔离的 Electron `WebContentsView`，聊天仍为主视图。
- 只允许 HTTP/HTTPS；使用独立持久分区，不加载 DSH preload。
- 支持聊天外链在右侧打开、前进/后退、刷新、关闭、加载状态和错误提示。
- 支持拖拽调整宽度、最大化/恢复浏览器面板；不再因为浏览器面板遮挡 Session 按钮而改变主布局。

相关代码：`src/embedded-browser.js`、`src/main.js`、`src/preload-main.js`。

### 插件中心

- 插件中心作为独立侧边工作台，不修改 Harness 原生插件页，也不把外观设置混进插件中心。
- 读取 `awesome-dsh-plugin` curated registry，支持名称、分类和关键词搜索。
- 安装前备份 web profile；优先使用 npm tarball，目录声明允许时才使用 GitHub 源码包后备来源。
- 安装、卸载均调用官方 `dsh plugin --profile web`；卡片内显示进行中、成功和可读错误状态。
- 搜索、安装、卸载 IPC 在 `src/main.js`，索引与安全校验在 `src/plugin-manager.js`，界面在 `src/preload-main.js`。

### 运行时、图标和发布

- 启动服务优先使用安装包内便携 Node，再回退系统 Node；不修改 PATH、NVM 或全局 npm。
- `predist:win` 会校验 Harness、准备便携 Node 并生成品牌图标。
- 图标资源包括 `assets/whale.svg`、`assets/icon.png`、`assets/tray-icon.png`、`assets/icon.ico`。
- 版本检查、打包后检查和 `--no-open` 行为沿用之前的维护记录；桌面端启动不会自动打开系统浏览器。

## Image-2 本地生成配置

用户有单独的 APIYi 图片 Key。示例中的 Chat 调用并不是图片生成接口：

- Chat：`/v1/chat/completions`，不能用来生成 `gpt-image-2` 图片。
- Images：`/v1/images/generations`，这是本项目生成图片使用的接口。

本机配置文件：`.env.image.local`（已加入 `.gitignore`，禁止上传）。可提交模板：`.env.image.example`。配置字段：

```text
DSH_IMAGE_API_BASE=https://api.apiyi.com/v1
DSH_IMAGE_MODEL=gpt-image-2-all
DSH_IMAGE_API_KEY=
```

生成脚本：

```powershell
cd C:\Users\XLJZ\Projects\dsh
npm run image:whale-girl
```

脚本只在当前 PowerShell 进程中设置 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`，不会打印 Key，也不会把 Key 写入项目源码。提示词在 `scripts/prompts/whale-girl-token-rice.txt`。

本轮实际调用 `gpt-image-2` 曾被 APIYi 返回无权限；读取模型列表后确认该 Key 可见别名为 `gpt-image-2-all` 与 `gpt-image-2-vip`。用户选择了 `gpt-image-2-all`，已成功生成素材。由于 API Key 曾在聊天截图中暴露，后续维护者应提醒用户撤销旧 Key、重新生成，并只写入本机 `.env.image.local`。

## 验证记录

已通过：

```powershell
node --check src/loading.js
npm test
```

当前测试结果：15 项通过，0 项失败。启动页静态预览脚本为 `scripts/capture-loading-preview.js`，预览图为 `design-demos/loading-whale-girl-preview.png`。

发布前仍需在本机执行并检查最终安装包：

```powershell
npm run verify:harness
npm test
npm run dist:win
```

必须测试 `release` 中最终安装后的应用，不能只测试 `npm start`。

## 上传 GitHub 时的边界

可以提交源码、文档、透明启动素材、`.env.image.example` 和测试；不要提交：

- `.env.image.local`
- 任何 API Key、`.credentials.yaml`、`~/.dsh` 数据
- `node_modules/`、`vendor/`、`release/`、`runtime/node/node.exe`
- 临时预览用户数据、日志和诊断目录

当前工作树包含多项用户此前的未提交改动；维护时不得使用 `git reset --hard` 或覆盖无关文件。

## 后续待办

1. 用户确认启动页视觉后，再决定是否保留原始大图和预览脚本。
2. 若要更真实的“偷吃”动作，可增加勺子节奏或饭碗轻微晃动，但不要引入大体积多帧动画。
3. 插件仓库、内置浏览器和官方 Harness 更新节奏仍需单独设计发布流程；每次升级都要更新锁文件并测试最终安装包。
