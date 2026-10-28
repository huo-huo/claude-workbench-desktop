## Why

桌面端每次启动都用随机端口（`src-tauri/src/main.rs` 的 `bind(("127.0.0.1", 0))`），页面源地址随端口变化，而 `localStorage` 按「协议 + 主机 + 端口」隔离。结果是主题、终端字号、当前项目、视图、折叠状态、状态栏配置等设置每次重启全部丢失，用户会反复重新配置。需要把设置从源相关的 `localStorage` 迁移到与本机服务绑定的持久化存储。

## What Changes

- 新增 **工作区设置服务端存储**：在现有 `~/.claude/workbench-workspace.json` 中新增 `preferences` 字段，复用 `atomicJson` 原子写；新增 `GET/POST /api/workspace/preferences` 读写接口，带字段白名单与类型校验。
- 新增 **前端设置加载与迁移**：页面启动时先从服务端读取设置，应用到界面后再渲染；首次运行时把现有 `localStorage` 设置迁移到服务端；服务端不可用或读取失败时回退 `localStorage`，界面不中断。
- 统一 **现有 localStorage 设置的读写路径**：主题、终端字号、当前项目、视图、折叠项目、状态栏显示项与字号改由服务端设置驱动，`localStorage` 仅作为启动缓存与降级。
- 新增 **界面状态持久化**：输入区展开状态、会话栏折叠、文件栏折叠。
- 新增 **状态栏与工具栏显隐开关**：在状态栏配置面板中提供开关，持久化并在启动时恢复；默认均显示。
- 非目标：不修改 Tauri 启动端口与 Rust 层、不改会话/终端数据格式、不新增第三方依赖、不做跨设备同步。

## Capabilities

### New Capabilities

- `workspace-settings-persistence`: 工作区界面设置在桌面端跨端口、跨重启持久化，包括存储接口、启动加载、迁移、降级与界面状态覆盖范围。

### Modified Capabilities

<!-- 无：状态栏的数据来源、启用开关与模型切换行为不变，仅调整设置存储位置与新增显隐开关。 -->

## Impact

- 服务端：`server/workspace/state.mjs`、`server/routes/handlers.mjs`（设置读写路由）、`server/core/storage.mjs`（复用原子写）
- 前端：`src/workspace/state.mjs`（初始化来源）、`preferences.mjs`、`projects.mjs`、`statusline.mjs`、`init.mjs`、`composer.mjs`、`terminal.mjs`、`src/workstation.js`（启动顺序）
- 新增前端模块：设置加载/迁移/写入模块
- 测试：`tests/` 下设置校验与路由用例、迁移与降级用例
- 不新增依赖，不修改 Rust 层与 Claude CLI 协议
