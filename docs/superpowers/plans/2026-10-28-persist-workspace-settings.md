---
change: persist-workspace-settings
design-doc: docs/openspec/changes/persist-workspace-settings/design.md
base-ref: 96740ca849eecd93133319d866b5c8bc1847b265
archived-with: 2026-10-28-persist-workspace-settings
---

# persist-workspace-settings 实施计划

<!-- comet-task-authority: docs/openspec/changes/persist-workspace-settings/tasks.md -->

## 1. 服务端设置存储

### 1.1 设置校验与合并模块

<!-- comet-task-ref:3dc461c6-fdb4-45b5-a609-73573f7b77d0 -->

- 新建 `server/workspace/preferences.mjs`：`PREFERENCE_FIELDS` 白名单（theme、terminalFontSize、projectPath、view、projectsExpanded、collapsedProjects、statusline、composerVisible、sessionsCollapsed、filesCollapsed、statuslineVisible、toolbarVisible、navCollapsed），`normalizePreferences(patch, current)` 返回 `{ preferences, ignored }` 或抛出可读错误。
- 验收：`node --test tests/workspace-preferences.test.mjs` 覆盖合法合并、未知字段忽略、非法类型/范围拒绝。

### 1.2 工作区数据读写

<!-- comet-task-ref:ab2859b1-7d4c-40e2-abc2-0d30aa25800b -->

- 在 `server/workspace/state.mjs` 增加 `readWorkspacePreferences()` 与 `writeWorkspacePreferences(patch)`，基于 `workspaceFile` 与 `atomicJson`，保留现有 projects/sessions 字段。
- 验收：扩展 `tests/workspace-state.test.mjs`，写入后重新读取一致，其他字段不丢。

### 1.3 设置路由

<!-- comet-task-ref:c2446ce1-d88b-4c77-af1d-a66ef879542e -->

- `GET_ROUTES` 增加 `/api/workspace/preferences`；`POST_ROUTES` 增加 `/api/workspace/preferences`，非法字段返回 400。
- 验收：`tests/server-routes.test.mjs` 覆盖读取空设置、合并写入、非法字段 400。

## 2. 前端设置加载与迁移

### 2.1 设置加载模块

<!-- comet-task-ref:c02c85ec-692b-48e1-8489-aa85c87966c0 -->

- 新建 `src/workspace/settings.mjs`：`loadWorkspaceSettings()` 读取服务端（1.5s 超时）、归一化、写 `localStorage` 缓存、应用到 `app`；`applyWorkspaceSettings()` 同步字段。
- 验收：`tests/workspace-settings.test.mjs` 以注入的 fetch 覆盖成功、超时、失败回退。

### 2.2 首次迁移

<!-- comet-task-ref:1b090d82-3447-4923-a999-4906c94d5ce7 -->

- `migrateLegacySettings()` 读取已知 localStorage 键，逐字段校验后 POST；服务端已有设置时跳过。
- 验收：单元测试覆盖迁移、已有设置不覆盖、写入失败保留本地值。

### 2.3 防抖写入

<!-- comet-task-ref:c1866fd0-ee97-4d5b-aa3d-1320c186a45f -->

- `saveWorkspaceSettings(patch)` 立即写本地缓存，300ms 防抖合并 POST；失败 toast 不阻断。
- 验收：单元测试覆盖连续修改只写一次、失败不影响返回。

### 2.4 启动顺序接入

<!-- comet-task-ref:0602c11f-0f66-4816-882c-c2746527f30b -->

- `src/workstation.js` 改为 `await loadWorkspaceSettings()` 后再 `setupWorkspace()`；失败提示。
- 验收：浏览器首屏主题与字号符合服务端设置。

## 3. 统一现有设置读写

### 3.1 视图与主题

<!-- comet-task-ref:3d593da1-c70a-4e41-8972-89007757a1b9 -->

- `init.mjs` 的 `setView`、侧栏折叠、项目展开改用 `app` 字段并调用 `saveWorkspaceSettings`；`state.mjs` 初值保留 localStorage 兜底。
- 验收：切换视图/折叠后刷新，状态保持。

### 3.2 字号、折叠项目与当前项目

<!-- comet-task-ref:5530cc21-4b40-451a-b820-588c415c1428 -->

- `preferences.mjs`、`projects.mjs`、`terminal.mjs` 的写入改为统一设置接口。
- 验收：重启后终端字号与当前项目恢复。

### 3.3 状态栏配置

<!-- comet-task-ref:c017342f-69c4-4790-b2be-a54dcfa2f442 -->

- `statusline.mjs` 的显示项与字号读写改走设置接口，保留配置面板。
- 验收：调整后重启配置一致。

## 4. 新增界面状态与显隐

### 4.1 输入区与侧栏折叠状态

<!-- comet-task-ref:f78c98f0-34d5-488f-80d8-d0c910d3ce20 -->

- `composer.mjs` 的 `toggleComposer`、`init.mjs` 的会话栏/文件栏折叠调用设置写入；启动时恢复类名与可见性。
- 验收：刷新与重启后状态一致。

### 4.2 显隐开关

<!-- comet-task-ref:090cf90d-6831-454e-a5d4-938657ed74cb -->

- 状态栏配置面板新增「显示状态栏」「显示工具栏」开关；`Ctrl+Shift+,` 打开面板。
- 验收：关闭后区域移除、重启保持隐藏、快捷键可恢复。

### 4.3 网格布局

<!-- comet-task-ref:94407745-aabb-40b8-909b-aa58d907b108 -->

- `terminal.css` 增加 `toolbar-hidden`/`statusline-hidden` 的行模板；`fitTerminal` 跟随重新适配。
- 验收：隐藏后终端高度变化且尺寸同步正确。

## 5. 验证

### 5.1 测试与构建

<!-- comet-task-ref:6e4b73e0-2227-4b84-90f1-6e4b5c90fd3b -->

- 验收：`npm test`、`npm run build` 退出码 0。

### 5.2 跨端口持久化

<!-- comet-task-ref:eaffb6c3-923e-4558-a2b9-ec4620a4f944 -->

- 验收：写入设置后以不同端口重启服务并打开页面，设置保持。

### 5.3 降级启动

<!-- comet-task-ref:b1759e8c-43ec-4d71-8d41-2994a4122ff1 -->

- 验收：设置接口不可用时页面用缓存启动并提示。
