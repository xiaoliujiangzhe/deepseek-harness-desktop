# vendor-patches —— 重编译正路的源码改动

> **已升级退役**：`vendor/deepseek-harness` 已从 `0.1.0-rc.5` 升级到上游 **`v0.1.1-rc.2`**（2026-08-21）。上游原生支持多模态/图片（`llm-deepseek` 图片序列化、模型目录 `inputModalities`、图片准入、文件引用），因此本目录此前为"解决纯文本路由看图"打的补丁（识图兜底、图片支持、准入、识图模型 UI）**全部被上游官方取代，不再应用**。此目录仅存档历史改动；如需回滚到 rc.5，用 `vendor/deepseek-harness.old`。

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

7. **只列出能看图的模型 + 模型「图片输入」开关**
   - `apiproxy/api/sessions.ts` + `apiproxy/api/sessions.schema.ts` → 给 `ModelCatalogModel` 加
     `inputModalities` 字段，`llm.models` 接口随模型返回声明的能力。
   - `apiproxy/api-proxy.ts` → `llm.models` 处理器把 `model.inputModalities` 映射到接口。
   - `ui-settings-models/VisionModelPicker.tsx` → 下拉框只列 `inputModalities` 含 `image` 的模型。
   - `ui-settings-models/ModelListEditor.tsx` → 模型编辑行加「图片输入」勾选（写入 `input: [text, image]`）。
   - `ui-settings-models/locales.ts`、`ModelsSection.module.css` → 对应文案和样式。
   - 效果：在「模型」页给某个模型勾上「图片输入」，它才会出现在「识图模型」下拉框里，
     选中即用，无需手改 settings.yaml。

8. **切换模型的准入检查尊重识图兜底（关键，否则带图会话切不回纯文本模型）**
   - `apiproxy/api-proxy.ts` → `session.selectModel` 里，目标模型不含图片但会话已有图片时，
     不再直接拒绝：若「识图模型」已配置（`ctx.get('visionFallback').configured()`），放行，
     图片会在请求装配时被兜底改写（与 `session.prompt` 发图入口的放行逻辑一致）。
   - 背景：`prompt`（发图入口）之前已放行，唯独 `selectModel`（切模型）没放行，
     导致「带图会话 + 纯文本主模型（如 deepseek-v4-flash）」切模型时报
     `model-unavailable: does not accept image input`。

9. **DeepSeek 官方路由支持图片（让 deepseek-v4-flash-vision-exp 能直接收图）**
   - `llm-deepseek/` 目录 → 整个拷到 `vendor/deepseek-harness/packages/llm/llm-deepseek/src/`
   - 该适配器原先是"纯文本路由"：`modelInfo` 硬编码 `inputModalities: ['text']`，序列化器
     `assertTextOnly` 见到图片直接抛 `UNSUPPORTED_CONTENT`。上面这个目录把它改成支持图片：
     - `DeepSeekCatalogModel` + `Config.models` 目录加 `inputModalities` 字段；
     - `modelInfo` 按声明返回（缺省仍 `['text']`）；
     - 序列化器把图片块转成 OpenAI `image_url`（`data:<mediaType>;base64,<b64>`），user 与
       tool-result 里的图片均可（`read_image` 结果也走通）；
     - 适配器通过 `resolveImage` 回调（插件用 `ctx.attachments.readImage` 提供）读取图片字节。
   - 生效方式：在 `$DSH_HOME/settings.yaml` 的 `llm-deepseek.models` 里给该模型加
     `inputModalities: [text, image]`，主模型选它即可直接发图，无需识图兜底。

## 构建（必须在用户本机跑，沙箱禁 pnpm/子进程）

双击项目根的 `setup-harness.cmd`，或手动：

```powershell
cd vendor\deepseek-harness
pnpm install
pnpm run gen-persistence-catalog   # 关键：把 vision/describe 加进事件目录，否则会话重开报 SessionFormatUnsupportedError
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
