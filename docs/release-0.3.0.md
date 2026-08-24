# DeepSeek Harness Desktop v0.3.0

## 本次更新

- 启动页改为已确认的 C · Builder's Notebook 方向，保留真实进度、错误详情、工作目录选择和重试。
- 使用 vendored 官方 Harness 鲸鱼 SVG 生成 `icon.png`、`tray-icon.png` 和多尺寸 `icon.ico`。
- 启动服务优先使用安装包内便携 Node，再回退系统 Node；不修改 PATH、NVM 或全局 npm。
- 增加 C · 分屏工作台：DSH 对话保持主视图，右侧显示隔离内置浏览器；聊天外部链接直接在右侧打开。
- 内置浏览器只允许 HTTP/HTTPS，独立持久分区，不加载 DSH preload；下载使用用户选择的保存路径，权限请求默认拒绝。
- 设置窗口左侧「插件」栏目中的插件中心读取 GitHub `dsh-plugin` Topic，过滤无 `dsh.bundle.patch` 声明的仓库；安装/卸载调用官方 `dsh plugin --profile web`，带 profile 备份和失败恢复。

## 验证

- `npm test`：14 个测试通过。
- `npm run verify:harness`：`@deepseek-ai/dsh` `0.1.1-rc.2` 校验通过。
- 本机 Node 运行时：`v24.18.0`，模块 ABI `137`；便携副本 SHA256 以 `runtime/node/runtime.json` 为准。

## 发布注意

- GitHub 上传时不要上传 `node_modules/`、`release/`、`vendor/`、本机 `runtime/node/node.exe` 或 `.test-*` 临时目录。
- 插件安装需要 pnpm。当前桌面端会优先使用安装包内运行时（若后续加入），其次寻找系统 `pnpm`；找不到会显示明确错误。
- GitHub Topic 索引和插件兼容声明依赖网络；网络失败不会影响本地对话和内置浏览器已打开的页面。
