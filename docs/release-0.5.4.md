# DeepSeek Harness Desktop v0.5.4

本版本修复通用对话只能看到一条聊天记录的问题，并改善新建会话反馈。

## 新增

- “通用对话”入口增加展开/收起按钮，可查看并切换全部非空顶级聊天。
- 增加独立“+”按钮，用于明确新建通用对话。
- 历史按最近更新时间排列，当前空白新对话仍会保留。

## 修复

- 修复隐藏内部兼容 Workspace 时连带隐藏其全部 Session 的问题。
- 顶部“新会话”在当前已经是空白通用对话时显示明确提示，不再创建重复空白记录；当前已有内容时正常新建。
- 子 Agent、子会话和其他 Workspace 的聊天不会混入通用历史。
- 保持 Electron 沙箱 preload 安全约束，并保证右侧工具栏先于通用对话增强初始化。

## 升级说明

可从 `v0.5.3` 的更新中心检查 Stable 更新，也可直接下载安装本 Release。覆盖安装不会删除现有会话、设置、凭据或插件。

## 验证

- `npm test`：54 项通过。
- `npm run verify:harness`：Harness `0.1.1-rc.2` 校验通过。
- 使用隔离 Electron userData / DSH_HOME 验证历史展开、新建与选择、空白会话反馈、重新加载，以及右侧工具栏 6 个控件持续显示。

## 发布资产

- `DeepSeek-Harness-Setup-0.5.4.exe`：149,117,987 bytes，SHA256：`ED76CE61EE9FD7FEC857C603BEC2F33ED704D7DB20868E96A2B693CD17B21B6E`
- `DeepSeek-Harness-Setup-0.5.4.exe.blockmap`：154,824 bytes，SHA256：`C5BEBA703FF2B4F89B50E5BDF3AA9277AF90FE83FBBCDB37664F838AA3E1A0DD`
- `latest.yml`：361 bytes，SHA256：`B0EF6C745693F5FD26C7F168B65255C8CBFFC49597D1AA7FFFA7AC88DB8E0B76`
