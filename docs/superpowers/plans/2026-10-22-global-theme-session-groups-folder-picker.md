---
change: global-theme-session-groups-folder-picker
design-doc: docs/openspec/changes/global-theme-session-groups-folder-picker/design.md
base-ref: abed933de7b5c595eb020b7aa0ab13653ebe54ee
archived-with: 2026-10-23-global-theme-session-groups-folder-picker
---

<!-- comet-task-authority: docs/openspec/changes/global-theme-session-groups-folder-picker/tasks.md -->

# 实施计划：全局主题 / 会话分组 / 系统文件夹选择器

执行方式：subagent-driven-development（TDD: direct，review: standard）
子代理分工：实现代理负责各工作包，独立审查者复查 diff。

## 目标

三个能力均为既有代码上的有界改动，不新增依赖、不改接口契约：

1. 全局深浅主题（`global-appearance-theme`）
2. 会话按项目分组 + 可折叠 + 持久化（`session-project-grouping`）
3. 系统“打开”式文件夹选择器（`native-folder-picker`）

## 工作包与任务映射

### 工作包 A：全局主题

<!-- comet-task-ref:8d75b70f-8ee7-4c0a-bba3-9065e615205a -->
- A1. `#toggleWorkspaceTheme` 从终端工具栏移到顶部栏 `.top-actions`，两个视图共用，终端工具栏移除重复按钮。

<!-- comet-task-ref:55e08f54-3ffe-4630-b2bd-3505fd037766 -->
- A2. `applyWorkspaceTheme()` 同时切换 `document.body`、`.workspace`、`.shell` 的 class；`workstation.css` 增加 `body.theme-dark` 变量覆盖，并把 `index.html` 内联样式的硬编码背景色（约 15 处）改为语义变量 `--chrome-bg`/`--hover-bg`/`--active-bg`/`--subtle-bg` 等。

<!-- comet-task-ref:a1ffb674-0a6c-438d-b116-06a0a3ae2781 -->
- A3. xterm 深/浅两套 theme，切换时更新 `terminal.options.theme` 并 `fit()`；实例未创建时只记状态。

<!-- comet-task-ref:ac0f0eaa-2464-4e9a-b92b-021c632b634b -->
- A4. 持久化沿用 `claude-workbench-workspace-theme`，启动时恢复；清 key 默认浅色。

<!-- comet-task-ref:8d84ae17-e430-49f6-acfb-3a45fc86b69d -->
- A5. 按钮 `aria-pressed` 与文案随主题更新。

验收：`npm run build` 通过；`npm run dev` 下管理页各子页 + 工作区无残留浅色面板，重启保持。

### 工作包 B：会话分组

<!-- comet-task-ref:5ad6f49d-c136-45b5-aa71-ae44024ffbf3 -->
- B1. 新增 `sessionGroupKey()`（统一斜杠、去尾斜杠、小写化），`refreshSessions()` 按分组渲染：分组标题（项目名 + 路径），组内按 `lastUsedAt` 倒序。
<!-- comet-task-ref:25c4b01c-1606-40cd-af86-9ce60e3af1e9 -->
- B2. 分组标题可点击折叠/展开，折叠状态写入 `claude-workbench-collapsed-projects`；按键可聚焦并维护 `aria-expanded`；新项目默认展开。
<!-- comet-task-ref:686b8513-dcc1-4477-8bd1-76dbea6b05d7 -->
- B3. 保留 `data-session-id`、`data-remove-session` DOM 约定；打开/移除/状态刷新继续工作，移除后空分组消失。

验收：构造两个项目会话分组正确；折叠后刷新与重启保持；移除后空分组消失。

### 工作包 C：系统文件夹选择器

<!-- comet-task-ref:c8424226-73ec-456d-8a42-ca0e2c68147c -->
- C1. `selectWorkspaceFolder()` 用 PowerShell 内联 C# 调用 COM `IFileOpenDialog`（`FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM`，标题“打开”），Base64 UTF-8 返回并走 `safeWorkspaceRoot()`。
<!-- comet-task-ref:d2056bec-bcbd-4313-ae03-3a3400dbb950 -->
- C2. 现代对话框失败回退 `FolderBrowserDialog`；都失败返回明确错误。
<!-- comet-task-ref:0c198392-b0da-4fdf-aa91-b2bcebf6a3c7 -->
- C3. `/api/workspace/select-folder` 契约不变，选择/取消行为正确。

验收：弹出资源管理器风格“打开”式窗口；选择加入项目并激活，取消不变更。

### 工作包 D：集成验证

<!-- comet-task-ref:4bc5cb8e-c65d-4f1c-87ad-25d9abe3f047 -->
- D1. `npm run build` recorded as build evidence.
<!-- comet-task-ref:9d7c1b98-a38a-44fd-b8a1-26156164de16 -->
- D2. 手工验收三组能力场景。

## 依赖与顺序

A、B、C 相互独立，可并行；D 依赖 A/B/C 完成且 build 通过。

## 验证命令

```bash
npm run build
npm run dev   # 手工验收
```

## 注意

- 不改 `server.mjs` 中与本次无关的 claude.exe 回退改动（属用户未提交改动，不纳入本次提交）。
- 无前端测试框架，采用 direct 模式，以构建 + 手工验收 + 独立 diff 审查为准。
