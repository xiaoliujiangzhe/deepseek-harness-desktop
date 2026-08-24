# DSH Desktop 0.4.0 维护交接记录

日期：2026-08-24

## 目标

本轮把已有的单页内置浏览器升级为可长期使用的右侧网页工作台，并解决 DSH 生成本地 HTML 后仍调用系统默认浏览器的问题。`v0.3.1` 的插件中心修复继续包含在本版本中。

## 浏览器工作台

- `src/embedded-browser.js` 使用 `Map` 管理标签；每个标签拥有独立 `WebContentsView`，但共用隔离分区 `persist:dsh-desktop-browser`。
- 只将当前标签附加到主窗口，隐藏工作台时分离视图但不销毁网页。
- 支持标签新建、切换、关闭、favicon、加载和崩溃错误、前进/后退、刷新、页内查找及 50%–200% 缩放。
- 远程 HTTP/HTTPS 标签和缩放比例保存到 Electron `settings.json`，重启后最多恢复 12 个；localhost / 127.0.0.1 临时页面不恢复。
- 无网址时加载内置 `data:` 新标签主页，不把内部主页写进标签恢复数据；DeepSeek 文档和项目仓库仅作为快捷入口。旧预览版若只保存了自动种下的图像理解文档标签，会通过 settings version 迁移清除。
- 下载中心由浏览器 session 的 `will-download` 驱动，展示接收字节、完成/取消/中断状态，并提供打开、定位和失败重试。
- 选文通过隔离页面的 `executeJavaScript` 读取当前 selection；可见区域截图通过 `capturePage()` 取得 PNG。两者在主 renderer 中合成为原生 paste 事件，交给 Harness composer 自己更新草稿和图片附件。
- 引用和截图只加入草稿，不自动发送；图片仍由 Harness 的数量、MIME、单图大小和消息总大小限制校验。
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

- 自动化测试：27 项通过，新增多标签、主页迁移、恢复、选文、截图元数据和下载状态覆盖。
- 2026-08-24 已使用隔离的 Electron userData 和 DSH_HOME 启动开发版，人工确认多标签网页、浏览器 chrome、面板布局和拖动宽度可用。
- 隔离测试不修改用户真实 `~/.dsh`。
- 此前的 `0.4.0` 安装包生成于新标签主页加入之前，已经失效；完成人工检查后必须重新执行 `npm run dist:win` 并记录新 SHA256。

## 同轮启动修复

- `src/server.js` 的 `buildDshArgs()` 过去把数字 `0` 当成“不传端口”，实际会让 DSH 使用 profile 默认的 3080。
- 现在只在 `null` / `undefined` 时省略参数，桌面默认配置会真正执行 `web --no-open --port 0`，可与已经占用 3080 的正式版或命令行 DSH 并存。

## 发布注意

- 版本号为 `0.4.0`，历史 `v0.3.0` / `v0.3.1` Release 和文档继续保留。
- 不提交 `release/`、`node_modules/`、`runtime/node/node.exe`、用户 `.dsh`、`.env.image.local` 或任何 API Key。
- 发布前记录最终安装包 SHA256，并在干净 Windows x64 环境覆盖安装验证。
