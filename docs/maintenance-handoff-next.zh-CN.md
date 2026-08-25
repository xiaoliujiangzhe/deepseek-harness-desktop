# DSH Desktop 0.5.2 维护交接记录

日期：2026-08-25

## 状态

本文保留 `v0.5.0` 的内置文件编辑器和 `v0.5.1` 的通用对话信息，并记录 `v0.5.2` 的会话恢复修复。

## v0.5.2：通用对话会话恢复

- 修复 `v0.5.1` 每次点击“通用对话”都会调用 `session.create`、导致返回后看起来像聊天记录丢失的问题；实际旧日志从未被删除。
- 入口现在先调用官方 `session.list`，并只在通用 Workspace 的 `sessionIds` 成员中恢复顶级 Session；已有可用 Session 时不再创建新会话。
- 正常使用时优先恢复桌面端记录的上次通用 Session；从 `v0.5.1` 首次升级时优先选择最近一条 `blank=false` 的会话，跳过旧版本误建的更新但空白的 Session。
- 使用用户当前真实数据核验：通用 Workspace 中 8 个 Session 有 7 个为空，唯一有内容的 `session-46bc…` 被恢复算法正确选中；本地修复版完成“切换到其他工作区 → 返回通用对话”人工验证，重新显示原“你好”聊天。

## v0.5.1：通用对话

- `src/general-chat.js` 在 Electron `userData/general-chat` 下维护一个桌面端私有目录；该目录用于兼容 Harness 当前“会话必须选择 Workspace”的 Web UI 流程，不代表用户主动选择了项目。
- `src/main.js` 通过受限 IPC 只返回上述固定目录和“通用对话”标题，不接受 renderer 传入任意路径。
- `src/preload-main.js` 在侧栏“新会话”下方增加一级“通用对话”入口。点击后通过本机 `/api` 依次幂等注册 Workspace、固定显示名、创建 Session，并写入 Harness 已有的 `dsh.sessions.current` 选择状态后重新载入。
- 通用 Workspace 在侧栏按工作区分组视图中隐藏，只由一级入口创建；对话区仍显示“通用对话”，让用户知道当前不是某个真实项目。
- 私有目录首次创建时写入 `AGENTS.md`：未获用户明确要求时不操作该目录文件；任务需要已有项目时先提示切换工作区。已有文件不覆盖。
- 当前仍复用 Harness 标准 Agent preset 和 `Workspace Write` 权限，属于“无须用户选择项目”的通用入口，不是技术上 `cwd = undefined` 的裸 Session。若以后要从协议层禁用文件/终端工具，应新增专用 Agent preset，而不是只靠界面隐藏。
- 已知边界：侧栏切换为扁平会话视图后，通用对话产生的会话仍可能进入统一会话列表；分组视图会保持独立入口。后续若要彻底隔离，需要官方 Client Runtime 提供按 Workspace 分类/过滤的扩展点。

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

- 自动化测试：原 `v0.5.0` 发布验收为 43 项，`v0.5.1` 为 46 项；加入会话恢复覆盖后当前为 49 项通过。
- Harness 校验：`0.1.1-rc.2`。
- 隔离开发版已打开 `editor-demo.txt`，确认标签、工具栏、行号、编辑区和编码/EOL 状态出现。
- 隔离目录：`.test-electron-user-data` 与 `.test-dsh-home-editor`，均被 `.gitignore` 排除，不修改正式 `~/.dsh`。
- 最终 `npm run dist:win` 通过：Harness `0.1.1-rc.2`、便携 Node.js `v24.18.0`、pnpm `11.21.0`。
- 图标生成在无可用 Chromium GPU 上下文时会复用已经提交并校验的品牌资产；这不会更换发布图标，也不会阻止无 GPU 构建环境打包。

## 发布资产

- 安装包：`DeepSeek-Harness-Setup-0.5.2.exe`，149,115,967 bytes，SHA256：`10D33B7F0D5069F5A64A5CD154ED24D78BF44057EDECD124E417CEE03A54D784`。
- blockmap：`DeepSeek-Harness-Setup-0.5.2.exe.blockmap`，154,987 bytes，SHA256：`1AC0D0C1D8266577C11AFFF5BB1BA02BC62AC131639073CE85D390F1B99B55DF`。
- 更新元数据：`latest.yml`，361 bytes，SHA256：`3EEEA9D2352A2845858022855BBADDDCFFC60B20C3FD037D1D659C56A3CA6046`。
- `latest.yml` 的版本、文件名、SHA512 和文件大小均与 `v0.5.2` 安装包一致，可供已安装的 Stable 通道检查更新。

## 下一步

- 由用户人工确认输入、`Ctrl+S`、重新打开、查找、自动换行、未保存关闭提醒和外部冲突提示。
- `v0.5.0` 和 `v0.5.1` 均保留原 Release；会话恢复修复作为 `v0.5.2` 单独发布。
- `v0.5.2` GitHub Release 上传后，从已安装的 `v0.5.1` Stable 通道执行检查、下载和“重启并安装”，完成真实升级链路验收。
