---
change: statusline-app-display
design-doc: docs/openspec/changes/statusline-app-display/design.md
base-ref: 75db220c7099dad907953c9cafabced440ae8eba
---

# 实施计划：statusline-app-display

<!-- comet-task-authority: docs/openspec/changes/statusline-app-display/tasks.md -->

配置：build_mode=autonomous · tdd_mode=tdd · review_mode=standard · isolation=worktree · 语言 zh-CN

## 实施顺序与依赖

```
1.1 store ──> 1.2 report 路由 ──> 2.1 enrich(todo) ──> 2.2 enrich(回退)
                                    │
                                    v
              3.2 enable/disable ──> 3.1 state 查询 ──> 5.1/5.2 前端状态栏
              4.1 wrapper ──> 4.2 wrapper 测试
              全部完成 ──> 6.1 端到端手工验证 ──> 6.2 全量回归
```

通用约束：遵循项目现有代码风格（中文注释、ESM、server/ 模块化拆分模式、`atomicJson` 存储模式）；所有 stdin JSON 字段按可选处理；新增文件与 tests/ 下对应测试同名前缀 `statusline-`。TDD：每个实现任务先写测试确认 RED（失败原因必须是待实现行为），再实施转 GREEN，记录命令与真实结果。

## 任务

### <!-- comet-task-ref:646a6fbd-9c3f-4031-b068-159cb4e21107 --> 1.1 store 模块

- 范围：新建 `server/statusline/store.mjs`。导出 `statuslineStore`（Map：`sessionId -> { data, receivedAt }`）、`recordStatusline(data)`（无 `session_id` 时忽略并返回 false）、`getStatusline(sessionId)`、`statuslineByCwd(cwd)`（按 `workspace.current_dir`/`cwd` 不区分大小写后缀匹配，返回该项目最近 receivedAt 的一条）。上限 200 条，超出按 receivedAt 淘汰最旧。
- 依赖：无。
- 验收（TDD）：先写 `tests/statusline-store.test.mjs`（保存/同会话覆盖/超限淘汰/无 session_id 忽略/cwd 兜底匹配），RED → 实现 → GREEN。命令：`node --test tests/statusline-store.test.mjs`。

### <!-- comet-task-ref:39a269e9-287b-439f-8b94-aea9df227446 --> 1.2 report 路由

- 范围：`server/statusline/report.mjs` 提供 handler；在 `server/routes/handlers.mjs` 注册 `POST /api/statusline/report`：解析 body（≤256KB，超限 413），写入 store，返回 `{ status: 204, body: null }`（沿用 routes/index.mjs 的 send 语义，若 204 与现有 send 冲突则按项目现有空 body 模式处理并保持兼容）。JSON 解析失败返回 400，不抛栈。
- 依赖：1.1。
- 验收（TDD）：先在 `tests/server-smoke.test.mjs` 增加冒烟用例（转发保存、同会话覆盖、非法 body 400），RED → 实现 → GREEN。命令：`node --test tests/server-smoke.test.mjs`。

### <!-- comet-task-ref:ff71605e-c812-4732-8b23-6be845e3b088 --> 2.1 enrich：todo 解析

- 范围：新建 `server/statusline/enrich.mjs`。`enrichStatusline(data)`：todo 匹配 `~/.claude/todos/<sessionId>-agent-*.json` 最新修改文件，统计 `{ completed, total }`（按条目 status === 'completed' 计数）；路径根通过参数注入（默认 HOME），便于测试。任一解析失败省略 todo 字段。
- 依赖：1.1（仅类型约定）。
- 验收（TDD）：先写 `tests/statusline-enrich.test.mjs`（临时目录伪造 todos：最新文件选取、completed 统计、文件缺失省略、坏 JSON 省略），RED → 实现 → GREEN。命令：`node --test tests/statusline-enrich.test.mjs`。

### <!-- comet-task-ref:95a2afbd-515b-441e-a926-ec0250f356b9 --> 2.2 enrich：transcript 回退

- 范围：enrich 内补回退逻辑：转发数据缺 `context_window` 或 `cost` 时，读 `transcript_path`（无该字段则省略），逐行 JSON 解析累计 `costUSD` 与最后一条 assistant usage（input + cache_read + cache_creation → 估算上下文 token）；坏行跳过；文件缺失/超时（>2s）省略。
- 依赖：2.1。
- 验收（TDD）：扩展 `tests/statusline-enrich.test.mjs`（伪造 transcript：字段齐全时优先用转发值、缺失时回退累计、坏行跳过、缺失省略），RED → 实现 → GREEN。

### <!-- comet-task-ref:6376d625-52e7-4e7c-b400-12105d165c5b --> 3.2 enable/disable 与备份

- 范围：新建 `server/statusline/toggle.mjs`。`enableStatusline({ port })`：三级探测 bash（`CLAUDE_CODE_GIT_BASH_PATH` → `where git` 同目录 → PATH bash 校验 `$OSTYPE` 含 msys/cygwin）；读 `settings.json` 的 `statusLine.command`，无 command 时报错；备份 `{ originalCommand, enabled: true, port, bash }` 到 `<HOME>/.claude/workbench-statusline.json`（路径注入可测）；重复启用不覆盖备份；写包装器旁置配置（原命令 + 端口 + bash 路径）；`statusLine.command` 替换为 `node "<wrapper 绝对路径>"`。`disableStatusline()`：按备份恢复原命令、备份标记 enabled:false。任何读写失败保持原 settings 不变并抛出带 statusCode 的错误。
- 依赖：1.1（无直接依赖，与 2.x 并行）；wrapper 路径常量先约定（`resources/statusline-wrapper.mjs`）。
- 验收（TDD）：先写 `tests/statusline-toggle.test.mjs`（临时 HOME + settings 副本：启用替换、重复启用保备份、禁用恢复、写入失败不破坏、bash 探测跳过 WSL——注入假 bash 解析器），RED → 实现 → GREEN。命令：`node --test tests/statusline-toggle.test.mjs`。

### <!-- comet-task-ref:5b25f57e-0e35-473b-80c1-015c1d8dd2ba --> 3.1 state 查询 API

- 范围：`server/statusline/state.mjs`：`GET /api/statusline/state?id=<workbench-session-id>` 注册进 handlers。两级匹配：workspace state 里该会话的 `sessionId` 精确匹配 store；无则 `statuslineByCwd(projectPath)` 兜底。返回 `{ enabled, warning?, status? }`：enabled 按备份文件 + wrapper 文件存在性自检；status 为 store 数据 + enrich 合并结果 + `git branch --show-current`（在会话 projectPath 下执行，非 git 目录省略，3s 超时）。会话不存在返回 404 语义（沿用项目 httpError 模式）。
- 依赖：1.1、2.1、2.2、3.2。
- 验收（TDD）：先在 `tests/server-smoke.test.mjs` 增加用例（有状态、无状态、continue 兜底、无匹配、未启用），RED → 实现 → GREEN。命令：`node --test tests/server-smoke.test.mjs`。

### <!-- comet-task-ref:49559647-b9a6-4933-81c4-3e2ae0759f33 --> 4.1 wrapper 脚本

- 范围：新建 `resources/statusline-wrapper.mjs`（零依赖 ESM）：读 stdin 全量 → `fetch(POST http://127.0.0.1:<port>/api/statusline/report)`，`AbortSignal.timeout(300)`，try/catch 全静默 → 读同目录 `statusline-wrapper.json`（`{ command, bash }`）→ `spawn(bash, ['-c', command])` 写入 stdin 原文，透传 stdout/stderr 与退出码；配置或 bash 缺失时输出空、退出码 1，不抛栈。Node 18+（原生 fetch）。
- 依赖：3.2 约定的配置格式。
- 验收：见 4.2。

### <!-- comet-task-ref:839cc9b8-030e-491d-9dfd-c3c0954a4ad0 --> 4.2 wrapper 自检测试

- 范围：`tests/statusline-wrapper.test.mjs`：以子进程运行 wrapper（临时配置 + 假原命令 `cat`/`exit 3`），断言 stdout 透传、退出码透传、stdin 内容一致；无配置时静默非零；服务端指向已关闭端口时不阻塞（计时上限）。
- 依赖：4.1。
- 验收（TDD）：先写测试（wrapper 未建时 RED）→ 实现 4.1 → GREEN。命令：`node --test tests/statusline-wrapper.test.mjs`。

### <!-- comet-task-ref:13c2504e-85d6-4aca-b796-e1d06265c372 --> 5.1 前端状态栏渲染

- 范围：`index.html` 的 `terminal-footer` 增加状态栏区（`id="statuslineBar"`）与启用/禁用按钮（`id="toggleStatusline"`）；新建 `src/workspace/statusline.mjs`：`renderStatusline(state)` 按序渲染「模型 · 上下文用量（百分比+红黄绿分级 ≥80 红/≥50 黄）· git 分支 · todo a/b · 成本 $x」，字段缺失省略该项；未启用保留原 footer 内容并显示启用入口，启用后显示禁用入口；无状态会话显示占位提示。样式沿用 workstation.css 现有 footer 约定（mono 小字）。
- 依赖：3.1 的 API 形状。
- 验收：`npm run build` 成功；浏览器中未启用时 footer 与现状一致。

### <!-- comet-task-ref:97906fd2-bd8a-4d4a-bdf8-d47b747af104 --> 5.2 数据获取接入

- 范围：statusline.mjs 内 `refreshStatusline()`：拉取 `/api/statusline/state?id=<activeSession.id>` 并渲染；挂入现有 3 秒轮询（`init.mjs` wireSessions 的 interval 顺带调用），`sessions.mjs` 选中会话处触发立即刷新；启用/禁用按钮调用 enable/disable API 后刷新一次；请求失败静默保留上次内容。
- 依赖：5.1、3.1。
- 验收：`npm run build` 成功；运行软件后切换会话状态栏跟随更新（联调到 6.1）。

### <!-- comet-task-ref:4d2ddb1d-8381-4b91-9bbf-9cea2e03e139 --> 6.1 端到端手工验证

- 范围：启用包装 → 工作站新建会话发消息 → 底部五项与终端 claude-hud 一致 → 切换会话跟随 → 禁用后 settings.json 恢复原命令 → 软件关闭时 Claude Code 刷新 statusLine 终端渲染不受影响。记录每步实际结果。
- 依赖：全部实现任务。
- 验收：手工检查单全部通过，结果记入检查点。

### <!-- comet-task-ref:aad7ba3e-43f0-4432-9679-731b080e91a4 --> 6.2 全量回归

- 范围：`npm test` 全部通过；`npm run build` 构建成功。
- 依赖：6.1。
- 验收：两条命令真实执行并通过，用 `comet check run` 录制证据。

## 独立审查安排

review_mode=standard：3.2（改全局配置）与 4.1（wrapper fail-safe）为高风险任务，完成后各安排一次独立审查（子代理实现审查，非实现者自评）；其余任务由 Verify 的最终集成审查覆盖。

## 验证反馈新增任务

### <!-- comet-task-ref:eb0fa9c1-001b-4e43-a858-d60847af010c --> 7.1 切换接口

- 范围：`POST /api/statusline/switch`（注入 /model 与 /effort，含合法性校验与 404）；state 响应附带 modelPicker 候选与 effort 锁定标志。
- 验收：冒烟测试覆盖非法等级 400 与无会话 404，`node --test tests/server-smoke.test.mjs` 通过。

### <!-- comet-task-ref:0e00b674-8d98-4266-888b-c5869b91ba56 --> 7.2 切换面板

- 范围：点击状态栏模型名弹出候选面板（模型 + 思考等级五档，当前项高亮，env 锁定警告），选择后注入并提示。
- 验收：`npm run build` 通过；人工验证面板与注入生效。
