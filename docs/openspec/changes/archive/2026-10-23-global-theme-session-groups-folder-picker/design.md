---
comet_change: global-theme-session-groups-folder-picker
role: technical-design
canonical_spec: openspec
archived-with: 2026-10-23-global-theme-session-groups-folder-picker
status: final
---

## Context

- 应用由 Tauri 外壳启动本机 Node 服务，WebView 加载 `http://127.0.0.1:<port>/`；前端是 `index.html` + `src/workstation.js` + `src/workstation.css`，通过 HTTP 接口与 `server.mjs` 通信，不能直接使用 Tauri 的 IPC 与 dialog 插件。
- 主题现状：`workspaceDark` 由 localStorage key `claude-workbench-workspace-theme` 初始化；`applyWorkspaceTheme()` 只给 `.workspace` 加 `theme-dark`、给 `.shell` 加 `workspace-dark`，按钮位于终端工具栏，管理页不参与。
- 会话现状：`/api/workspace/sessions` 返回全部会话，包含 `projectPath`、`createdAt`、`lastUsedAt`、`mode`、`status`；前端 `refreshSessions()` 平铺渲染，`refreshSessionStatuses()` 依赖 `data-session-id` 更新状态。
- 选择器现状：`selectWorkspaceFolder()` 通过 PowerShell 使用 `System.Windows.Forms.FolderBrowserDialog`，结果以 UTF-8 Base64 输出，再由 `safeWorkspaceRoot()` 校验。

## Goals / Non-Goals

**Goals:**

- 主题状态成为应用级状态，管理页与对话工作站共用同一入口和同一套配色变量。
- 会话分组、折叠状态完全在前端完成，接口与数据结构不变。
- 文件夹选择使用系统现代“打开”式对话框，保持 `/api/workspace/select-folder` 契约不变。

**Non-Goals:**

- 不做多套强调色或用户自定义配色，只保留深色/浅色两种主题。
- 不改动会话存储格式、接口路径或服务端分组逻辑。
- 不改造 Tauri 外壳、不引入 Tauri dialog 插件或新依赖。
- 不调整管理页的信息架构与布局，仅做配色适配。

## Decisions

### 1. 主题状态提升到 `body` 级 class

将主题切换改为在 `document.body` 上设置 `theme-dark`，在 CSS 中用 `body.theme-dark` 覆盖应用级变量，并补充管理页现有硬编码颜色的覆盖规则。按钮移入顶部栏 `.top-actions`，管理页与工作区共用。

- 理由：顶部栏在两个视图中都可见，`body` 级作用域能覆盖管理页、侧栏、工作区和弹层，避免继续维护 `.workspace.theme-dark` 与 `.shell.workspace-dark` 两套互相依赖的开关。
- 替代方案：继续在 `.workspace`/`.shell` 上加 class。缺点是管理页与工作区的祖先链不同，覆盖范围难以完整，且视图切换时需要重复判断。

### 2. 终端配色跟随主题

`terminal.options.theme` 准备深色与浅色两套配色，主题切换时更新 xterm 实例的 theme，并在下一帧重新 `fit()`。

- 理由：满足“效果应用到整体”；终端是窗口里面积最大的区域，固定深色会破坏浅色主题的一致性。
- 替代方案：终端始终使用深色配色。实现更少，但与“整体主题”要求冲突。

### 3. 主题选择沿用现有 localStorage key

继续使用 `claude-workbench-workspace-theme`（值为 `dark` 或不存在），不新增服务端配置，也不迁移旧数据。

- 理由：已有用户选择可直接生效，避免迁移逻辑；主题属于本机显示偏好，不需要跨设备同步。

### 4. 会话分组在前端渲染层完成

以规范化后的 `projectPath`（统一斜杠、去除尾部斜杠、转小写）作为分组 key；分组标题显示项目名与完整路径，组内按 `lastUsedAt` 倒序；保留每个会话行现有的 `data-session-id`、`data-remove-session` DOM 约定，使 `refreshSessionStatuses()` 与移除逻辑无需重写。

折叠状态存入 localStorage key `claude-workbench-collapsed-projects`，值为规范化路径数组；分组标题使用可聚焦按钮并维护 `aria-expanded`。新项目默认展开；移除会话后重新拉取列表，空分组自然消失。

- 理由：接口已经返回 `projectPath`，后端无需改动；保持既有 DOM 约定可以把改动限制在渲染函数内。
- 替代方案：服务端新增分组接口。需要改接口与数据结构，收益仅为少一次前端分组，不划算。

### 5. 使用 IFileOpenDialog（FOS_PICKFOLDERS）实现“打开”式文件夹选择

在 `selectWorkspaceFolder()` 中通过 PowerShell 内联 C#（`Add-Type`）调用 COM `IFileOpenDialog`，设置 `FOS_PICKFOLDERS`，标题设为“打开”，取回结果后仍以 UTF-8 Base64 输出，交给现有 `safeWorkspaceRoot()` 校验。现代对话框启动失败时，回退到现有 `FolderBrowserDialog`，保证功能可用。

- 理由：前端无法使用 Tauri IPC，服务端调用 Windows 原生对话框是改动最小的路径；`FOS_PICKFOLDERS` 是资源管理器风格“选择文件夹”的标准实现。
- 替代方案 A：Tauri dialog 插件。需要把 WebView 改为本地协议页面并改造前端通信，超出本次范围。
- 替代方案 B：`OpenFileDialog` 搭配 `ValidateNames=false` 的技巧。无法可靠返回所选文件夹，放弃。

## Risks / Trade-offs

- [管理页存在硬编码颜色，深色覆盖可能遗漏] → 逐页检查 `index.html` 内联样式与 `workstation.css` 中的固定色值，在 `body.theme-dark` 作用域下补齐关键组件；验收时逐页切换检查。
- [xterm 主题切换后尺寸/重绘异常] → 切换主题后在同一帧调用 `fit()`，并通过实际终端会话验证。
- [折叠状态 key 因路径大小写或尾斜杠不一致而失效] → 统一用规范化函数生成分组 key，读写折叠状态都使用同一 key。
- [现代文件夹对话框在缺少 PowerShell/COM 的环境失败] → 捕获失败并回退旧式对话框；仍失败时返回明确错误提示。
- [localStorage 在多窗口实例间不同步] → 当前应用为单窗口模型，接受该限制；不做跨窗口同步。

## Migration Plan

无数据迁移。旧的主题 localStorage key 继续有效；折叠状态 key 为新增，缺省时全部展开。回滚时还原本次改动的前端与服务端文件即可，不涉及存量数据。

## 实现要点

- 主题变量：`body.theme-dark` 覆盖 `--paper`、`--surface`、`--ink`、`--muted`、`--line`、`--soft`，并新增 `--chrome-bg`、`--hover-bg`、`--active-bg`、`--subtle-bg` 供 `index.html` 内联样式使用；浅色值定义在 `:root`。
- 主题按钮：放在顶部栏 `.top-actions` 内，保留 `id="toggleWorkspaceTheme"`，`aria-pressed` 与文案随状态更新。
- xterm：在 `applyWorkspaceTheme()` 中根据主题设置 `terminal.options.theme`，实例不存在时只记录状态，创建终端时应用。
- 会话分组：`sessionGroupKey()` 统一做斜杠归一、去尾斜杠和小写化；分组标题为可聚焦按钮并维护 `aria-expanded`；折叠状态读写同一 key。
- 文件夹选择器：PowerShell 脚本先 `Add-Type` 定义 `IFileOpenDialog` 与 `IShellItem` 的最小互操作声明，设置 `FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM` 和标题“打开”，通过 `SIGDN_FILESYSPATH` 取路径；外层捕获异常后执行旧式对话框作为回退。

## 测试策略

- 构建验证：运行 `npm run build`，确认无报错。
- 手工验收：运行 `npm run dev`，分别检查主题切换与持久化、管理页各子页面的深色覆盖、终端配色跟随；会话分组排序、折叠与持久化、打开/移除/状态刷新；文件夹选择窗口样式、“打开”按钮、选择与取消行为。
- 回归检查：管理页原有交互（表格、开关、抽屉）在深色下仍可读；工作区原有深色规则未被破坏。

## Open Questions

无。
