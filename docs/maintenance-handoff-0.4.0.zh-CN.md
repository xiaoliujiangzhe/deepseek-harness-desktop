# DSH Desktop 0.4.0 维护交接记录

日期：2026-08-24

## 目标

本轮把已有的单页内置浏览器升级为可长期使用的右侧网页工作台，并解决 DSH 生成本地 HTML 后仍调用系统默认浏览器的问题。`v0.3.1` 的插件中心修复继续包含在本版本中。

## 浏览器工作台

- `src/embedded-browser.js` 使用 `Map` 管理标签；每个标签拥有独立 `WebContentsView`，但共用隔离分区 `persist:dsh-desktop-browser`。
- 只将当前标签附加到主窗口，隐藏工作台时分离视图但不销毁网页。
- 支持标签新建、切换、关闭、favicon、加载和崩溃错误、前进/后退、刷新、页内查找及 50%–200% 缩放。
- 前进/后退使用 Electron 35 的 `webContents.navigationHistory`。
- `src/preload-main.js` 注入标签栏、地址栏、加载条、查找栏、缩放和外部打开控件，并同步计算 `WebContentsView` 的内容区域。

## 本地 HTML 接管

- Harness 点击文件引用后，会先结合会话 cwd 解析绝对路径，再通过 `POST /api/host.openPath` 请求宿主打开。
- `src/main.js` 在 Harness 页面主世界包装 `fetch`，只拦截扩展名为 `.html` / `.htm` 的 `host.openPath` 请求。
- 包装器将 Harness 已解析的绝对路径通过受限 `postMessage` 交给 preload，并返回符合 Harness RPC schema 的 `{ opened: true }` 成功响应。
- preload 验证消息来源和文件扩展名后调用 `preview:open`，再在右侧新标签打开预览 URL。其他文件类型不拦截。

## 本地预览服务器

- `src/local-preview-server.js` 只监听 `127.0.0.1` 随机端口。
- 初始文件必须是当前桌面工作区内真实存在的 HTML。
- 资源请求仅允许访问已预览 HTML 所在目录，阻止路径穿越和读取工作区其他文件。
- HTML 注入 EventSource 客户端；`fs.watch` 观察项目目录，变化后通知页面刷新。

## 验证

```powershell
npm test
npm run verify:harness
npm run dist:win
```

- 自动化测试：21 项通过。
- 2026-08-24 已使用隔离的 Electron userData 和 DSH_HOME 启动开发版，人工确认多标签网页、浏览器 chrome、面板布局和拖动宽度可用。
- 隔离测试不修改用户真实 `~/.dsh`。
- `npm run dist:win` 通过，打包后验收确认 Harness `0.1.1-rc.2`、便携 Node `v24.18.0` 和便携 pnpm `11.21.0`。
- `release/win-unpacked/DeepSeek Harness.exe` 使用隔离 DSH_HOME 完成首次 web profile 初始化，启动页和 Harness 主界面均正常显示。
- 最终安装包：`release/DeepSeek Harness Setup 0.4.0.exe`，148,799,339 bytes。
- SHA256：`5681CD836E4706A63553CAD831D4DC5E3628653D41917E4B716FFDBA32DD8EA5`。

## 发布注意

- 版本号为 `0.4.0`，历史 `v0.3.0` / `v0.3.1` Release 和文档继续保留。
- 不提交 `release/`、`node_modules/`、`runtime/node/node.exe`、用户 `.dsh`、`.env.image.local` 或任何 API Key。
- 发布前记录最终安装包 SHA256，并在干净 Windows x64 环境覆盖安装验证。
