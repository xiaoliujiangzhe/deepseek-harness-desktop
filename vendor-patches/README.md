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

## 构建（必须在用户本机跑，沙箱禁 pnpm/子进程）

双击项目根的 `setup-harness.cmd`，或手动：

```powershell
cd vendor\deepseek-harness
pnpm install
pnpm run build
```

## 配置识图模型（v1 无 UI，改 settings.yaml）

在 `$DSH_HOME/settings.yaml` 里加：

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
