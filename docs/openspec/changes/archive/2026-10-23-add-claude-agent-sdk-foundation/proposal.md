## Why

当前所有 Claude 会话都通过 node-pty 启动 Claude Code 交互式 TUI，本地服务只能拿到原始终端字节流。工作/等待状态、工具调用、hook 与 skill 使用情况需要解析 `~/.claude/projects/*.jsonl` 间接推断，逻辑脆弱，也无法支撑结构化界面。Claude Agent SDK 提供官方编程接口，可直接获得结构化消息和会话生命周期控制。先接入最小骨架并完成迁移评估，可以在不破坏现有终端体验的前提下验证 SDK 能力，避免一次性重构的风险。

## What Changes

- 新增依赖 `@anthropic-ai/claude-agent-sdk`，在本地 Node 服务中增加 SDK 运行时模块。
- 新增 SDK 会话能力：运行时健康检查、创建会话、发送提示词、接收结构化事件流、中断、关闭。
- 新增独立的 `/api/sdk/*` HTTP 与 WebSocket 接口，现有 `/api/workspace/*` 接口行为保持不变。
- SDK 会话沿用现有本地配置与自定义渠道：读取 `~/.claude` 设置，并把当前渠道的 base URL、密钥与模型变量注入 SDK 会话环境。
- 保留 node-pty + xterm 终端会话，与 SDK 会话双模式并存；本次不修改前端会话界面。
- 交付迁移评估：给出「现有功能 → SDK 可替代性」矩阵、风险与分批迁移建议。

## Capabilities

### New Capabilities
- `claude-agent-sdk-runtime`: 定义 SDK 运行时的健康检查、结构化会话生命周期（创建、发送、事件流、中断、关闭）以及本地配置与渠道注入行为。

### Modified Capabilities
<!-- 无：现有终端会话与工作区接口的行为要求不变。 -->

## Impact

- 依赖：`package.json` 新增 `@anthropic-ai/claude-agent-sdk`（解包约 4.8 MB，要求 Node >= 18，当前项目要求 20.19+/22.12+ 已满足）。
- 代码：`server.mjs` 新增 SDK 模块与路由；`scripts/prepare-desktop-resources.mjs` 与 Tauri 打包资源范围需要在设计阶段确认。
- 接口：仅新增 `/api/sdk/*` 与对应 WebSocket 通道，现有接口与终端会话不受影响。
- 运行时：SDK 默认使用自带 Claude Code 运行时，可通过 `pathToClaudeCodeExecutable` 指向用户已安装的 CLI，具体取舍在设计阶段确定。
- 文档：README 安装说明与迁移评估结论需要同步更新。
