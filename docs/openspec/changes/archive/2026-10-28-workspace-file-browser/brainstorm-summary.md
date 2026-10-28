# 设计摘要：workspace-file-browser

## 候选方案（待确认）

### 1. 文件栏显示隐藏条目

- 只改后端 `server/workspace/files.mjs` 的 `workspaceTree()`：删除隐藏项过滤（`entry.name.startsWith('.') && entry.name !== '.claude'`）。
- 保留 `~$` 临时文件跳过与 `WORKSPACE_SKIP` 重型目录跳过（含 `.git`、`node_modules`、`dist` 等），`WORKSPACE_SKIP` 使用 `toLowerCase()` 匹配。
- 前端树渲染、展开、排序与 1200 节点预算全部复用，不新增 UI 开关。

### 2. 内置只读文本查看器

- 面板形态：`index.html` 的 `.terminal-column` 内、`#terminalHost` 之后新增 `#fileViewer` 覆盖层；`.terminal-column` 设 `position: relative`，面板绝对定位覆盖终端区域，不改变 Grid 行定义，因此 xterm 尺寸与终端会话不受影响。
- 数据来源：复用后端已有的 `GET /api/workspace/file`（1 MB 上限 + 二进制检测），不新增路由、不新增依赖。
- 打开判定：前端按扩展名白名单判型。非文本类型（docx/xlsx/pdf/图片/音视频/压缩包）继续走现有 `openProjectFile()` 系统打开；文本类型请求接口，失败时用 `toast` 展示后端原文。
- 交互：双击与 Enter 走 `activateTreeFile()`；右键菜单新增「用系统默认应用打开」，接线到 `openProjectFile()`。
- 代码组织：新增 `src/workspace/viewer.mjs`（openViewer/closeViewer/renderViewer），`src/workspace/state.mjs` 增加 `app.viewer` 状态，样式追加到 `src/styles/files.css`。
- 只读：`<pre>` + 转义渲染，无编辑与保存入口。

## 已确认内容

- 显示隐藏文件与文件夹，仍跳过重型目录（用户在 Open 前确认）。
- 覆盖终端区域的面板，关闭后回到终端。
- 双击=内置查看，右键保留系统打开。
- 仅文本/代码文件进入查看器。

## 取舍与风险

- 隐藏项放开后节点变多：重型目录仍被挡住，预算与深度限制沿用既有行为。
- 覆盖层不参与 Grid：窗口缩放随父容器贴合，不触发终端 resize。
- 扩展名判型与后端二进制判定可能不一致：后端为最终判定，错误提示会指引右键系统打开。
- 用户原先「双击即系统打开」习惯改变：非文本类型行为不变，文本类保留右键入口。

## Spec Patch

无。现有 delta spec 已覆盖全部行为要求，本次设计不修改需求。

## 测试策略

- 单元测试：新增 `tests/workspace-files.test.mjs` 覆盖隐藏项可见、重型目录排除、文件夹优先排序。
- 构建：`npm run build` 通过。
- 浏览器验收：文件栏隐藏条目、双击查看器、关闭回终端、右键系统打开。

## 明确不做（非目标）

- 显示/隐藏开关与持久化设置。
- 多标签、搜索、语法高亮、Markdown 渲染、图片预览。
- 编辑与保存。
- 后端接口契约变化。
