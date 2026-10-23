# Brainstorm Summary

- Change: global-theme-session-groups-folder-picker
- Date: 2026-10-22

## 确认的技术方案

1. 全局主题：主题按钮移入顶部栏 `.top-actions`；`applyWorkspaceTheme()` 同时切换 `document.body`、`.workspace`、`.shell` 的 class；在 `workstation.css` 增加 `body.theme-dark` 变量覆盖，并把 `index.html` 内联样式的硬编码背景色改为语义变量；xterm 使用深/浅两套 theme 并随主题切换；持久化沿用 `claude-workbench-workspace-theme`。
2. 会话分组：前端新增 projectPath 规范化函数，`refreshSessions()` 按分组聚合渲染；分组标题显示项目名与路径，组内按 `lastUsedAt` 倒序；折叠状态写入 `claude-workbench-collapsed-projects`；保留 `data-session-id`、`data-remove-session` DOM 约定。
3. 文件夹选择器：`selectWorkspaceFolder()` 改用 PowerShell 内联 C# 调用 COM `IFileOpenDialog`（`FOS_PICKFOLDERS`，标题“打开”），仍以 Base64 UTF-8 返回并走 `safeWorkspaceRoot()` 校验；失败时回退 `FolderBrowserDialog`；接口契约不变。

## 关键取舍与风险

- 硬编码颜色变量化会触及 `index.html` 约 15 处样式声明，是管理页完整深色化的必要条件。
- 终端配色跟随主题（而非固定深色），以满足“整体主题”；用户确认该取舍。
- `IFileOpenDialog` 首次调用可能因 PowerShell 编译内联 C# 产生 1–2 秒延迟；失败回退旧对话框。
- 折叠 key 与分组 key 必须使用同一规范化规则，避免大小写/尾斜杠导致状态失效。
- 管理页深色覆盖可能遗漏个别组件，需逐页验收。

## 测试策略

- `npm run build` 验证构建。
- `npm run dev` 手工验收：主题切换与重载/重启保持、管理页与工作区无残留浅色面板、终端配色跟随；会话分组排序、折叠与重启保持、打开/移除/状态刷新正常；文件夹选择器弹出“打开”式对话框，选择与取消行为正确。

## Spec Patch

无。
