# DSH Desktop 内置 IDE 工作台方案

状态：方案已记录，尚未实现
记录日期：2026-08-26

## 结论

第一阶段采用 **Monaco Editor + DSH Desktop 自有工作台外壳**。IDE 作为现有右侧可拖拽工作台的一种模式，与内置浏览器、文本编辑器和 DSH 主聊天并存。

暂不采用以下两条重路线：

- 不将现有 Electron/Harness 桌面端整体迁移到 Eclipse Theia。
- 不在安装包中直接捆绑 OpenVSCode Server 或 code-server，再通过网页嵌入完整 VS Code。

原因是当前产品已经有稳定的 Harness 主界面、右侧工作台、文件安全 IPC、便携 Node、`node-pty` 和 `ripgrep`。先升级现有能力，能保持界面统一、权限边界清楚，也避免立即引入第二套完整应用生命周期和本地端口服务。

## 已核实的成熟参考

以下信息在 2026-08-26 从项目官方仓库核实；正式选型和升级依赖前需要重新确认版本、许可证及 Windows 支持。

- [Arduino IDE 2.x](https://github.com/arduino/arduino-ide)：官方 README 说明其基于 Theia、使用 Electron，编译和上传交给 `arduino-cli` daemon。参考其“桌面前端 + 后台工具进程”分层。
- [Eclipse Theia](https://github.com/eclipse-theia/theia)：用于构建浏览器和桌面 IDE 的框架，支持 VS Code 扩展协议。参考其文件树、编辑器、终端、命令和扩展架构。
- [Eclipse Theia IDE](https://github.com/eclipse-theia/theia-ide)：官方可下载桌面 IDE，同时是 Theia 桌面产品模板。参考其 Electron 打包、品牌替换、更新与端到端测试，不直接搬入当前应用。
- [Monaco Editor](https://github.com/microsoft/monaco-editor)：VS Code 的编辑器核心。官方明确说明 Monaco 不是完整 VS Code，普通 VS Code 扩展不能直接安装。选为第一阶段编辑器内核。
- [OpenVSCode Server](https://github.com/gitpod-io/openvscode-server) 与 [code-server](https://github.com/coder/code-server)：参考完整浏览器 IDE 的进程管理、连接和扩展体验；当前不作为首选嵌入方案。
- [Sandpack](https://github.com/codesandbox/sandpack)：适合浏览器内运行前端示例，后续可参考“聊天生成小游戏后一键预览”，但不承担本地项目 IDE。

## 产品形态

```text
DSH Desktop 主窗口
├─ Harness 聊天主区（保持现有行为）
└─ 右侧可拖拽工作台
   ├─ 浏览器
   ├─ 文件/代码 IDE
   │  ├─ 文件树
   │  ├─ Monaco 多标签编辑器
   │  ├─ 搜索 / Diff / 问题
   │  └─ 终端
   └─ 下载、插件、诊断等现有工具入口
```

建议在右侧浮动工具栏增加独立“代码”图标。打开 IDE 后仍保留 DSH 对话，用户可以边聊天边看文件，不把 Harness 主页面替换成另一套全屏应用。

聊天联动目标：

- 点击回答中的本地文件或 `文件:行号`，在 IDE 标签中打开并定位。
- AI 修改文件后，编辑器感知磁盘变化；有未保存内容时禁止静默覆盖。
- 可将当前选区、文件路径或诊断信息引用到聊天输入框。
- 后续提供 AI 修改前后 Diff，以及接受、拒绝、撤销入口。

## 分阶段范围

### 第一阶段：可用编辑工作台

- 引入 `monaco-editor`，替换当前 textarea 式代码编辑区。
- 当前 Workspace 文件树：展开/收起、刷新、忽略明显的大型依赖目录。
- 多文件标签、未保存标记、关闭确认、重启恢复标签和光标位置。
- 读取、编辑、保存、磁盘冲突提醒继续复用现有 `text-file-editor` 安全逻辑。
- 文件内查找替换、行号、语法高亮、代码折叠、自动换行、基础快捷键。
- 使用现有 `ripgrep` 增加文件名搜索和全项目文本搜索。
- 内置单终端，基于项目已经打包的 `node-pty`；生命周期与工作区、窗口退出绑定。
- 聊天文件链接打开 IDE 并支持跳转行列。

### 第二阶段：代码审阅与项目操作

- Monaco Diff 编辑器。
- 新建、重命名、移动和删除文件/目录；删除必须二次确认并限制在 Workspace 真实路径内。
- Git 状态、改动列表、基础 Diff。Git 可用性及是否需要随包携带，实施前再核实，不假设用户电脑一定安装 Git。
- Markdown、图片、JSON 等预览。
- 多终端、分栏编辑、命令面板。

### 第三阶段：语言智能

- LSP 进程管理和按语言启停。
- 补全、悬停、定义跳转、查找引用、符号大纲、诊断列表。
- 格式化与代码操作。
- 是否兼容 VS Code 扩展，需要单独技术验证；不能把 Monaco 等同于 VS Code 扩展宿主。
- 调试器与断点属于后续独立项目，不与基础 IDE 同批承诺。

## 安全边界

- renderer 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
- 文件系统、终端和进程能力只能通过主进程受限 IPC 暴露。
- 所有文件操作继续执行真实路径解析，拒绝目录穿越和指向 Workspace 外部的符号链接。
- 终端默认工作目录必须是当前 Workspace；关闭 Workspace、窗口退出和应用退出时清理 PTY。
- 终端输出、搜索结果、文件内容都要设大小和速率上限，避免冻结 renderer。
- 不让内置浏览器网页直接调用 IDE、文件或终端 IPC。
- 自动保存默认关闭；AI 或外部程序修改磁盘时不能覆盖用户未保存内容。

## 第一阶段验收标准

- 从侧栏或工具栏打开 IDE，不遮挡 Harness 的 Session、新会话和右侧工具栏。
- 能在真实项目中浏览、打开和保存多种常见文本代码文件。
- `Ctrl+S`、标签关闭确认、磁盘冲突、重启恢复均可验证。
- 全局搜索结果可点击并定位到行。
- 终端可以启动、调整尺寸、输入、输出和关闭，退出应用后不留下子进程。
- 聊天中的文件引用在 IDE 打开，不再调用系统文本编辑器。
- 大目录、二进制文件、超大文本、Workspace 外路径和符号链接边界有自动化测试。
- IDE 不影响内置浏览器、插件中心、通用对话和桌面更新功能。

## 尚未决定

- 第一阶段文件树是否允许创建/删除，还是只读浏览后在第二阶段开放。
- IDE 工作台与浏览器是互斥模式，还是允许上下/左右同时分栏。
- 首批正式支持的 LSP 语言及语言服务的下载和更新方式。
- Git 使用系统安装、便携 Git，还是只做仓库状态读取。
- Monaco 主题跟随 Harness 主题的映射方式。

这些项目需要在正式开工 IDE 前由维护者确认，不能由实现者自行猜测成产品决定。
