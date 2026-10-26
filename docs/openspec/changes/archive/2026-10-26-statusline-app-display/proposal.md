# Proposal：statusLine 内容的软件原生显示（statusline-app-display）

## Why

用户在终端里的 Claude Code 通过 statusLine（claude-hud 插件）看到模型、上下文用量、todo、成本等关键状态，但这些内容只在 CLI 终端画面里渲染。Claude Workbench 的对话工作站把 CLI 跑在内嵌 xterm 中，状态信息被淹没在终端输出里，软件界面本身没有任何会话状态展示——用户需要在软件窗口里直接看到与 statusLine 一致的会话状态。

## What Changes

- 新增 **statusLine 代理包装器**：在软件中提供"启用/禁用"开关。启用时把 `~/.claude/settings.json` 的 `statusLine.command` 替换为包装器：先把 Claude Code 通过 stdin 传入的原始 JSON 转发给软件服务端，再原样执行原 statusLine 命令（终端内显示保持不变）；禁用时恢复原命令。
- 新增 **服务端状态接收与存储**：HTTP 接口接收包装器转发的 statusLine 输入 JSON，按 `session_id` 保存会话状态；软件未运行时包装器静默降级，不阻塞 statusLine 渲染。
- 新增 **状态补充解析**：转发 JSON 中不含 todo 与成本明细，服务端按 `session_id` 只读解析 `~/.claude/todos/` 与会话 transcript 补齐 todo 进度和成本。
- 新增 **前端状态查询与渲染**：新增状态查询 API；对话工作站底部 `terminal-footer` 升级为状态栏，显示当前激活会话的模型名、上下文用量、git 分支、todo 进度、成本，随会话切换更新。
- 不改变会话运行方式（仍为 CLI + pty 终端），不改变终端内 statusLine 的显示。

## Capabilities

### New Capabilities

- `statusline-status-bar`: statusLine 数据代理转发、会话状态存储与查询、软件底部状态栏渲染，以及包装器的启用/禁用与 fail-safe 行为。

### Modified Capabilities

（无——现有 4 个 capability 的需求均不变。）

## Impact

- **修改 `~/.claude/settings.json`**：启用状态栏时替换 `statusLine.command`（含恢复机制）；这是全局配置变更，需要明确的启用/禁用入口与失败恢复。
- **服务端**（`server/`）：新增 statusLine 上报接收路由、会话状态存储、状态查询 API、todos/transcript 补充解析。
- **前端**（`src/workspace/`）：`terminal-footer` 升级为状态栏组件，新增状态轮询/订阅与渲染逻辑。
- **新增包装器脚本**：随软件分发的独立脚本（读 stdin → 转发 → 透传执行原命令），必须 fail-safe。
- 不涉及 SDK 会话运行时、数据库 schema、公共 API 之外的接口变更。
