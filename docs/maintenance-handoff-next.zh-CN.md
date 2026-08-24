# DSH Desktop 0.5.0 维护交接记录

日期：2026-08-25

## 状态

本文记录 `v0.5.0` 的开发和发布内容。它是在已发布 `v0.4.0` 基础上新增的内置文件编辑功能。

## 内置文件编辑器

- `src/main.js` 的 Harness `host.openPath` 桥已从“仅 HTML”扩展为文件类型分流：HTML 继续进入本地实时预览，受支持的文本和代码文件进入内置编辑器，其他类型保持 Harness 原始行为。
- `src/text-file-editor.js` 负责扩展名识别、工作区真实路径校验、2 MB 上限、二进制拒绝、UTF-8 / UTF-16 解码、BOM 与 LF / CRLF 保留、SHA256 内容版本和同目录原子保存。
- `src/preload-main.js` 在现有右侧工作台中增加文件编辑模式和独立工具栏入口。
- 支持多文件标签、未保存状态、行号、文件内查找、自动换行、`Ctrl+S`、磁盘重载、系统编辑器打开和当前工作区文件选择。
- 同一文件被外部程序修改后，普通保存返回冲突，不会直接覆盖；用户可选择重新载入或明确覆盖。
- 关闭未保存标签和退出应用时都会提醒；仅隐藏右侧面板不会丢失当前草稿。

## 安全边界

- 主页面只传递 Harness 已解析的路径，真正的路径、文件类型、大小和工作区边界由主进程再次验证。
- 符号链接会解析为真实路径；目标落在工作区外时拒绝读取和保存。
- 网页和 Harness renderer 不获得 Node.js 或任意文件系统权限，读写只能通过受限 IPC 完成。
- 当前不支持二进制文件、超过 2 MB 的文本、UTF-8/UTF-16 之外的本地编码、新建文件、另存为或文件删除。

## 验证

```powershell
node --check src\text-file-editor.js
node --check src\main.js
node --check src\preload-main.js
npm test
npm run verify:harness
git diff --check
```

- 自动化测试：43 项通过。
- Harness 校验：`0.1.1-rc.2`。
- 隔离开发版已打开 `editor-demo.txt`，确认标签、工具栏、行号、编辑区和编码/EOL 状态出现。
- 隔离目录：`.test-electron-user-data` 与 `.test-dsh-home-editor`，均被 `.gitignore` 排除，不修改正式 `~/.dsh`。
- 最终 `npm run dist:win` 通过：Harness `0.1.1-rc.2`、便携 Node.js `v24.18.0`、pnpm `11.21.0`。
- 图标生成在无可用 Chromium GPU 上下文时会复用已经提交并校验的品牌资产；这不会更换发布图标，也不会阻止无 GPU 构建环境打包。

## 发布资产

- 安装包：`DeepSeek-Harness-Setup-0.5.0.exe`，149,113,244 bytes，SHA256：`6B77B24C9CB775992C848172F1326C7E8D5AEA2CE04F91A42ABD52649C411A2D`。
- blockmap：`DeepSeek-Harness-Setup-0.5.0.exe.blockmap`，155,067 bytes，SHA256：`CC3FEC2EDC54557DD4222AC2F09E60E3A7B1084EBAAA4BC2607586AD1A3E0D91`。
- 更新元数据：`latest.yml`，361 bytes，SHA256：`31CD10E4EB8A42D02AD9802509C37AAEAF88BFC64BB09EF03C271F5DEC3FEEFC`。
- `latest.yml` 的版本、文件名、SHA512 和文件大小均与安装包一致，可供已安装的 `0.4.0` Stable 通道检查更新。

## 下一步

- 由用户人工确认输入、`Ctrl+S`、重新打开、查找、自动换行、未保存关闭提醒和外部冲突提示。
- 版本号固定为 `0.5.0`；不要覆盖或重打已经发布的 `v0.4.0`。
- GitHub Release 上传后，从已安装的 `0.4.0` Stable 通道执行检查、下载和“重启并安装”，完成真实升级链路验收。
