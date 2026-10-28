---
comet_change: workspace-file-browser
role: technical-design
canonical_spec: openspec
archived-with: 2026-10-28-workspace-file-browser
status: final
---

## Context

动机与范围见 `proposal.md`，行为契约见 `specs/workspace-file-browser/spec.md`。

现状约束：

- 后端 `server/workspace/files.mjs` 的 `workspaceTree()` 是整个文件树的唯一数据来源，前端只做渲染与展开。隐藏项过滤发生在这一处：`entry.name.startsWith('.') && entry.name !== '.claude'` 直接跳过，`WORKSPACE_SKIP` 另行跳过重型目录。
- 后端已有 `workspaceFileText()` 与 `GET /api/workspace/file`，返回 `{ name, path, content, size, modifiedAt }`，内置 1 MB 上限与二进制检测；前端目前未使用该接口。
- 前端 `src/workspace/files.mjs` 的 `openProjectFile()` 调用 `POST /api/workspace/open-file` 走系统默认应用。
- `.terminal-column` 使用 CSS Grid（工具栏 / 终端 / 输入区 / 状态栏），`#terminalHost` 内挂载 xterm 实例，实例必须持续留在 DOM 中，否则终端会话需要重连。
- 样式按模块拆分，由 `src/workstation.js` 引入；文件浏览相关样式在 `src/styles/files.css`。

## Goals / Non-Goals

**Goals:**

- 只改一处过滤逻辑即可让隐藏文件与文件夹出现在文件栏，前端渲染与展开逻辑不重复改造。
- 查看器复用现有文件读取接口，不新增后端路由、不新增依赖。
- 查看器打开与关闭不破坏终端挂载与终端会话。

**Non-Goals:**

- 不做「显示/隐藏隐藏文件」用户开关与持久化设置。
- 不做多标签、搜索、语法高亮、Markdown 渲染与图片预览。
- 不提供编辑、保存、格式化能力。
- 不改变 `open-file` 与 `open-file` 相关的系统打开语义。

## Decisions

### 决策 1：隐藏项在后端统一放开，重型目录继续跳过

删除 `workspaceTree()` 中的隐藏项过滤判断，保留 `~$` 临时文件跳过与 `WORKSPACE_SKIP`（含 `.git`、`node_modules` 等）判断。`WORKSPACE_SKIP` 已用 `toLowerCase()` 匹配，`.git` 会被继续排除。

- 理由：文件树只有这一个读取入口，前端不需要感知过滤规则；隐藏目录的递归展开、排序、预算控制天然复用。
- 备选方案：前端增加「显示隐藏文件」开关。需要新增 UI 控件、偏好字段与持久化，超出本次请求范围，且会让「文件夹内是否含隐藏项」的缓存签名变复杂。

### 决策 2：查看器是覆盖终端区域的独立面板，而非改写终端容器

在 `index.html` 的 `.terminal-column` 内、`#terminalHost` 之后新增隐藏的 `<section class="file-viewer" id="fileViewer" hidden>`；`.terminal-column` 设为 `position: relative`，面板用绝对定位覆盖工具栏以下、状态栏以上的区域，带不透明背景。

- 理由：不改 Grid 行定义，`#terminalHost` 始终参与布局，xterm 尺寸不变，无需在关闭后重新 fit；终端进程与会话不受影响。
- 备选方案 A：新增一行 Grid 并切换显示。会改变终端高度，打开/关闭都要触发 `fitAddon.fit()`，并可能引起 CLI 重排。
- 备选方案 B：模态弹层覆盖整个工作区。会遮挡会话列表与文件栏，关闭成本更高，且与「不离开工作台上下文」的目标冲突。

### 决策 3：扩展名先行判型，后端检测兜底

新增 `isPreviewableText(item)`（按扩展名白名单，含无扩展名文本兜底）与 `activateTreeFile(path)`：

1. 扩展名属于非文本类型（文档、表格、PDF、图片、音视频、压缩包）→ 继续调用现有 `openProjectFile()`，行为与现在一致。
2. 属于文本类型 → 调用 `GET /api/workspace/file`；成功后渲染到面板。
3. 接口返回错误（二进制、超过 1 MB、文件不存在等）→ 用 `toast` 展示后端错误原文，不打开面板。

- 理由：避免为 `.docx` 等明显非文本文件发出无意义请求，同时保留后端作为二进制与体积限制的权威判定，规则不重复。
- 备选方案：全部文件都先请求后端再决定。对 Word/PDF 会产生一次必然失败的请求，且错误文案无法区分「类型不支持」与「读取失败」。

### 决策 4：双击与回车改走查看器，系统打开移入右键菜单

`wireTree()` 的双击与 Enter 改为调用 `activateTreeFile()`；`openProjectFile()` 保留并继续作为系统打开入口。文件右键菜单增加「用系统默认应用打开」项（`#fileTreeOpenExternal`），复用现有菜单定位与关闭逻辑。

- 理由：保留原有能力，同时把默认路径切换为内置查看，符合用户确认的选择。
- 备选方案：完全移除系统打开入口。Word/PDF 等无法预览的类型将失去打开途径，不可接受。

### 决策 5：查看器状态与渲染集中在 `src/workspace/viewer.mjs`

新增模块负责：`openViewer(path)` / `closeViewer()` / `renderViewer()` 与内容转义。状态存于 `app.viewer = { path, name, size, modifiedAt, content, loading }`。

- 理由：与 `files.mjs` 的树渲染职责分离，避免 `files.mjs` 继续膨胀；后续扩展（图片、Markdown）只需改该模块。
- 备选方案：直接写入 `files.mjs`。模块已 300 行，职责混杂。

### 决策 6：样式追加到 `src/styles/files.css`

复用现有变量（`--surface`、`--line`、`--ink`、`--mono`）与深色主题覆盖方式，新增 `.file-viewer*` 规则，不新增样式文件与引入点。

- 理由：查看器属于文件浏览能力，改动点集中；避免为一个面板新增文件与入口注册。

## Risks / Trade-offs

- [隐藏项放开后树节点变多，可能触及 1200 节点预算，导致深层目录提前截断] → 预算与深度限制原本就存在，`WORKSPACE_SKIP` 继续挡住最大的目录；在验收中确认典型项目根目录可正常展开。
- [绝对定位覆盖面板在窗口缩放时不再精准对齐终端区域] → 面板以 `.terminal-column` 为定位父级并四边贴合，缩放随父容器自动适配；`.terminal-column` 与面板的背景色统一取终端背景变量。
- [前端扩展名判型与后端二进制判定不一致（如无扩展名的二进制文件）] → 后端检测为最终判定，错误提示会明确告知并指引右键系统打开。
- [用户依赖原先「双击即系统打开」的习惯] → 系统打开保留在右键菜单，且非文本类型双击行为不变。
- [大文件内容整体渲染为单个 `<pre>` 可能拖慢界面] → 后端 1 MB 上限已限制上限；不引入虚拟滚动。

## Migration Plan

无数据迁移。纯前端与一处后端过滤逻辑改动，回滚只需还原代码，不涉及存储格式或接口契约变化。

## Open Questions

无。
