# vendor-patches —— 重编译正路的源码改动

`vendor/deepseek-harness` 已 gitignore（不入库）。本目录保存我们对该源码做的改动，便于复现。

## 改了什么（识图模型兜底）

1. **新增包** `packages/llm/llm-vision-fallback/`
   - `llm-vision-fallback/` 整个目录 → 拷到 `vendor/deepseek-harness/packages/llm/llm-vision-fallback/`
   - cordis Service，`inject=['llm']`，提供 `ctx.visionFallback`，把图片块替换成识图模型的文字描述。

2. **agent loop 挂钩** `packages/core/agent-loop/src/agent.ts`
   - 本目录的 `agent.ts` 是改后成品：加了 `VisionMessageRewriter` 接口 + 在 `buildRequest` 里
     `ctx.get('visionFallback').rewriteMessages(...)` 后再冻结请求。

3. **挂载到 base bundle**
   - `base-cordis.patch.yml` → 覆盖 `vendor/deepseek-harness/packages/bundle/base/cordis.patch.yml`（加了 `llm-vision-fallback` 条目）。
   - `base-package.json` → 覆盖 `vendor/deepseek-harness/packages/bundle/base/package.json`（加了 `@deepseek-ai/dsh-llm-vision-fallback: workspace:^` 依赖）。

4. **注册到 host 构建面（关键，否则 tsc -b 不编译、tsdown 报 UNRESOLVED_ENTRY）**
   - `host-tsconfig.json` → 覆盖 `vendor/deepseek-harness/tsconfig.host.json`（在 `references` 里加了 `./packages/llm/llm-vision-fallback`）。

5. **设置界面「识图模型」下拉框（客户端 UI）**
   - `ui-settings-models/` 目录 → 拷到 `vendor/deepseek-harness/packages/client/ui-settings-models/src/client/`
   - 新增 `VisionModelPicker.tsx`（读 `llm.models` 目录、写 `vision-fallback` 命名空间）；
     `ModelsSection.tsx`（挂载该下拉框）、`locales.ts`（加 `visionModel*` 中英文案）为改后成品。
   - 下拉框仅在 host 暴露 `vision-fallback` 命名空间（即插件已挂载）时才渲染，否则整个隐藏。

6. **apiproxy 暴露白名单（关键，否则设置接口把 vision-fallback 过滤掉、下拉框永远看不到）**
   - `apiproxy/api-proxy.ts` → 覆盖 `vendor/deepseek-harness/packages/host/apiproxy/src/api-proxy.ts`
   - 把 `'vision-fallback'` 加进 `WEB_SETTINGS_NAMESPACES`（第 126 行附近的数组）。
   - 背景：apiproxy 的 `settings.describe` 会按白名单过滤命名空间，未列入的即使已注册也会
     返回 `settings-not-exposed`，前端 `state.namespaces.get('vision-fallback')` 就永远是 undefined。

## 构建（必须在用户本机跑，沙箱禁 pnpm/子进程）

双击项目根的 `setup-harness.cmd`，或手动：

```powershell
cd vendor\deepseek-harness
pnpm install
pnpm run build
```

## 配置识图模型

**首选：设置 → 模型 → 「识图模型」下拉框**（本目录第 5 条改动，重新构建后生效），
选好即写入 `vision-fallback` 命名空间，无需手动改文件；选「不启用」即关闭。

等价的手动写法（`$DSH_HOME/settings.yaml`）：

```yaml
vision-fallback:
  provider: <provider>
  model: <model>
```

`provider`/`model` 为空即关闭。主模型（如 deepseek）的 `inputModalities` 不含 `image` 时，
agent 会自动先用识图模型描述图片，再把描述交给主模型。

## 说明

- 壁纸/毛玻璃/界面透明度目前仍走 preload 注入（`src/preload-main.js`），未迁到源码——用户已满意注入版，
  所以本次正路只做了注入做不了的「识图兜底」。
- 参考实现：https://github.com/ChisaAlter/Deepseek-Harness-Desktop 的 `vendor/deepseek-harness`。
