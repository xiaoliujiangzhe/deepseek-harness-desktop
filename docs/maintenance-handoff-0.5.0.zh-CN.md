# DSH Desktop 0.4.0 维护交接记录（整合说明）

> 早期开发记录曾暂用 `0.5.0` 标记；该版本没有发布，内容已合并到当前待发布的 `0.4.0`。

日期：2026-08-24

## 范围

本轮在浏览器工作台和插件中心基础上加入诊断与修复中心、浏览器搜索/书签/历史、插件更新/启停和桌面更新中心，当前统一归入 `0.4.0`，暂未生成安装包。

## 诊断与修复

- `src/diagnostics.js` 独立负责结构化检查、报告脱敏、配置备份、凭据 version 修复和插件目录缓存清理。
- 主进程并行探测 DeepSeek API 文档、GitHub 和 curated 插件目录，单个端点 6 秒超时。
- 导出报告只接收结构化诊断结果，写盘前再次运行 `redactSecrets()`；不会把 credentials 文件正文加入报告。
- 配置备份只复制白名单中的 credentials、settings 和 Web profile 配置文件，不复制会话、附件或任意其他文件。

## 浏览器数据

- `src/embedded-browser.js` 的浏览器 settings schema 升级到 version 3，增加 `bookmarks` 和 `history`。
- 地址栏通过 `resolveBrowserInput()` 区分网址与搜索词，搜索词使用 Bing HTTPS 查询。
- 书签最多 100 个、历史最多 200 个，按 URL 去重；界面最多展示最近 50 条历史。
- 内部 `data:` 主页不进入书签或历史，权限与导航限制继续沿用 `0.4.0`。

## 插件管理

- `setPluginEnabled()` 只修改 `profiles/web/package.json` 的 `dsh.profile.bundles`，不删除 dependency；操作前调用现有 profile 备份。
- `updateInstalledPlugin()` 根据 source record 选择 npm 或已验证 GitHub 来源，更新后比较版本/commit 并要求重启。
- GitHub 更新继续锁定 40 位 commit、校验 manifest/bundle/入口、拒绝生命周期脚本。

## 参考实现

- VS Code：把安装、更新、启停和重载拆成独立状态动作，并对未知来源与签名失败显示明确风险。
- Joplin：将插件仓库 API 与本地插件运行服务分层。
- Min Browser：用独立 places/searchbar 模块管理历史、书签和地址栏建议。
- GitHub Desktop：日志与错误元数据使用独立模块，不与主界面业务混写。

以上为公开 GitHub 仓库的只读调研结论；本项目没有复制其源码。

## 验证

```powershell
node --check src\diagnostics.js
node --check src\embedded-browser.js
node --check src\plugin-manager.js
node --check src\main.js
node --check src\preload-main.js
npm test
npm run verify:harness
git diff --check
```

- 自动化测试：39 项通过。
- 开发版人工验收和最终 `npm run dist:win`：待完成。

## 发布注意

- 不提交 `release/`、`node_modules/`、便携 Node 二进制、用户 `.dsh`、`.env.image.local` 或任何 API Key。
- 人工验收完成前不要复用 `0.4.0` 安装包或哈希；最终打包后重新记录文件大小和 SHA256。
