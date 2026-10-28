---
comet_change: persist-workspace-settings
role: technical-design
canonical_spec: openspec
archived-with: 2026-10-28-persist-workspace-settings
status: final
---

## Context

桌面端随机端口导致 `localStorage` 源隔离（见 `proposal.md`）。现有工作区数据已集中在 `~/.claude/workbench-workspace.json`，由 `server/workspace/state.mjs` 读取、`server/core/storage.mjs` 的 `atomicJson` 原子写入；前端设置分散在 `src/workspace/state.mjs`、`preferences.mjs`、`projects.mjs`、`statusline.mjs`、`init.mjs`、`composer.mjs`、`terminal.mjs` 中直接读写 `localStorage`。行为要求见 `specs/workspace-settings-persistence/spec.md`。

## Goals / Non-Goals

**Goals:**

- 设置与本机服务绑定，跨端口、跨重启生效；改动集中在现有数据文件与前端启动流程。
- 服务端不可用时仍能启动，`localStorage` 作为缓存与降级来源。

**Non-Goals:**

- 不修改 Rust 启动层与端口策略；不引入新依赖；不做跨设备同步；不改会话与终端数据格式。

## Decisions

### 1. 存储：复用工作区数据文件的 `preferences` 字段

在 `workbench-workspace.json` 中新增 `preferences` 对象，与 `projects`/`sessions` 并列，复用 `atomicJson`。选择复用现有文件而不是新建文件，是因为它已经承载工作区状态、已有原子写与测试辅助（`setWorkspaceFileForTest`），可避免新增路径与迁移。

- 备选：独立 `workbench-preferences.json`——需要新增文件生命周期与清理逻辑，收益不足。

### 2. 接口：新增设置读写路由与独立校验模块

新增 `server/workspace/preferences.mjs`，提供纯函数 `normalizePreferences(patch, current)`：字段白名单、类型与范围校验、未知字段忽略、非法字段返回错误。路由为 `GET /api/workspace/preferences` 与 `POST /api/workspace/preferences`（部分合并）。选择 POST 合并写入而不是整对象覆盖，是为了避免多窗口或并发写入互相覆盖未修改字段。

- 备选：前端整对象 PUT——并发时容易丢字段，否决。

### 3. 启动顺序：先加载设置，再渲染工作区

新增 `src/workspace/settings.mjs`，在 `src/workstation.js` 中先 `await loadWorkspaceSettings()`，再调用 `setupWorkspace()`。加载流程：读取服务端 → 成功则应用到 `app` 与 `localStorage` 缓存；服务端为空则执行一次性迁移；失败则回退缓存。读取设置 1.5 秒超时。

- 备选：先渲染再用服务端值覆盖——会出现主题/布局闪变，否决。
- `state.mjs` 初值仍从 `localStorage` 读取，保证降级可用；加载完成后由 `applyWorkspaceSettings()` 统一覆盖 `app` 字段。`init.mjs`、`preferences.mjs`、`projects.mjs` 改为读写 `app` 与 `settings` 模块，而不是直接读 `localStorage` 字符串键。

### 4. 变更即存：合并写入并保留本地缓存

设置变更通过 `saveWorkspaceSettings(patch)` 写入：先立即更新 `localStorage` 缓存，再用 300ms 防抖合并为一次 POST（复用 `terminal-scheduler.mjs` 的 `createDebouncer`）。失败时提示但不回滚界面。选择防抖是因为字号连续点击与折叠切换会高频触发。

### 5. 新增状态与显隐

`app` 新增 `composerVisible`（已有）、`sessionsCollapsed`、`filesCollapsed`、`statuslineVisible`、`toolbarVisible`，统一纳入 `preferences`。显隐开关放在现有状态栏配置面板，默认显示；通过 `.terminal-column` 的类调整 `grid-template-rows`，隐藏对应行。由于状态栏与工具栏可能同时隐藏、配置入口随之消失，增加全局快捷键 `Ctrl+Shift+,` 打开配置面板作为恢复入口；快捷键在输入区与终端焦点下均生效，但只在面板关闭时触发。

## 测试策略

- 单元测试：`normalizePreferences` 的合法合并、未知字段忽略、非法字段拒绝；迁移映射；防抖写入；缓存降级。
- 路由测试：读取空设置、合并写入、非法字段返回 400、原子落盘后重新读取一致。
- 端到端：写入设置后换端口重启服务并打开页面，确认主题、字号、状态栏配置与显隐状态保持；禁用设置接口后确认使用缓存启动并提示。


## Risks / Trade-offs

- [启动等待设置读取增加首屏延迟] → 本地回环请求通常很快，设置 1.5 秒超时并回退缓存。
- [多窗口并发写入] → 服务端按字段合并 + 原子写，降低互相覆盖；不做实时同步。
- [旧 `localStorage` 数据格式不一致] → 迁移时逐字段校验，无法识别的字段跳过并记录，不阻塞启动。
- [隐藏工具栏后无法操作恢复] → 恢复入口保留在状态栏配置面板，并提供 `Ctrl+Shift+,` 快捷键；两者同时隐藏时仍能打开面板。
- [`localStorage` 缓存与服务端不一致] → 启动以服务端为准；仅在服务端不可用时使用缓存。

## Migration Plan

1. 上线后首次启动：服务端无 `preferences` → 迁移 `localStorage` 中可识别字段。
2. 迁移成功后 `localStorage` 继续作为缓存，不再作为权威来源。
3. 回滚：删除 `preferences` 字段或回退版本，旧 `localStorage` 值仍在，界面可正常启动。

## Open Questions

无。
