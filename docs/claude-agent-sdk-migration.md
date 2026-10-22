# Claude Agent SDK 迁移评估

本文记录 Claude Workbench 现有功能迁移到 `@anthropic-ai/claude-agent-sdk` 的评估结论，与
`docs/openspec/changes/add-claude-agent-sdk-foundation/design.md` 的「现有功能迁移评估」保持一致。

## 1. 结论摘要

- SDK 的定位是**结构化会话通道**，不是配置管理工具：会话执行、状态事件、中断、恢复等可由 SDK 承接；
  配置管理面、提示词工具、文件操作继续沿用现有实现。
- 迁移分四批推进，每批保留独立 API，可通过删除路由与依赖回滚，不影响终端会话。
- 本次（批次 1）只落地后端骨架与独立接口，前端界面与终端交互均未改动。

## 2. 功能矩阵

| 现有功能 | 当前实现 | SDK 替代方式 | 可替代性 | 建议批次 |
| --- | --- | --- | --- | --- |
| 会话执行 | `node-pty` 启动 TUI | `query()` + 流式输入 | 高 | 批次 2 |
| 运行/等待状态 | 解析 `projects/*.jsonl` | `SDKMessage` 事件（assistant/tool_use/tool_result/result） | 高 | 批次 1 |
| 中断会话 | PTY 写入 `Ctrl+C` | `Query.interrupt()` 或 `abortController` | 高 | 批次 1 |
| 会话恢复 | CLI `--resume` | `options.resume`、`forkSession` | 中高 | 批次 2 |
| 会话列表与历史 | 工作台记录 + jsonl | `listSessions()`、`getSessionMessages()` | 中高 | 批次 2 |
| 图片/附件输入 | 上传后向终端粘贴路径 | 流式输入中的 image content block | 中高 | 批次 3 |
| 权限确认 | TUI 内交互 | `canUseTool` 回调 + `permissionMode` | 中高 | 批次 3 |
| 渠道/模型切换 | 写全局 `settings.json` | 会话级 `env` 注入 | 中 | 批次 3 |
| MCP/hooks/agents | 读写配置文件 | `mcpServers`、`hooks`、`agents` 程序化注入 | 中 | 批次 4 |
| 配置管理面 | 直接读写配置文件与目录 | SDK 不提供管理接口，继续文件操作 | 低 | 保留 |
| 提示词润色、模型基准、卡片生成、技能翻译 | 直接 HTTP 调渠道模型 | 非 agent 任务，SDK 不适用 | 低 | 保留 |
| 文件树、文件操作、剪贴板、项目列表 | 工作区 API | 与 SDK 无关 | 无 | 保留 |

## 3. 批次划分与前置条件

### 批次 1（本次，已落地）

范围：后端骨架、健康检查、创建/发送/事件/中断/关闭、渠道 env 注入。

前置条件：

- 已安装 `@anthropic-ai/claude-agent-sdk` 依赖；
- 用户已安装 Claude Code（SDK 模式复用用户已安装的 CLI，安装包不附带原生 CLI）；
- 服务仅监听 `127.0.0.1`，写操作沿用 Origin/Host 校验。

### 批次 2

范围：前端接入 SDK 会话视图，运行状态与中断改用 SDK 事件，终端模式保留。

前置条件：

- 批次 1 的冒烟脚本在本地服务上以退出码 0 通过；
- 事件协议（`ready` / `event` / `error` / `exit`）稳定，前端可据此渲染状态；
- 明确 SDK 会话与终端会话在界面上的共存方式（入口、切换、关闭）。

### 批次 3

范围：会话列表/恢复、图片输入、权限弹窗、渠道会话级切换。

前置条件：

- 批次 2 的会话视图已上线并稳定；
- 确认 `options.resume` / `forkSession` 与终端会话记录的映射关系，避免 resume 正在终端中运行的会话；
- 确认流式输入中的 image content block 形态，以及 `canUseTool` 回调的交互模型；
- 权限弹窗通过安全评审，默认仍不启用 `bypassPermissions`。

### 批次 4

范围：MCP/hooks/agents 程序化注入，评估是否替代部分配置管理。

前置条件：

- 批次 3 稳定运行；
- 评估 SDK 注入与现有配置文件管理的一致性，避免同一配置出现两份来源。

## 4. 保留项与原因

| 保留项 | 原因 |
| --- | --- |
| 配置管理面（模型、hooks、skills、MCP、plugins 的读写与开关） | SDK 不提供管理接口，只能继续直接操作配置文件与目录；迁移不会降低复杂度。 |
| 提示词润色、模型基准、卡片生成、技能翻译 | 属于非 agent 的单轮 HTTP 调用，直接请求渠道模型更简单、成本更低，套用 SDK 反而增加运行时依赖。 |
| 文件树、文件操作、剪贴板、项目列表 | 与 SDK 无关的工作区 API，保持现状即可。 |
| 终端模式（`node-pty` + xterm） | 保留为默认交互方式；SDK 模式作为可选通道，SDK 故障不影响终端会话。 |

## 5. 本次已落地范围

### 5.1 健康检查

`GET /api/sdk/health`：SDK 可用返回 200，不可用返回 503，响应体包含 `available`、`sdkVersion`、
`runtimePath`、`runtimeSource`、`nodeVersion`、`error`。

运行时解析顺序：

1. `CLAUDE_WORKBENCH_SDK_EXECUTABLE`（显式覆盖，必须是 `claude.exe`）；
2. 用户已安装的 `claude.exe`（WinGet 等安装方式，`where.exe claude` 可直接找到）；
3. npm 全局安装：合并 `where.exe claude` 与 `where.exe claude.cmd` 的输出，过滤空行并按路径大小写不敏感去重后，对每个 `claude.cmd` 所在目录推导
   `<目录>/node_modules/@anthropic-ai/claude-code/bin/claude.exe`，取第一个存在的文件；探测成功的结果会缓存在进程内，避免每次健康检查都执行 `where.exe`；
4. SDK 平台包自带运行时（仅开发树或未裁剪的 `node_modules` 有效）。

npm 全局安装只生成 `claude.cmd` / `claude.ps1`，不能直接交给 SDK（无 shell spawn 会报 `EINVAL`），因此必须使用包内真实的 `claude.exe`。
生产安装包不包含 SDK 平台包的原生 CLI，因此未安装 Claude Code 且未设置覆盖变量时，健康检查返回不可用并提示安装。

### 5.2 会话接口与事件流

| 方法与路径 | 说明 | 成功状态 |
| --- | --- | --- |
| `POST /api/sdk/sessions` | 创建会话，返回 `id` 与 `eventUrl` | 201 |
| `POST /api/sdk/sessions/message` | 发送提示词 | 202 |
| `POST /api/sdk/sessions/interrupt` | 中断会话 | 200 |
| `POST /api/sdk/sessions/close` | 关闭会话（幂等） | 200 |
| `GET /api/sdk/events?session=<id>`（WebSocket 升级） | 订阅会话事件 | 101 |

事件消息统一为 `{ type: 'event', sessionId, eventType, event }`；订阅时先收到 `ready`（含当前状态与回放条数），
随后回放最近事件，再推送实时事件。每个会话保留最近 100 条事件。

### 5.3 渠道 env 注入

从工作台渠道状态构造会话级 `env` 增量（`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、各模型槽位变量等），
与 `process.env` 合并后传给 SDK 会话。该注入只作用于当次会话，**不改写** `~/.claude/settings.json`，
终端会话继续沿用全局设置。

### 5.4 独立会话记录

SDK 会话记录写入 `~/.claude/workbench-sdk-sessions.json`，与终端会话使用的
`~/.claude/workbench-workspace.json` 完全分离，不改变现有文件结构。记录采用临时文件 + rename 原子写入，
最多保留 200 条。

### 5.5 打包体积

安装包不再分发 SDK 平台包的原生 CLI（约 283.6 MB），打包产物约 7.9 MB。代价是 SDK 模式依赖用户自行安装
Claude Code；未安装时 SDK 接口返回不可用，终端模式不受影响。

## 6. 验证方式

- 单元测试：`npm test`，覆盖渠道环境构造、运行时解析、会话状态转换、输入队列、事件回放等。
- 冒烟脚本：

  ```powershell
  $env:CLAUDE_WORKBENCH_PORT = "4199"
  node server.mjs
  node scripts/sdk-smoke.mjs --base http://127.0.0.1:4199
  ```

  `--health-only` 仅验证运行时可用性，适合无凭据环境；真实会话因凭据或网络失败时脚本以退出码 1 报告，不会吞掉错误。
- 回归：现有 `/api/workspace/*` 与终端 WebSocket 行为不变。
