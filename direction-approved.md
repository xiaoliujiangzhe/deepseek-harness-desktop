# Direction Approved

日期：2026-08-24

## 用户选择

用户原话：

> 暂时先选C，你也记一下。

已确认启动页方向：**C · Builder's Notebook**。

### 工具工作区方向

用户原话：

> 我选择C

已确认浏览器与插件中心正式界面方向：**C · 分屏工作台**。

参考初稿：

- `design-demos/tools-direction-a-sidebar-native.html` / `.png`
- `design-demos/tools-direction-b-workspace-tabs.html` / `.png`
- `design-demos/tools-direction-c-split-workbench.html` / `.png`

实现边界：保留 DSH 对话在左侧，右侧工具面板只显示浏览器；浏览器内容使用隔离的 Electron `WebContentsView`。插件中心按后续反馈移入「设置 → 通用设置」，聊天中的外部网页链接直接在右侧浏览器打开。该调整不改变启动页 C 的方向。

参考初稿：

- `design-demos/direction-c-builder-notebook.html`
- `design-demos/direction-c-builder-notebook.png`

## 后续正式实现边界

- 使用官方 Harness 源码中的鲸鱼 SVG 作为真实 Logo 资产。
- 启动页保留工程工作台、构建编号、规则网格和 `XLJZ / BUILD` 作者印章的视觉母题。
- 正式启动页必须继续支持真实进度、错误详情、选择工作目录和重试操作。
- 正式 Windows 图标使用单独鲸鱼标识制作多尺寸 ICO；不在小尺寸图标中放横向字标。
- 用户随后明确说“开工开工！你开始吧！”，已授权将本方向落入正式启动页和图标资源。
