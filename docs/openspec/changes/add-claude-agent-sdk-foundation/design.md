---
comet_change: add-claude-agent-sdk-foundation
role: technical-design
canonical_spec: openspec
---

## Context

- 本地服务 `server.mjs` 是单文件 Node 进程，同时承担工作区文件操作、Claude 配置管理、渠道管理和终端会话。终端会话通过 `node-pty` 启动 `claude.exe`，再把 PTY 字节流经 WebSocket 透传给前端 xterm。
- 会话记录保存在 `~/.claude/workbench-workspace.json`；运行状态与 skill/MCP 使用情况来自解析 `~/.claude/projects/*.jsonl`。
- 渠道连接信息当前由 `activateChannel` 写入全局 `~/.claude/settings.json` 的 `env`（`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL` 及各模型槽位变量）。
- `@anthropic-ai/claude-agent-sdk`（当前 0.3.308）提供 `query({ prompt, options })`，以异步迭代方式返回结构化的 `SDKMessage`；`Options` 支持 `cwd`、`env`、`resume`、`forkSession`、`settingSources`、`mcpServers`、`hooks`、`agents`、`permissionMode`、`canUseTool`、`pathToClaudeCodeExecutable`、`includePartialMessages`。SDK 另提供 `listSessions()` 与 `getSessionMessages()` 读取磁盘会话。
- 安全约束沿用现状：服务仅监听 `127.0.0.1`，写操作校验 `Origin` 与 `Host` 一致。

## Goals / Non-Goals

**Goals:**

- 在本地服务内提供可独立验证的 SDK 运行时：健康检查、创建会话、发送提示词、结构化事件流、中断、关闭。
- SDK 会话与终端会话完全隔离，任何 SDK 故障都不影响现有功能。
- 明确现有功能迁移到 SDK 的分批路径与每批的前置条件。

**Non-Goals:**

- 不新增前端 SDK 会话界面，不修改 `src/workstation.js` 的会话交互。
- 不移除 node-pty、xterm 或现有终端会话接口。
- 不改造配置管理面（模型、hooks、skills、MCP、plugins 的读写与开关）。
- 不实现权限确认 UI；本次使用保守的权限模式。

## Decisions

### 1. 新增独立模块 `sdk-runtime.mjs`，`server.mjs` 只负责挂载路由

SDK 生命周期、事件分发、渠道环境构造集中在独立模块，`server.mjs` 增加 `/api/sdk/*` 路由与 WebSocket 升级分支。
备选：直接写进 `server.mjs`。否决原因：该文件已超过 2200 行，继续内聚会放大维护成本，且 SDK 需要可独立测试。
SDK 采用动态 `import()` 加载，加载失败只让健康检查返回不可用，不影响服务启动与终端会话。

### 2. 传输方式：HTTP 负责命令，WebSocket 负责事件流

创建/发送/中断/关闭走 HTTP，事件流复用现有 `ws` 依赖与升级校验。
备选：SSE。否决原因：现有栈已有 WebSocketServer，且中断与多订阅复用同一通道更直接。
事件消息统一为 `{ type, sessionId, eventType, event }`；SDK 原始消息保留在 `event` 字段，`eventType` 取 SDK 消息的 `type`（有 `subtype` 时拼接），不二次解析正文。

### 3. 运行时解析顺序：env 覆盖 → 用户 CLI → 开发树 bundled

生产安装包**不包含** SDK 平台包的原生 CLI（`@anthropic-ai/claude-agent-sdk-win32-x64`，约 283.6 MB）。运行时解析顺序为：`CLAUDE_WORKBENCH_SDK_EXECUTABLE`（必须是 `claude.exe`）→ `claudeInstallInfo()` 定位到的用户已安装 `claude.exe` → `bundled`（仅开发树或未裁剪的 `node_modules` 有效）。生产环境两者都缺失时，健康检查返回不可用并提示安装 Claude Code。

`env` 分支不能只判断路径存在：SDK 以无 shell 的 `spawn` 启动该路径，npm 安装产生的 `claude.cmd` / `claude.ps1` 会直接 `EINVAL`。因此该分支要求路径存在、是文件且扩展名为 `.exe`，否则健康检查直接判定不可用，避免先返回可用、创建会话时才失败。

备选：只用 SDK 自带运行时。否决原因：用户已安装的 CLI 版本与其渠道配置、插件状态更一致；显式暴露路径也便于排错。
备选：随安装包分发原生 CLI。否决原因：安装包体积增加约 283.6 MB。

### 4. 配置加载：显式声明 `settingSources`

使用 `settingSources: ['user', 'project', 'local']`，与 CLI 读取顺序一致，保证 skills、hooks、MCP、CLAUDE.md 行为接近终端模式。
备选：不加载文件系统配置（SDK 默认）。否决原因：会与现有工作台配置管理产生割裂。

### 5. 渠道注入：会话级 `env`，不改写全局设置

从 `workbench-state.json` 读取当前激活渠道与模型槽位，经 DPAPI 解密密钥，构造 `env` 传入 SDK 选项。该注入只作用于当次 SDK 会话；终端会话继续沿用全局 `settings.json`。
备选：继续依赖全局设置文件。否决原因：会让 SDK 会话与终端会话互相覆盖渠道，且违背“双模式并存”的隔离要求。

### 6. 会话记录独立存储

新增 `~/.claude/workbench-sdk-sessions.json` 保存 SDK 会话标识、项目路径、状态与时间。不修改现有 `workbench-workspace.json` 结构。
备选：在现有文件中增加 `kind` 字段。否决原因：会改变现有文件结构，影响既有终端会话读取逻辑。

### 7. 权限与安全默认保守

新建 SDK 会话默认使用 `default` 权限模式，不启用 `bypassPermissions`；项目路径必须通过现有 `safeWorkspaceRoot()` 校验。关闭会话或服务退出时调用 `abortController.abort()` 并清理运行时进程。

## 实现方案

### 模块边界与依赖注入

`sdk-runtime.mjs` 导出 `createSdkRuntime({ resolveProject, resolveExecutable, buildChannelEnv, sessionFile })`，返回以下方法：

- `health()`：返回 `{ available, sdkVersion, runtimePath, runtimeSource, nodeVersion, error }`
- `createSession({ projectPath, prompt, model, permissionMode })`：校验路径、解析运行时、启动 `query()`，返回会话摘要
- `send(id, prompt)`、`interrupt(id)`、`close(id)`、`get(id)`
- `subscribe(id, listener)`：先回放缓冲，再注册新事件，返回取消订阅函数
- `shutdown()`：关闭全部会话，供服务退出时调用

`server.mjs` 通过回调注入现有能力：`resolveProject` 包装 `recordWorkspaceProject` 与 `safeWorkspaceRoot`，`resolveExecutable` 包装 `claudeInstallInfo`，`buildChannelEnv` 包装 `channelState`、`channelApiKey` 与 DPAPI 解密。`sdk-runtime.mjs` 不反向导入 `server.mjs`，避免循环依赖并便于单测。

### 会话状态机

```
starting ──init──> running ──result──> idle ──send──> running
    │                 │                 │
    └─────error───────┴─────────────────┴──────────> failed
    └──────────────close / shutdown────────────────> closed
```

- `interrupt`：仅 `running` 状态调用 `query.interrupt()`；`idle`、`closed` 状态直接返回成功但无动作。
- `close`：关闭输入队列、调用 `abortController.abort()`、清空订阅者、状态置 `closed`，并原子写入会话记录。
- 每个会话独立 `AbortController`；服务退出时统一 `shutdown()`。

### 输入队列

自实现异步迭代器：`push()` 写入并唤醒等待的 `next()`，`close()` 让 `next()` 返回 `done`。发送的消息遵循 SDK 流式输入结构 `{ type: 'user', session_id: '', message: { role: 'user', content }, parent_tool_use_id: null }`，`session_id` 由 SDK 回填。状态为 `closed` 时发送返回 409。

### 事件协议

- 每个会话保留最近 100 条事件；订阅时先发送 `ready`（含 `status` 与 `replay` 条数），再回放缓冲，随后推送新事件。
- 消息格式：`{ type: 'ready'|'event'|'error'|'exit', sessionId, ... }`；`event` 消息附带 `eventType` 与原始 `event`。
- WebSocket 仅接受 `/api/sdk/events?session=<id>`；未知会话或已关闭会话直接拒绝升级，不影响其他订阅者。

### HTTP 契约

| 方法与路径 | 请求体 | 成功 | 主要错误 |
| --- | --- | --- | --- |
| `GET /api/sdk/health` | 无 | 200 健康信息 | 503 SDK 不可用 |
| `POST /api/sdk/sessions` | `projectPath`、可选 `prompt`/`model`/`permissionMode` | 201 会话摘要与 `eventUrl` | 400 路径无效、503 不可用 |
| `POST /api/sdk/sessions/message` | `id`、`prompt` | 202 | 404 不存在、409 已关闭 |
| `POST /api/sdk/sessions/interrupt` | `id` | 200 | 404 不存在 |
| `POST /api/sdk/sessions/close` | `id` | 200 | 404 不存在 |

### 渠道环境构造

`buildChannelEnv()` 为纯函数：读取当前激活渠道与模型槽位，解密密钥后返回环境增量；无渠道时返回空对象。键沿用现有渠道映射：`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_OPUS_MODEL`、`ANTHROPIC_DEFAULT_SONNET_MODEL`、`ANTHROPIC_DEFAULT_HAIKU_MODEL`、`CLAUDE_CODE_SUBAGENT_MODEL`、`CLAUDE_WORKBENCH_VISION_MODEL`。SDK 会话使用 `{ ...process.env, ...channelEnv }`，不触碰 `~/.claude/settings.json`。

### 运行时解析

顺序为：`CLAUDE_WORKBENCH_SDK_EXECUTABLE`（显式覆盖，必须是 `claude.exe`；路径不存在、不是文件或扩展名不是 `.exe` 均判定不可用）→ `claudeInstallInfo().executable`（用户已安装的 `claude.exe`）→ `bundled`（不传 `pathToClaudeCodeExecutable`，交给 SDK 平台包解析）。生产安装包不包含 SDK 平台包，`bundled` 仅在开发树或未裁剪的 `node_modules` 中有效；健康检查在 `bundled` 源上会探测原生 CLI 是否存在，因此开发树与安装包可能给出不同结论。生产环境两者都缺失时返回不可用并提示安装 Claude Code。健康检查返回 `runtimeSource` 为 `env`、`installed` 或 `bundled`，以及实际使用的路径。

### SDK 选项

`cwd` 为项目根；`settingSources: ['user', 'project', 'local']`；`systemPrompt: { type: 'preset', preset: 'claude_code' }`；`permissionMode` 默认 `default`；`canUseTool` 仅放行 `Read`、`Glob`、`Grep`，其余返回 `deny` 并附原因；`includePartialMessages: false`，避免无 UI 场景产生大量增量事件。

## 测试策略

- 单元测试：使用 Node 内置 `node:test`，测试文件 `tests/sdk-runtime.test.mjs`，覆盖渠道环境构造（有/无渠道）、运行时解析三个分支、会话状态转换、输入队列关闭、事件缓冲回放；新增 `npm test` 脚本执行 `node --test tests/`。
- 集成冒烟：`scripts/sdk-smoke.mjs` 按健康检查 → 创建 → 订阅 → 发送 → 收到 result → 中断的顺序验证，无凭据时支持 `--health-only` 只验证运行时。
- 回归验证：现有终端会话创建、WebSocket 输入、中断接口在改动前后行为一致。

## 边界条件

- SDK 依赖缺失或运行时无效：SDK 路由统一 503，`/api/state` 与终端接口不受影响。
- 未登记或越界项目路径：400，且不启动运行时进程。
- 重复关闭：幂等返回成功，不重复写记录。
- 中断已结束会话：返回成功但不产生额外事件。
- 订阅已关闭会话：拒绝升级。
- 并发多会话：各自独立 `AbortController` 与事件缓冲。
- 事件体积：沿用现有 WebSocket `maxPayload` 8 MB。
- 记录文件损坏：按空记录回退，不阻断创建。
- 服务退出：统一 `shutdown()`，避免子进程残留。

## 现有功能迁移评估

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

批次划分：

- 批次 1（本次）：后端骨架、健康检查、创建/发送/事件/中断/关闭、渠道注入。
- 批次 2：前端接入 SDK 会话视图，状态与中断改用 SDK 事件，终端模式保留。
- 批次 3：会话列表/恢复、图片输入、权限弹窗、渠道会话级切换。
- 批次 4：MCP/hooks/agents 程序化注入，评估是否替代部分配置管理。

## Risks / Trade-offs

- [打包遗漏] Tauri 打包脚本只复制已知资源，SDK 依赖可能未进入安装包 → 在设计验证阶段用 `npm run desktop:build` 产物检查 `server.mjs` 同级 `node_modules` 是否包含 SDK，必要时更新 `prepare-desktop-resources.mjs`。
- [版本漂移] SDK 与用户 CLI 版本不一致导致行为差异 → 固定 SDK 版本，健康检查暴露两端版本；提供 `CLAUDE_WORKBENCH_SDK_EXECUTABLE` 覆盖入口。
- [安装包体积与外部依赖] 安装包不再分发 SDK 平台包原生 CLI，体积从约 291.5 MB 降至约 7.9 MB，代价是 SDK 模式依赖用户自行安装 Claude Code → 未安装且未设置 `CLAUDE_WORKBENCH_SDK_EXECUTABLE` 时健康检查返回不可用并提示安装；终端模式不受影响，README 的安装前置说明需保持准确。
- [渠道兼容] 自定义渠道必须是 Anthropic Messages 协议 → 沿用现有 `activateChannel` 的协议校验，冒烟测试覆盖“有渠道/无渠道”两种路径。
- [会话文件并发] SDK 与 CLI 共用 `~/.claude/projects` 存储 → SDK 会话使用独立 session id，不 resume 正在终端中运行的会话。
- [资源泄漏] 异常退出后子进程残留 → 关闭会话与服务退出时统一 abort 并清理，保留进程退出兜底。
- [安全面扩大] SDK 具备工具执行能力 → 默认权限模式、路径校验、仅本机访问、Origin 校验，不默认放开工具白名单。

## Migration Plan

1. 本次只落后端骨架与独立接口，前端与终端路径不变；上线后可用健康检查确认运行时状态。
2. 批次 1 验证通过后再接前端；每批保留独立 API，可通过删除路由与依赖回滚。
3. 删除 SDK 相关代码不影响现有终端会话与配置管理。

## Open Questions

- SDK 自带运行时与用户自装 CLI 的长期升级策略（跟随 SDK 版本还是继续 winget 管理）留到批次 2 决定。
- MCP/hooks/agents 是否最终由 SDK 程序化注入替代文件管理，留到批次 4 评估。
