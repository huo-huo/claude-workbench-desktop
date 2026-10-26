---
comet_change: statusline-app-display
role: technical-design
canonical_spec: openspec
---

# Design：statusLine 内容的软件原生显示

## Context

对话工作站的会话通过 `pty.spawn` 运行 claude CLI（`server/terminal/sessions.mjs`），会话记录保存 `sessionId`（CLI 会话 ID）与 `projectPath`。当前 statusLine 为 claude-hud，其命令由 Claude Code 在每次刷新时调用并通过 stdin 传入会话 JSON。服务端监听 `127.0.0.1:4173`（`CLAUDE_WORKBENCH_PORT` 可覆盖），已有 `readSettings`/`writeSettings` 与 `~/.claude/workbench-*.json` 状态文件模式（`server/core/paths.mjs`）。数据来源已确认为 statusLine 代理转发（见 proposal.md），需求行为见 specs/statusline-status-bar/spec.md。

## Goals / Non-Goals

**Goals:**
- 包装器把 Claude Code 传入的 statusLine 原始 JSON 转发给软件服务端，终端内 statusLine 渲染不受影响
- 服务端按 CLI `session_id` 保存状态，补齐 todo 进度与成本，提供查询 API
- 工作站底部状态栏显示当前激活会话的模型名、上下文用量、git 分支、todo 进度、成本
- 启用/禁用开关安全地替换和恢复 `settings.json` 中的 `statusLine.command`

**Non-Goals:**
- 不改变会话运行方式（保持 CLI + pty），不引入 SDK 会话驱动的工作站
- 不解析或重绘终端画面来推测状态（现有"工作中/在线"检测保持不变）
- 不做多用户、远程部署或鉴权（本机回环，与现有服务一致）
- 不追求跨平台（Windows 优先；接管模式下包装器不执行原命令，无 shell 依赖）

## Decisions

### D1：包装器为随软件分发的 Node 脚本 + 旁置配置文件

`statusLine.command` 启用后替换为 `node "<安装目录>\resources\statusline-wrapper.mjs"`。包装器从同目录 `statusline-wrapper.json` 读取 `{ "command": <原命令>, "port": <服务端口> }`（启用时由软件写入，端口取服务端实际监听值，避免环境变量丢失导致找不到服务端）。

- 备选"在原命令前拼接转发前缀"：stdin 管道只能读一次，shell 组合脆弱，放弃。
- 备选"转发后继续透传执行原命令"：终端与软件显示同一内容造成重复，放弃。
- 备选"由软件常驻代理 statusLine 全部职责"：等于在软件里重新实现 claude-hud，范围失控，放弃。

包装器执行流程（接管模式）：读 stdin 全量 → `fetch` POST（fire-and-forget，超时 300ms，任何失败静默）→ 直接退出。不执行原 statusLine 命令——终端内原状态栏不再渲染，由软件状态栏替代显示，避免同一内容重复出现；禁用时恢复原命令即可还原终端显示。

### D3：转发接口与状态存储

- `POST /api/statusline/report`：body 即原始 stdin JSON（≤256KB），按 `session_id` 存入内存 Map，返回 204。与现有服务一样不做鉴权（仅回环监听）。
- `server/statusline/store.mjs`：`Map<sessionId, { data, receivedAt }>`，上限 200 条，超出淘汰最旧；不持久化——statusLine 是瞬时状态，软件重启后由下一次转发自然恢复。
- 备选"落盘"：数据易变且高频覆盖，落盘只增加磨损无收益，放弃。

### D4：todo/成本补充解析（惰性、只读）

`server/statusline/enrich.mjs` 在收到转发后解析：

- todo：匹配 `~/.claude/todos/<session_id>-agent-*.json` 中最新文件，统计完成数/总数
- 上下文用量与成本：优先用转发 JSON 自带字段——实测输入 JSON 已提供 `context_window.used_percentage` 与 `cost.total_cost_usd`（字段名以运行时为准，全部按可选处理）；缺失时回退解析 transcript（转发 JSON 直接提供 `transcript_path`，无需自行拼接；累计 usage 与 costUSD）
- 任一数据源缺失或解析失败：省略对应项，不阻塞其余字段

### D5：查询 API 以工作台会话为锚点

`GET /api/statusline/state?id=<workbench-session-id>`：服务端从 workspace state 找到对应 CLI `sessionId`，返回合并后的状态与启用标志。前端只认工作台会话 ID，与现有 API 习惯一致。

会话关联按两级匹配：优先按记录的 CLI `sessionId` 精确匹配；`--continue`/`--picker` 会话没有记录的 CLI `sessionId`，按转发数据中的 `workspace.current_dir` 兜底匹配该项目目录下最近使用的活动会话；两级都无匹配时状态栏显示占位。

### D6：前端状态栏与轮询

`terminal-footer` 升级为状态栏：未启用时保留原有内容并显示"启用状态栏"入口；启用后按「模型 · 上下文用量 · git 分支 · todo · 成本」渲染，并保留禁用入口。数据获取：复用现有 3 秒轮询节奏（`refreshSessionStatuses` 所在 interval 顺带拉取），切换会话时立即拉取一次。git 分支由服务端在查询时对项目目录执行 `git branch --show-current` 现取，不依赖转发数据。

### D7：启用/禁用与原命令备份

`POST /api/statusline/enable` / `POST /api/statusline/disable`。备份写入 `~/.claude/workbench-statusline.json`（原命令、启用标志、端口）。重复启用时不覆盖已有备份，防止把包装器自己当成原命令；恢复时以备份文件为准原样写回。

启用态自检：查询状态 API 时校验包装器脚本文件存在性；若备份记录为启用中但 wrapper 文件缺失（如被用户清理），按未启用返回，前端显示异常提示，避免终端 statusLine 静默消失而无提示。

## Risks / Trade-offs

- [包装器自身异常] → 接管模式下包装器不执行外部命令、无 shell 依赖；任何异常静默退出，最坏结果是终端 statusLine 暂时不渲染，绝不阻塞会话
- [包装器增加 statusLine 刷新延迟（Node 冷启动 + 转发）] → 转发超时 300ms 且 fire-and-forget；原命令执行是主路径
- [statusLine stdin JSON 字段随版本差异] → 全部字段按可选处理，缺失即省略对应显示项
- [用户手动改写 `settings.json` 或 Claude Code 更新重写配置] → 恢复以备份文件为准；备份文件不受 settings.json 变化影响
- [`--continue` 会话无 CLI sessionId] → 按 `workspace.current_dir` 兜底匹配项目下最近活动会话（见 D5）；仍无匹配时显示占位提示

## Migration Plan

启用：备份原命令 → 写包装器配置（原命令 + 端口）→ 替换 `statusLine.command`。
禁用：读备份 → 原样写回 `statusLine.command` → 保留备份文件供再次启用。
回滚：直接禁用即恢复原状；删除备份文件与包装器文件不影响 Claude Code。

## Open Questions

（无——字段差异按可选处理，端口通过启用时写入配置解决。）
