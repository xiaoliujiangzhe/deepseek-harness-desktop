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

## 接入现有 Electron 壳

重编译后，让 Electron 启动 vendored 源码里的 harness（而非 npm 包），并让它 serve 新 dist：
- 参考仓库是 `node scripts/run-electron.js` 启动，主进程 `harness-controller.js` 用 vendored 源码跑 `dsh web`。
- 我们当前是 `npm` 依赖 `@deepseek-ai/dsh`；切换后需改成指向 `vendor/deepseek-harness` 的构建产物。

## 现状小结

- 已用注入实现：分层透明、独立壁纸层、图面磨砂、强调色、字体字号、布局密度、自定义 CSS（提交 `28545f9` 起）。
- 待用户确认注入版效果并 `git push` 后，再决定是否启用本重编译路径。
