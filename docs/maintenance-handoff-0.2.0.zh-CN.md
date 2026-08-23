# DSH Desktop 0.2.0 维护交接记录

> 给下一位 DSH / Codex 维护者：请先读完本文，再决定是否执行安装、升级或迁移命令。
> 当前升级和 Windows 安装包已经完成，不要再次自动升级 Harness，也不要恢复旧的 vendor 优先逻辑。

> 2026-08-23 后续更正：已发布的 `v0.2.0` 安装包漏打包 Harness 的部分 peer dependencies，安装版会以 `ERR_MODULE_NOT_FOUND` 退出。源码提交本身可以运行，但 `v0.2.0` 安装包不应继续分发；修复版版本号为 `0.2.1`。

## 当前结论

- 项目目录：`C:\Users\XLJZ\Projects\dsh`
- GitHub：<https://github.com/xiaoliujiangzhe/deepseek-harness-desktop>
- 桌面版：`0.2.1`（修复安装包依赖遗漏；原 `v0.2.0` Release 安装包不可用）
- 固定的 Harness 版本：`@deepseek-ai/dsh@0.1.1-rc.2`
- 已发布提交：`aedd5bf release: desktop v0.2.0 with DSH 0.1.1-rc.2`
- `main` 与本地远程跟踪分支 `origin/main` 均指向 `aedd5bf`（2026-08-23 本机检查结果）。
- 用户曾确认源码开发模式可以正常打开，并已在 GitHub 创建 `v0.2.0` Release；随后确认该 Release 的安装包缺少运行时 peer dependencies。
- 新 Windows NSIS 产物应为：`release\DeepSeek Harness Setup 0.2.1.exe`
- 桌面启动 DSH 时使用 `web --no-open`，只显示 Electron 桌面窗口，不再自动打开系统浏览器。

快速核对当前状态：

```powershell
cd C:\Users\XLJZ\Projects\dsh
npm run verify:harness
npm test
git status --short
```

期望版本检查输出为 `0.1.1-rc.2`；当前测试基线为 6 项通过、0 项失败。

## 这次故障的根因

项目升级前处于多个版本混用状态：

1. 根目录 npm 依赖仍是 Harness `0.1.0-rc.6`。
2. `vendor/deepseek-harness` 中的 CLI 已经是 `0.1.1-rc.2`。
3. 用户目录 `~/.dsh/profiles` 中还残留 rc.6 生成的插件依赖。
4. Electron 打包清单没有携带 `vendor/`，导致源码运行和正式安装包可能启动不同的 CLI。

因此“看起来升级了 vendor”并不等于安装包真正升级，旧 CLI、新 CLI 和旧 Web 插件混用后会造成插件树加载失败、Web UI 一直转圈或桌面端打不开。

修复用户配置时还遇到两个独立的凭据文件问题：

- `.credentials.yaml` 的 `version` 曾被 YAML 解析成非字符串，旧错误明确要求它必须是字符串。
- PowerShell 写入 UTF-8 时产生了 `U+FEFF` BOM，后来 BOM 被缩进到 `DEEPSEEK_API_KEY` 键名前，造成凭据引用名非法。

BOM 已从凭据文件中移除。不要把用户的 `.credentials.yaml`、API Key 或任何 `~/.dsh` 内容提交到仓库。

## 已完成的实现

### 1. 统一正式 CLI

- `package.json` 将桌面版本设为 `0.2.0`。
- `@deepseek-ai/dsh` 精确固定为 `0.1.1-rc.2`，锁文件已同步。
- `src/server.js` 在开发模式和安装包中都优先解析根项目随包携带的 npm CLI。
- vendor CLI 只在显式设置 `DSH_DESKTOP_USE_VENDOR=1` 时使用。
- `src/update.js` 显示实际启动的 CLI 版本，不再读取未打包的 vendor 版本。

不要重新加入“vendor 存在就优先启动”的逻辑，否则源码和 GitHub 安装包会再次行为不一致。

### 2. 可恢复的旧插件迁移

新增 `src/harness-migration.js`，在启动 rc.2 前识别旧版生成依赖，并将它们备份到：

```text
%USERPROFILE%\.dsh\profiles\.desktop-migration\
```

迁移只处理可再生成的依赖和 Web profile 包元数据，明确保留：

- `sessions`
- `attachments`
- `settings.yaml`
- `.credentials.yaml`
- `profiles\web\cordis.patch.yml`

不要让用户把 `.desktop-migration` 选作“工作目录”；它只是迁移备份目录。

### 3. 原生 DeepSeek 多模态

Harness `0.1.1-rc.2` 已包含 `deepseek-v4-flash-vision-exp`，并声明支持 `text + image` 输入。桌面端走官方原生实现，不再依赖旧的识图兜底补丁作为正式路径。

界面验证路径：

- Provider：`deepseek-official`
- Model：`deepseek-v4-flash-vision-exp`
- 分别测试普通文字、PNG/JPEG、重新打开会话后再次发送图片。

账号权限、实时价格和线上限制必须以 DeepSeek 官方文档为准；本文没有对这些动态信息作保证。

### 4. 版本与发布保护

新增 `scripts/verify-harness-version.js`。以下命令会先校验 `package.json`、锁文件/实际安装版本的一致性：

```powershell
npm start
npm run dist:win
```

版本不一致时会主动阻止启动或打包，避免再次发布“标称 rc.2、实际 rc.6”的安装包。

`npm run dist:win` 完成后还会自动执行 `scripts/verify-packaged-harness.js`，直接从 `release/win-unpacked` 运行随安装包携带的 CLI。只要出现缺包或版本错误，发布检查就会失败。

`package.json` 中设置了 `build.npmRebuild=false`。DSH 的 `node-pty` 等原生模块由系统 Node 运行，不应被 electron-builder 重建为 Electron ABI；此前重建会因为本机没有 Visual Studio C++ Build Tools 而失败。

### 5. 禁止自动打开浏览器

`src/server.js` 通过 `buildDshArgs()` 固定生成：

```text
<bin> web --no-open [--port <port>]
```

Electron 仍会加载本地 Web UI，但 DSH CLI 不再调用默认浏览器。对应回归测试位于 `test/server.test.js`。

## 主要文件

- `package.json` / `package-lock.json`：桌面版与 Harness 固定版本、构建配置。
- `src/server.js`：CLI 选择、真实版本解析、`--no-open`、服务生命周期。
- `src/main.js`：启动前迁移及错误提示。
- `src/harness-migration.js`：旧生成依赖的可恢复迁移。
- `src/update.js`：更新区块读取实际 CLI 版本。
- `src/preload-main.js`：桌面更新提示文案。
- `scripts/verify-harness-version.js`：启动/打包前版本一致性检查。
- `scripts/verify-packaged-harness.js`：构建后从 `win-unpacked` 直接启动 CLI，防止缺依赖的安装包被发布。
- `test/harness-migration.test.js`：迁移行为测试。
- `test/server.test.js`：CLI 版本解析和 `--no-open` 参数测试。
- `README.md`、`CHANGELOG.md`、`docs/release-0.2.0.md`：用户与发布文档。

## 已做的验证

- `npm run verify:harness`：通过，实际版本为 `0.1.1-rc.2`。
- `npm test`：6 项通过、0 项失败。
- 临时干净 `DSH_HOME`：rc.2 CLI 曾成功绑定本地 Web 端口。
- 用户原有 `~/.dsh`：修复凭据格式和 BOM 后，用户确认桌面 UI 可以打开。
- 原 `v0.2.0` 的 `npm run dist:win` 虽生成了 NSIS 文件，但后续安装验证发现缺少 `@deepseek-ai/cordis-plugin-group` 等 peer dependencies；该产物不可用。
- GitHub 源码：提交 `aedd5bf` 已推送到 `main`。
- GitHub Release：用户已报告 `v0.2.0` 发布完成。

## 后续维护规则

1. 不要在用户机器上让桌面应用自行修改或重建 vendor Harness。
2. 升级 Harness 时只修改精确 npm 版本，正常执行 `npm install` 更新锁文件，禁止手改传递依赖版本。
3. 每次发布前运行 `npm run verify:harness`、`npm test` 和 `npm run dist:win`。
4. 必须测试最终安装后的应用，不能只测试 `npm start`。
5. 不要删除 `~/.dsh` 用户数据；需要清理时只处理确认可再生成的 profile 依赖，并先备份。
6. 不要提交 `.dsh`、API Key、凭据文件、`release/win-unpacked` 或构建诊断文件。
7. `vendor-patches` 中有本次升级前就存在的用户改动和历史方案；不要在没有确认用途的情况下删除或覆盖。

## 如果再次出现“Web UI 一直转圈”

按以下顺序收集证据，不要先猜代理问题：

1. 运行 `npm run verify:harness`。
2. 查看启动错误全文，特别是 `plugin tree failed to load` 后的最内层 cause。
3. 检查 `.credentials.yaml` 中 `version` 的类型，以及文件或键名中是否存在 `U+FEFF`。
4. 检查 `~/.dsh/profiles` 是否又生成了低于当前 Harness 版本的插件依赖。
5. 确认实际启动的 CLI 来自打包的 npm `@deepseek-ai/dsh`，而不是 vendor 或用户目录中的旧副本。

除非拿到新的明确错误，不要重复执行无目标的升级或长时间安装流程。
