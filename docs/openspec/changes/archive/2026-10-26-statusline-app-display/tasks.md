# Tasks：statusline-app-display

## 1. 服务端状态接收与存储

- [x] 1.1 新建 `server/statusline/store.mjs`：按 `session_id` 的内存 Map（含 `receivedAt`），上限 200 条淘汰最旧；用 node:test 覆盖保存、覆盖更新与淘汰，运行 `node --test tests/statusline-store.test.mjs` 通过 <!-- comet-task:646a6fbd-9c3f-4031-b068-159cb4e21107 -->
- [x] 1.2 新增 `POST /api/statusline/report` 路由（body ≤256KB，写入 store，返回 204）；在 `tests/` 增加冒烟用例验证会话状态保存与同会话覆盖，运行 `node --test tests/server-smoke.test.mjs` 通过 <!-- comet-task:39a269e9-287b-439f-8b94-aea9df227446 -->

## 2. todo/成本补充解析

- [x] 2.1 新建 `server/statusline/enrich.mjs`：解析 `~/.claude/todos/<sessionId>-agent-*.json` 最新文件统计 todo 完成数/总数；用临时目录伪造 todos 文件编写单测，运行 `node --test tests/statusline-enrich.test.mjs` 通过 <!-- comet-task:ff71605e-c812-4732-8b23-6be845e3b088 -->
- [x] 2.2 在 enrich 中实现回退解析：转发 JSON 缺 `context_window`/`cost` 时读 transcript（usage 与 costUSD 累加）；数据源缺失或解析失败时省略对应项，单测覆盖缺失与合法两种输入 <!-- comet-task:95a2afbd-515b-441e-a926-ec0250f356b9 -->

## 3. 查询 API 与会话映射

- [x] 3.1 新增 `GET /api/statusline/state?id=<workbench-session-id>`：会话关联按两级匹配——先按 CLI `sessionId` 精确匹配，再按转发数据的 `workspace.current_dir` 兜底匹配项目下最近活动会话；返回合并状态（store + enrich + `git branch --show-current` 现取）与启用标志（含 wrapper 文件存在性自检）；冒烟测试覆盖有状态、无状态、continue 会话兜底匹配与无匹配四种返回 <!-- comet-task:5b25f57e-0e35-473b-80c1-015c1d8dd2ba -->
- [x] 3.2 新增 `POST /api/statusline/enable` / `POST /api/statusline/disable`：备份原命令到 `~/.claude/workbench-statusline.json`（含端口），替换 `settings.json` 的 `statusLine.command` 为包装器副本；禁用按备份原样恢复（空原命令时移除 statusLine 键）；重复启用刷新端口与副本且不覆盖备份；用临时 HOME 目录的 settings 副本做单测，覆盖启用、重复启用、禁用恢复与写入失败不破坏配置（实现为接管模式后 bash 探测已移除） <!-- comet-task:6376d625-52e7-4e7c-b400-12105d165c5b -->

## 4. statusLine 包装器脚本

- [x] 4.1 新建 `resources/statusline-wrapper.mjs`（接管模式）：读 stdin 全量 → fire-and-forget POST（300ms 超时、任何失败静默）→ 直接退出，不执行原命令——终端内原状态栏由软件状态栏替代显示；配置缺失或损坏时静默成功 <!-- comet-task:49559647-b9a6-4933-81c4-3e2ae0759f33 -->
- [x] 4.2 编写包装器自检测试：用假原命令验证 stdout/退出码透传、stdin 内容一致、服务端不可达时不阻塞不报错，运行 `node --test tests/statusline-wrapper.test.mjs` 通过 <!-- comet-task:839cc9b8-030e-491d-9dfd-c3c0954a4ad0 -->

## 5. 前端状态栏

- [x] 5.1 升级 `terminal-footer` 为状态栏：未启用时保留原内容并显示"启用状态栏"入口；启用后渲染「模型 · 上下文用量 · git 分支 · todo · 成本」并保留禁用入口，字段缺失时省略对应项 <!-- comet-task:13c2504e-85d6-4aca-b796-e1d06265c372 -->
- [x] 5.2 接入数据获取：复用 3 秒轮询顺带拉取 `/api/statusline/state`，切换会话立即拉取一次；无状态会话显示占位提示，`--continue` 会话显示占位 <!-- comet-task:97906fd2-bd8a-4d4a-bdf8-d47b747af104 -->

## 6. 集成验证

- [x] 6.1 端到端手工验证：启用包装 → 在工作站新建会话发送消息 → 底部状态栏五项内容与终端内 claude-hud 显示一致 → 切换会话状态跟随 → 禁用后 `settings.json` 恢复原命令；在软件关闭状态下让 Claude Code 刷新 statusLine，确认终端渲染不受影响 <!-- comet-task:4d2ddb1d-8381-4b91-9bbf-9cea2e03e139 -->
- [x] 6.2 全量回归：`npm test` 全部通过，`npm run build` 构建成功 <!-- comet-task:aad7ba3e-43f0-4432-9679-731b080e91a4 -->

## 7. 模型与思考等级切换（验证反馈新增）

- [x] 7.1 新增 `POST /api/statusline/switch`：向激活会话的 pty 注入 `/model <id>` 或 `/effort <level>`（校验等级与模型名合法性、会话终端存在）；`GET /api/statusline/state` 附带 `modelPicker.options` 候选；冒烟测试覆盖非法等级与无会话 404 <!-- comet-task:eb0fa9c1-001b-4e43-a858-d60847af010c -->
- [x] 7.2 前端点击模型名弹出切换面板（模型候选 + 思考等级四档，当前项高亮），选择后注入并提示；spec 补充「点击模型名切换模型与思考等级」需求场景，重新生成 handoff <!-- comet-task:0e00b674-8d98-4266-888b-c5869b91ba56 -->
