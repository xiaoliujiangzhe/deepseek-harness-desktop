# DeepSeek Harness Desktop 0.4.0

这是当前准备发布到 GitHub 的桌面版本。版本号按发布顺序定为 `0.4.0`；本地此前出现的 `0.5.0` 已统一回退，避免跳过尚未发布的版本号。

## 本次更新

- 新增桌面更新中心。
- 更新中心区分 Stable / Preview 通道。
- 支持自动检查、仅启动检查、仅手动检查和关闭检查。
- 更新下载改为用户确认后执行，下载完成后由用户确认重启安装。
- 显示桌面版本、Harness、便携 Node.js 和 pnpm 版本。
- 支持查看更新说明、下载进度、跳过版本和取消跳过。
- 仍然保留原有 Harness 上游版本检查入口，作为维护者诊断信息；它不会修改用户机器上的 Harness。

## 发布前检查

```powershell
npm run verify:harness
npm test
npm run dist:win
```

必须在干净 Windows 环境安装生成的 NSIS 安装包，确认首次启动、已有 `.dsh` 数据迁移、聊天、浏览器、插件中心、更新中心都正常后，再创建 GitHub Release。

## 不包含的行为

- 不跟随官方 Harness `master` 每次提交自动替换运行时。
- 不让用户机器执行 `npm install` 或重建 Harness。
- 不静默强制安装桌面更新。
- 不上传 API Key、`.dsh` 数据、`node_modules` 或便携 Node 源文件。
