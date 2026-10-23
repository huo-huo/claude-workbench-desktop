## Why

当前工作台有三处体验不一致：深色主题按钮藏在终端工具栏，只对对话工作站生效，管理页无法切换；会话列表把所有项目的会话平铺在一起，项目一多就难以查找；添加项目文件夹时弹出的是 Windows 旧式“浏览文件夹”树形对话框，与系统“打开”对话框的交互不一致。这些问题影响日常使用效率，适合在一次界面优化中集中解决。

## What Changes

- 将深色主题切换按钮从终端工具栏移到全局顶部栏，按钮对管理页和对话工作站都可见。
- 深浅主题作用于整个应用窗口，包括管理页各页面与工作站的侧栏、终端、文件栏；用户选择持久化到本机，重启后保持。
- 会话列表改为按项目目录分组展示，每个分组显示项目名称与路径，分组标题可点击折叠/展开，折叠状态持久化。
- 添加项目文件夹时改用系统“打开”式文件夹选择对话框（资源管理器风格），替代旧式“浏览文件夹”对话框。
- `/api/workspace/select-folder` 的请求与返回结构保持不变，仅替换对话框实现，前端调用方式不变。

## Capabilities

### New Capabilities

- `global-appearance-theme`: 全局深浅主题的切换入口、作用范围与持久化行为。
- `session-project-grouping`: 会话记录按项目目录分组展示及分组折叠状态的管理行为。
- `native-folder-picker`: 通过系统原生“打开”式对话框选择项目文件夹的行为。

### Modified Capabilities

无。项目尚无既有 specs，本次三个能力均为新增。

## Impact

- 前端：`index.html`（顶部栏按钮位置）、`src/workstation.js`（主题应用、会话分组渲染、折叠状态）、`src/workstation.css`（全局主题变量与分组样式）。
- 服务端：`server.mjs` 的 `selectWorkspaceFolder()` 对话框实现。
- 接口：`/api/workspace/select-folder` 契约不变；无会话数据结构变更。
- 依赖：不新增 npm 或 Rust 依赖，不改造 Tauri 外壳。
