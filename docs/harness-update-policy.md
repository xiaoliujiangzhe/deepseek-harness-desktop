# Harness 更新策略

## 结论

桌面版不应该跟随官方仓库每一次提交自动更新，也不应该让用户机器直接执行 `npm install` 或重建 Harness。正确的关系是：

```text
官方源码 master / 官方 npm 包
          ↓ 维护者评估
桌面项目固定版本 + package-lock
          ↓ 测试和构建
新的桌面安装包和 GitHub Release
```

用户端只负责检查并提醒，维护者负责升级和发布。

## 当前项目的事实

- 当前桌面版：`0.4.0`（本地开发版；GitHub 尚未发布）
- 当前固定 Harness：`@deepseek-ai/dsh@0.1.1-rc.2`
- `src/update.js` 会读取官方仓库默认分支的根目录 `package.json`，把其中的版本作为“官方最新”提示。
- 当前官方仓库没有被本项目当作可直接下载的桌面运行时；安装包使用 npm 包和锁文件中的精确版本。
- 当前项目会在打包后运行 `scripts/verify-packaged-harness.js`，直接检查 `release/win-unpacked` 中的 CLI 是否能启动。

“官方 master 有新提交”只代表值得维护者检查，不代表可以直接拿源码替换安装包。动态版本、兼容性、插件 API 和原生模块 ABI 都需要验证。

## 推荐更新节奏

建议采用“每周检查、按功能发布”的节奏：

1. 每周由维护者检查官方仓库和 npm 包是否有新版本。
2. 只有以下情况才立即升级：修复启动/安全问题、需要的新模型能力、明确需要的新插件 API、当前版本已无法使用。
3. 仅有普通提交或实验性变更时，不追随每一次 commit。
4. 发布前必须在干净 Windows 环境测试最终安装包。

这是项目维护建议，不是 DeepSeek 官方发布政策；官方实际版本、发布说明和兼容性仍需在升级时重新核实。

## 每次升级步骤

### 1. 建立独立升级分支

```powershell
git switch -c upgrade/harness-<target-version>
```

不要直接在 `main` 上边试边改。

### 2. 固定官方 npm 版本

使用明确版本安装，不要使用 `latest`、`master` 或不受控的 `npm update`：

```powershell
npm install --save-exact "@deepseek-ai/dsh@<target-version>" --registry=https://registry.npmjs.org
```

Harness 的 peer dependencies 如果需要一起升级，必须全部固定到同一兼容发布线，并让 npm 正常更新 `package-lock.json`。禁止手工删除或替换锁文件里的传递依赖。

### 3. 先做版本和基础测试

```powershell
npm run verify:harness
npm test
git diff --check
```

如果 `package.json`、锁文件和 `node_modules` 版本不一致，停止升级，不要继续打包。

### 4. 验证用户数据迁移

至少验证：

- 全新 `%USERPROFILE%\.dsh`
- 从旧 Harness 升级且已有会话、附件、设置和凭据
- 中断迁移后再次启动
- `profiles\web\cordis.patch.yml` 仍按设计保留

不要把用户的 API Key、`.credentials.yaml`、sessions 或 attachments 提交到仓库。

### 5. 验证功能

至少测试：

- 普通文字对话
- `deepseek-v4-flash-vision-exp` 的 PNG/JPEG 输入
- 关闭并重新打开会话后再次发图
- 已登记插件的加载和卸载（插件功能上线后）
- 浏览器面板的加载和权限隔离（浏览器功能上线后）

### 6. 升级桌面版本并打包

Harness 版本变化后，桌面版本也必须增加。版本号规则建议：

- 只有 Harness 依赖或兼容性修复：桌面 patch 版本，例如 `0.2.1` → `0.2.2`
- 新增用户可见功能：桌面 minor 版本，例如 `0.2.x` → `0.3.0`
- 破坏性配置或运行方式变化：桌面 major 版本，并提供迁移说明

构建并强制执行打包后验收：

```powershell
npm run dist:win
```

最后必须看到：

```text
打包产物校验通过：Harness <target-version>
```

只看到 electron-builder 生成 NSIS 文件，不代表安装包可用。

### 7. 桌面端更新机制（0.4.0）

桌面端更新使用 `electron-updater`，发布源固定为本项目的 GitHub Releases。更新中心默认只检查，不会静默下载或安装：

- 启动 30 秒后进行一次后台检查，之后最多每 12 小时检查一次。
- 用户可以切换为仅启动检查、仅手动检查或关闭检查。
- 找到版本后由用户点击“下载更新”，下载完成后由用户点击“重启并安装”。
- 支持 Stable 和 Preview 两个通道；Preview 必须由用户主动选择。
- 支持“跳过此版本”，不会删除用户的 `.dsh`、会话、附件或凭据。
- 开发模式只展示更新中心，不会下载安装包；必须安装打包后的 NSIS 版本才能验证下载和重启安装。

electron-builder 会生成并发布 `latest.yml`、安装程序和校验元数据。发布前必须确认 GitHub Release 中这些文件都存在，并在干净 Windows 环境完成安装和更新测试。

### 8. 安装版验收和发布

在干净 Windows 用户或虚拟机安装最终 `.exe`，确认应用启动、文字、图片、插件和浏览器（若已实现）都正常后：

1. 提交源码和锁文件。
2. 推送 `main`。
3. 创建新的 GitHub tag 和 Release。
4. 上传安装 `.exe`、`.blockmap`、`latest.yml`（由 `electron-builder` 生成）。
5. 将新 Release 标记为 Latest。
6. 保留旧 Release，并在旧版本顶部标注升级目标，不覆盖旧文件。

## 可以自动化的部分

后续可以加入 GitHub Actions 定时任务：

- 每周读取官方仓库默认分支和 npm 版本。
- 发现变化时创建 issue 或升级 PR。
- 自动运行版本校验和测试。
- 不自动合并、不自动发布安装包。

这样可以跟上官方节奏，同时保留人工检查插件兼容性、原生模块和最终安装包的控制权。
