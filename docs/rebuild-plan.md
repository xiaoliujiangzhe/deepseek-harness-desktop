# 重编译正路 —— 实施计划（供后续启用）

> 现状：桌面端已用 preload 注入方式“复刻”了正路的效果（分层透明 + 独立壁纸层 + 图面磨砂），
> 见 `src/preload-main.js`。本文件记录“fork Harness 源码重编译”的完整路径，等用户决定启用时照做。

## 参考实现

- 仓库：https://github.com/ChisaAlter/Deepseek-Harness-Desktop
- 它的做法：把整个 `deepseek-harness` fork 进 `vendor/deepseek-harness`（`git subtree`），
  直接改前端源码 `packages/client/*/src`，然后 `pnpm install` + `pnpm run build` 重新编译。
- 关键原文（README）：“改了 `packages/client/*/src` 之后要在 `vendor/deepseek-harness` 里跑
  `pnpm run build:lib:client`（或至少编对应包的 `lib/client.js`），只编 `apps/web/dist` 看不到改动。”

## 构建流程（必须在用户本机跑，沙箱禁止子进程/pnpm）

```powershell
git clone --depth 1 --branch master https://github.com/deepseek-ai/deepseek-harness.git vendor\deepseek-harness
cd vendor\deepseek-harness
pnpm install
pnpm run gen-persistence-catalog   # 关键：把 vision/describe 加进事件目录，否则会话重开报 SessionFormatUnsupportedError
pnpm run build          # 或 pnpm run build:lib:client（只编客户端 lib）
```

## 需要修改的文件（都在 `vendor/deepseek-harness/packages/client/ui-theme/src/`）

参考仓库里这些文件就是改动后的成品：

| 文件 | 作用 |
|---|---|
| `styles/wallpaper.css` | 壁纸层 + 半透明 chrome 的 CSS（见下方要点） |
| `wallpaper.ts` | 壁纸 data-URL 校验/缩放、`applyWallpaperLayer`、`mixWallpaperSurfaces` |
| `appearance-apply.ts` | 把壁纸/字体等文档级 extras 应用到 DOM |
| `client/AppearanceSection.tsx` / `WallpaperRow.tsx` / `ThemeLibrary.tsx` | 设置里的“外观”页 |
| `theme-settings.ts` / `theme-family.ts` / `builtin-families.ts` / `derive.ts` | 主题族/持久化（存 `$DSH_HOME/settings.yaml` 的 `ui-theme` 分节） |

## 核心实现要点（已复刻进 preload 注入）

1. **独立壁纸层 + 层级**：
   ```css
   #dsh-wallpaper { position: fixed; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
   #dsh-wallpaper-inner { position: absolute; left: -48px; top: -48px;
     width: calc(100% + 96px); height: calc(100% + 96px);
     background-position: center; background-repeat: no-repeat; background-size: cover;
     filter: blur(var(--dsh-wallpaper-blur, 0px)); }
   html[data-dsh-wallpaper], html[data-dsh-wallpaper] body, html[data-dsh-wallpaper] #root { background: transparent; }
   html[data-dsh-wallpaper] #root { position: relative; z-index: 1; }
   ```

2. **分层透明（文字清晰的关键）** `mixWallpaperSurfaces(tokens, mode, solidity)`：
   - 主画布 `--dsw-alias-bg-base` → 最透：`wallpaperCanvasSolidity(kept)`（kept≤40→×0.375；≤80→15+(kept-40)×0.75；否则 45+(kept-80)×2.75）
   - 侧栏 `--dsw-specific-sidebar-fill` → `(canvas+kept)/2`
   - 凸起表面 `--dsw-alias-bg-layer-1/2` → 保持 `kept`（接近不透明，保文字可读）
   - 用 `color-mix(in srgb, <solid> <percent>%, transparent)` 从静态 token 推导半透明色：
     light 底/凸起 = `--dsw-static-neutral-bluish-00`；dark 底 = `-950`、凸起 = `-875`

3. **磨砂**：`filter: blur()` 直接作用于壁纸图（不是 backdrop-filter），并带 48px 出血边避免边缘光晕。

## 识图模型兜底（vision fallback）实现要点

参考仓库在 Harness 里加了一个新包 + 改了 agent loop，两部分缺一不可：

| 部分 | 位置 | 说明 |
|---|---|---|
| 新包 | `packages/llm/llm-vision-fallback/` | cordis Service，`inject = ['llm']`，提供 `ctx.visionFallback` |
| 设置页 | `packages/client/ui-settings-models/src/client/VisionModelPicker.tsx` | 「设置→模型→识图模型」选择器，写进 `vision-fallback` settings 命名空间 |
| agent loop | `packages/agent/agent-loop/`（请求装配处） | 必须加：模型 `inputModalities` 不含 `image` 时调 `ctx.visionFallback.rewriteMessages(...)` |
| apiproxy 准入 | `packages/host/apiproxy/src/api-proxy.ts` | `session.prompt` 与 `session.selectModel` 在目标模型纯文本且会话有图时，若识图兜底已配置（`ctx.get('visionFallback').configured()`）则放行，否则拒绝 |

`llm-vision-fallback` 核心逻辑（已抓到完整源码）：

- 设置命名空间：`settingsNamespace('vision-fallback')`，schema `{ provider, model }`（两者为空 = 关闭）。
- 关键方法 `rewriteMessages(session, route, messages, signal)`：
  1. 无图片块直接原样返回；
  2. 有图片且已配置识图模型 → `ctx.llm.resolveModelInfo(route)` 判断主模型 `inputModalities` 是否含 `image`；
  3. 不含 → 对每个 image block 生成一次描述（或复用会话日志里已有的 `vision/describe` 事件），替换成文本块。
- 识图提示词 `DESCRIBE_SYSTEM`（要点）：客观详尽描述图片、完整转写图中所有文字（代码/报错/日志原样、保留换行缩进）、描述布局/图表/颜色、只陈述可见信息不推测、与图中文字同语言、无文字用中文。
- 替换文本格式：`【图片[「名称」]——此处有一张你无法直接查看的图片；以下是识图模型生成的描述】\n<描述>\n【图片描述结束】`。
- 配置项：`maxOutputTokens`、`timeoutMs`（超时码 `VISION_DESCRIBE_TIMEOUT`）。
- 描述会作为 `vision/describe` 事件写进会话日志，重放时复用、不重复调用识图模型。

## DeepSeek 官方路由支持图片

`llm-deepseek` 适配器原先整条路由是纯文本（`modelInfo` 硬编码 `inputModalities: ['text']`，序列化器
`assertTextOnly` 见图即抛 `UNSUPPORTED_CONTENT`），所以 `deepseek-v4-flash-vision-exp` 加了目录也收不了图。
已改为支持图片：目录字段加 `inputModalities`、`modelInfo` 按声明返回、序列化器把图片块转成 OpenAI
`image_url`（经 `ctx.attachments.readImage` 读字节再造 data URI）。生效需在 `$DSH_HOME/settings.yaml` 的
`llm-deepseek.models` 里给该模型加 `inputModalities: [text, image]`。

## 接入现有 Electron 壳

重编译后，让 Electron 启动 vendored 源码里的 harness（而非 npm 包），并让它 serve 新 dist：
- 参考仓库是 `node scripts/run-electron.js` 启动，主进程 `harness-controller.js` 用 vendored 源码跑 `dsh web`。
- 我们当前是 `npm` 依赖 `@deepseek-ai/dsh`；切换后需改成指向 `vendor/deepseek-harness` 的构建产物。

## 现状小结

- 已用注入实现：分层透明、独立壁纸层、图面磨砂、强调色、字体字号、布局密度、自定义 CSS（提交 `28545f9` 起）。
- 待用户确认注入版效果并 `git push` 后，再决定是否启用本重编译路径。
