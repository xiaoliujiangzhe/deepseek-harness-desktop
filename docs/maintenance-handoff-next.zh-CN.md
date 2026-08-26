# DSH Desktop 0.5.5 维护交接记录

日期：2026-08-26

## 状态

本文保留此前维护信息，并记录 `v0.5.5` 的会话菜单、归档中心和凭据兼容修复。源码、安装包和 Release 的最终发布状态应以 GitHub 上的 `v0.5.5` 为准。

## v0.5.5：通用对话会话操作菜单

- 自定义通用历史行新增悬停 `···` 菜单：重命名、分叉会话、归档会话；交互接入 Harness `session.rename`、`session.fork` 和 `workspace.archiveSession` 官方 RPC，没有修改 vendored Harness 包。
- 重命名使用桌面端应用内对话框，空标题会被拒绝；成功后原地刷新历史。
- 分叉默认使用最后一个已完成回合。若源会话有持久化标题，则按 Harness 原生规则追加或递增 ` (n)` / `（n）`，之后打开新分叉。
- 普通分叉虽有 `parentSessionId`，但不是子 Agent。历史过滤现只排除 `origin: subagent`，普通分叉保持平铺可见，与 Harness 当前 Workspace 侧栏一致。
- `loadGeneralChatState()` 新增 `workspace.list` 基线，排除 `archivedSessionIds`。归档当前会话时选择最近的其他普通会话；没有剩余记录时创建空白通用对话。
- 会话标题新增从 `session.list.items[].projections.values.title` 读取，兼容测试或已投影客户端提供的直接 `title` 字段。
- 菜单支持鼠标移出区域后的行状态恢复、点击外部/滚动/窗口缩放关闭以及 `Esc` 关闭；点击菜单不会误切换会话。空白会话的“分叉”禁用，因为不存在已完成回合。
- 会话菜单专项加入后自动化从 54 项增至 58 项；本版连同归档中心和凭据迁移最终共 65 项通过，覆盖归档排除、普通分叉保留、子 Agent 排除、projection 标题、分叉标题递增以及三项 RPC 接线。
- 2026-08-26 使用隔离 Electron userData / DSH_HOME 和只监听 `127.0.0.1` 的临时 DevTools 接口完成真实 renderer 验证：`···` 菜单出现且包含三项；重命名真实 RPC 成功、标题原地刷新；归档当前会话真实 RPC 成功、旧会话隐藏并自动创建/选择空白会话；重载后右侧工具栏拖动柄与 5 个按钮共 6 个控件仍在。隔离数据只有空白会话且没有模型 Key，因此分叉按钮的空白禁用已实际确认，但“已有内容会话分叉成功”仍需用户用正常会话点验，不能伪装为已测。

## 已记录但尚未实现：内置 IDE 工作台

- 详细方案见 [`docs/ide-workbench-plan.zh-CN.md`](ide-workbench-plan.zh-CN.md)。
- 当前选择是先在现有右侧工作台中采用 Monaco Editor，复用已有文件安全 IPC、文本保存、`node-pty` 和 `ripgrep` 基础；不在第一阶段把整个应用迁移到 Theia，也不直接捆绑 OpenVSCode Server / code-server。
- 本节只是产品与技术规划。本轮没有新增 Monaco 依赖，没有增加 IDE 按钮、文件树、终端或 Git UI。

## 已记录但尚未实施：桌面功能插件化

- 详细方案见 [`docs/pluginization-plan.zh-CN.md`](pluginization-plan.zh-CN.md)。
- 推荐采用“DSH Feature Plugin + 受限 Desktop Bridge + Electron Core”三层边界；不能把浏览器、文件系统、进程和更新安装器误当作普通网页插件能力。
- 规划了 7 个功能插件仓库与一个 `desktop-suite` 聚合插件。完整版将离线内置锁定并验证过的插件成品，第三方插件继续由插件中心安装。
- 本轮只记录方案，没有拆分现有实现，也没有新建或上传独立插件仓库。

## v0.5.4：通用对话历史列表

- 原因：桌面端用 `display: none` 隐藏内部“通用对话”Workspace 整组节点，官方侧栏将该 Workspace 的 Session 子项渲染在同一节点内，因此多个通用对话也被一起隐藏，只剩独立一级入口可见。
- 独立入口现改为“打开最近使用的对话 + 展开/收起历史 + 新建通用对话”三部分；内部兼容 Workspace 仍隐藏，不会重新混入普通项目列表。
- 展开区通过官方 `session.list` 和 Workspace 的 `sessionIds` 交集列出全部普通非空 Session，按 `updatedAt` 从新到旧排序；当前选中的空白新对话会保留，子 Agent 和其他 Workspace 会话不会混入。普通用户分叉从 `v0.5.5` 起会正常显示。
- 会话过滤与安全字段整理放在主进程 `general-chat:list-sessions` 受限 IPC；沙箱 preload 仍只加载 Electron，未重新引入本地 CommonJS `require`。
- `bootDesktopFeatures()` 继续先执行 `bootTools()` 再安装通用对话增强，并增加源码顺序测试。当前自动化共 54 项通过。
- 已用隔离 Electron userData / DSH_HOME 进行真实窗口验证：历史区可展开；“+”可新建并选择 Session；重新加载后独立入口恢复；内部 Workspace 不显示；右侧工具栏 6 个控件持续存在。
- 顶部原生“新会话”在通用空白 Session 上原本会呈现为无视觉变化。现在仅当通用对话被选中时接管该按钮：当前仍为空白则提示“当前已经是空白新对话”，已有内容则新建通用 Session 并在重载后提示成功；普通 Workspace 下继续走 Harness 原生行为。

## 待补：鲸鱼娘表情包

- 第一组已生成 6 张：正在偷吃白饭、好耶、让我想想、代码炸了、对不起嘛、什么？！
- 透明无字版、中文字版、总览与 zip 位于 `assets/stickers/whale-girl-v1/`，生成提示词位于 `scripts/prompts/whale-girl-stickers/`。
- “摸鱼睡觉”和“开工加油”因 APIYi 中转服务连续在约 5 分钟时断开，未伪装为完成；待图片接口稳定后继续生成并补入同一组。

## v0.5.3：沙箱 preload 热修

- `v0.5.2` 在开启 `sandbox: true` 的主窗口 preload 顶层增加了 `require('./general-chat')`。Electron 沙箱 preload 不允许加载本地 CommonJS 模块，该异常导致整个 preload 提前终止，因此工具栏、外观注入和独立通用对话入口同时消失。
- `src/preload-main.js` 已恢复为只加载沙箱允许的 `electron` 模块；会话选择通过新增的 `general-chat:select-session` 受限 IPC 交给主进程执行。
- 自动化增加一项源码约束，禁止沙箱 preload 再出现相对路径 `require`。当前总计 50 项通过。
- 使用正式用户数据启动本地修复版实测：右侧工具栏恢复；独立通用对话入口恢复；内部通用 Workspace 继续隐藏；点击入口仍回到原“你好”会话。
- `v0.5.2` 的更新中心随工具栏一起不可用，因此该版本用户需要手动下载安装 `v0.5.3`；之后应用内更新能力恢复。

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

## v0.5.5：凭据 version 格式兼容

- 现象：启动页显示“BOOT FAILED / 服务在就绪前退出，退出码 1”，而直接运行当前项目随附的 `@deepseek-ai/dsh` 会提示 `.dsh/.credentials.yaml` 的 `version` 必须是字符串或数字类型不匹配。
- 原因：旧版桌面端曾把 `version: 1` 迁移成字符串 `version: "1"`；当前随包 Harness `0.1.1-rc.2` 的 `credentials-local` 契约读取 YAML 数字 `1`。
- `src/diagnostics.js` 现在只识别精确的旧格式 `version: "1"` / `version: '1'`，修复前生成 `.credentials.yaml.desktop-backup-<timestamp>`，只替换顶层 `version` 行，不读取、输出或改写其他凭据字段。数字 `version: 1` 原样保留；未知值不自动猜测。
- `src/main.js` 启动 Harness 前执行同一项保守迁移；迁移成功后继续启动，并在启动页提示已备份。这样用户不需要先打开诊断页手动修复。
- 已在当前机器正式 `C:\Users\XLJZ\.dsh\.credentials.yaml` 上完成一次备份和迁移，直接运行项目 CLI 已成功输出本地 `dsh web: http://127.0.0.1:<port>`；测试服务随后已停止。
- 相关测试覆盖：旧字符串迁移、数字版本不变、未知版本拒绝修改、备份保留原内容；`v0.5.5` 最终 `npm test` 65 项通过，Harness 校验 `0.1.1-rc.2`。

## v0.5.5：归档会话中心

- `src/archived-sessions.js` 从 Harness 的 `session.list`、`workspace.list` 和全局 `archivedSessionIds` 快照构建归档列表，按最近更新时间排序并显示所属工作区。
- 通用对话入口右侧新增“已归档”按钮；它是独立面板，不会把归档会话重新混入普通侧栏。面板支持恢复和删除。
- 当前 Harness 官方 RPC 只提供 `workspace.archiveSession`，没有 unarchive 或 session delete RPC。恢复/删除因此由桌面端在停止本地 Harness 后执行受限持久化迁移，再自动重启服务；不会在 Harness 运行期间直接改磁盘。
- 恢复只移除 `workspace.json` 的全局归档标记，保留原 Workspace 席位和完整日志。删除还会移除 Workspace 席位、projection cache 记录和会话日志目录。
- 删除前有桌面原生二次确认；删除/恢复操作均要求精确的 `session-<id>`、当前归档集合和合法 JSON 单元版本。删除前会在 `.dsh/desktop-session-backups/<timestamp>-delete-<sessionId>/` 保留维护备份，UI 明确提示该备份边界。若需要真正不可恢复地清除，还需用户手动删除这份备份。
- 相关测试覆盖：跨工作区归档列表、恢复保留日志、删除索引与日志并生成备份、未归档会话拒绝操作。本版最终总测试 65 项通过。

## 验证

```powershell
node --check src\text-file-editor.js
node --check src\main.js
node --check src\preload-main.js
npm test
npm run verify:harness
git diff --check
```

- 自动化测试：`v0.5.0` 为 43 项，`v0.5.1` 为 46 项，`v0.5.2` 为 49 项，`v0.5.3` 为 50 项，`v0.5.4` 为 54 项，`v0.5.5` 为 65 项。
- Harness 校验：`0.1.1-rc.2`。
- 隔离开发版已打开 `editor-demo.txt`，确认标签、工具栏、行号、编辑区和编码/EOL 状态出现。
- 隔离目录：`.test-electron-user-data` 与 `.test-dsh-home-editor`，均被 `.gitignore` 排除，不修改正式 `~/.dsh`。
- 最终 `npm run dist:win` 通过：Harness `0.1.1-rc.2`、便携 Node.js `v24.18.0`、pnpm `11.21.0`。
- 图标生成在无可用 Chromium GPU 上下文时会复用已经提交并校验的品牌资产；这不会更换发布图标，也不会阻止无 GPU 构建环境打包。

## 发布资产

- 安装包：`DeepSeek-Harness-Setup-0.5.4.exe`，149,117,987 bytes，SHA256：`ED76CE61EE9FD7FEC857C603BEC2F33ED704D7DB20868E96A2B693CD17B21B6E`。
- blockmap：`DeepSeek-Harness-Setup-0.5.4.exe.blockmap`，154,824 bytes，SHA256：`C5BEBA703FF2B4F89B50E5BDF3AA9277AF90FE83FBBCDB37664F838AA3E1A0DD`。
- 更新元数据：`latest.yml`，361 bytes，SHA256：`B0EF6C745693F5FD26C7F168B65255C8CBFFC49597D1AA7FFFA7AC88DB8E0B76`。
- `latest.yml` 的版本、文件名、SHA512 和文件大小均与 `v0.5.4` 安装包一致，可供已安装的 Stable 通道检查更新。

## 下一步

- `v0.5.2` 用户需要先从 GitHub 手动安装 `v0.5.3` 或更高版本；`v0.5.2` 的工具栏未初始化，无法使用应用内更新入口。
- 从 `v0.5.3` 升级到 `v0.5.4` 后，确认工具栏、更新中心、内置浏览器、文件编辑器、插件中心和通用对话历史均正常。
- 后续版本继续通过 Stable 通道执行检查、下载和“重启并安装”，验证应用内升级链路。
