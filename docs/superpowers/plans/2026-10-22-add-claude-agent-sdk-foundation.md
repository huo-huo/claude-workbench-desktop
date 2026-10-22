---
change: add-claude-agent-sdk-foundation
design-doc: docs/openspec/changes/add-claude-agent-sdk-foundation/design.md
base-ref: 39eed2e414875619d730330aa2a2577764f43dcd
---

# Claude Agent SDK 接入骨架实施计划

> **给执行代理：** 使用 subagent-driven-development 逐任务执行，主会话协调、实现代理编码。TDD 模式：每个实现任务先写失败测试（RED），再实现到通过（GREEN）。任务完成状态以 `tasks.md` 为准，本计划不另设复选框。

**目标：** 在本地 Node 服务中加入可独立验证的 Claude Agent SDK 运行时（健康检查、会话创建、发送、事件流、中断、关闭、渠道注入），不改变现有终端会话行为。

**架构：** 新增 `sdk-runtime.mjs` 承载 SDK 生命周期与事件分发，`server.mjs` 只挂载 `/api/sdk/*` HTTP 路由与 WebSocket 升级，并通过依赖注入复用现有项目校验、运行时定位与渠道解密能力。

**技术栈：** Node.js ESM、`@anthropic-ai/claude-agent-sdk@0.3.308`、`ws`、`node:test`。

**规格：** `docs/openspec/changes/add-claude-agent-sdk-foundation/design.md`、`docs/openspec/changes/add-claude-agent-sdk-foundation/specs/claude-agent-sdk-runtime/spec.md`

<!-- comet-task-authority: docs/openspec/changes/add-claude-agent-sdk-foundation/tasks.md -->

## 全局约束

- SDK 版本固定为 `0.3.308`，不使用 `latest`。
- 不修改现有 `/api/workspace/*` 的请求与响应行为。
- 不写入 `~/.claude/settings.json`；渠道注入仅通过会话级 `env`。
- 服务仅监听 `127.0.0.1`；HTTP 写操作与 WebSocket 升级沿用现有 Origin/Host 校验。
- 所有新增代码注释使用中文。
- 提交时只添加明确文件，不使用 `git add -A`；不提交 change 目录内的 `.comet.yaml` 与 `.comet/`。

## 文件结构

- 新建 `sdk-runtime.mjs`：SDK 运行时、会话状态机、输入队列、事件缓冲、渠道环境构造、运行时解析。
- 新建 `tests/sdk-runtime.test.mjs`：纯函数与状态机单元测试（`node:test`）。
- 新建 `scripts/sdk-smoke.mjs`：真实进程集成冒烟脚本。
- 新建 `docs/claude-agent-sdk-migration.md`：迁移评估长期文档。
- 修改 `server.mjs`：`/api/sdk/*` 路由、WebSocket 升级分支、依赖注入。
- 修改 `package.json`：固定版本依赖与 `test` 脚本。
- 修改 `scripts/prepare-desktop-resources.mjs`：复制 SDK 运行时文件。
- 修改 `README.md`：SDK 能力与安装说明。

## 模块契约

`sdk-runtime.mjs` 导出：

- `createInputQueue()`：返回 `{ push(message), close(), [Symbol.asyncIterator] }`。
- `buildChannelEnvFrom(state, readSecret)`：纯函数，`state` 为工作台状态对象，`readSecret(channel)` 返回密钥字符串；返回环境增量对象。
- `resolveRuntime({ envValue, installed })`：返回 `{ path, source }`，`source` 为 `env|installed|bundled`。
- `createSdkRuntime({ resolveProject, resolveExecutable, buildChannelEnv, sessionFile, loadSdk })`：返回 `{ health, createSession, send, interrupt, close, get, subscribe, shutdown }`。
- 会话摘要：`{ id, sessionId, projectPath, status, createdAt, lastUsedAt }`。
- 订阅回调收到：`{ type: 'event'|'error'|'exit', sessionId, eventType?, event?, message? }`。

`server.mjs` 注入：

- `resolveProject(projectPath)`：调用 `recordWorkspaceProject` 与 `safeWorkspaceRoot`，无效时抛错。
- `resolveExecutable()`：优先 `process.env.CLAUDE_WORKBENCH_SDK_EXECUTABLE`，其次 `claudeInstallInfo().executable`，无则返回 `{ path: '', source: 'bundled' }`。
- `buildChannelEnv()`：调用 `channelState()`、`channelApiKey()` 解密后调用 `buildChannelEnvFrom`。

---

### 任务 1.1：安装固定版本 SDK

<!-- comet-task-ref:d2aab11c-2011-4b0a-a01e-e32119453153 -->

**Files:** 修改 `package.json`

**Interfaces:** 产出 `@anthropic-ai/claude-agent-sdk` 依赖，供后续任务 `loadSdk` 使用。

- **Step 1（RED）：** 运行 `node -e "import('@anthropic-ai/claude-agent-sdk').then(m => console.log(typeof m.query)).catch(e => { console.error(e.message); process.exit(1) })"`，预期失败（依赖未安装）。
- **Step 2（GREEN）：** 在 `package.json` 的 `dependencies` 中添加 `"@anthropic-ai/claude-agent-sdk": "0.3.308"`，运行 `npm install`。
- **Step 3（验证）：** 重复 Step 1 命令，预期输出 `function`。
- **Step 4（提交）：** `git add package.json package-lock.json` 并提交 `feat: add claude agent sdk dependency`。

### 任务 1.2：创建运行时模块骨架与输入队列

<!-- comet-task-ref:022e990f-440b-473c-848b-4d4669819d68 -->

**Files:** 新建 `sdk-runtime.mjs`、`tests/sdk-runtime.test.mjs`；修改 `package.json`（`test` 脚本）

**Interfaces:** 导出 `createInputQueue()`、`createSdkRuntime(...)`；`health()` 返回 `{ available, sdkVersion, runtimePath, runtimeSource, nodeVersion, error }`。

- **Step 1（RED）：** 在 `tests/sdk-runtime.test.mjs` 写测试：`createInputQueue()` 的 `next()` 在无数据时挂起，`push()` 后返回该消息，`close()` 后返回 `{ done: true }`；`health()` 在未注入 SDK 时返回 `available: false` 且含 `error` 字段。
- **Step 2（RED 验证）：** 运行 `node --test tests/sdk-runtime.test.mjs`，预期因模块不存在或导出缺失失败。
- **Step 3（GREEN）：** 实现 `createInputQueue()` 与 `createSdkRuntime()` 最小骨架（含 `loadSdk` 注入、会话 Map、`health()`），在 `package.json` 添加 `"test": "node --test tests/"`。
- **Step 4（GREEN 验证）：** 运行 `npm test`，预期全部通过。
- **Step 5（提交）：** 提交 `feat: add sdk runtime skeleton and input queue`。

### 任务 2.1：运行时健康检查

<!-- comet-task-ref:da6d5870-3e0c-4b58-bcd6-5c243eb69137 -->

**Files:** 修改 `sdk-runtime.mjs`、`server.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `health()` 返回 `available`、`sdkVersion`、`runtimePath`、`runtimeSource`、`nodeVersion`、`error`；`GET /api/sdk/health` 成功返回 200。

- **Step 1（RED）：** 添加测试：注入 `loadSdk` 成功时 `health().available === true`，`sdkVersion` 来自 SDK 包版本，`runtimeSource` 为注入的 `resolveExecutable` 结果。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 实现 `resolveRuntime()` 与 `health()`；在 `server.mjs` 挂载 `GET /api/sdk/health`，使用 `createSdkRuntime` 单例。
- **Step 4（GREEN 验证）：** `npm test` 通过；启动服务后 `curl http://127.0.0.1:4173/api/sdk/health` 返回 200 且字段齐全。
- **Step 5（提交）：** 提交 `feat: add sdk health endpoint`。

### 任务 2.2：SDK 不可用降级

<!-- comet-task-ref:a0915327-a5ce-47a1-b679-7230022dc338 -->

**Files:** 修改 `sdk-runtime.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `health()` 在 `loadSdk` 抛错或运行时路径无效时返回 `available: false`、`error`；SDK 路由返回 503。

- **Step 1（RED）：** 添加测试：`loadSdk` 抛错时 `health().available === false` 且 `error` 非空；`resolveExecutable` 返回不存在的路径时同样不可用。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 缓存加载错误到会话级状态；`createSession` 前检查健康状态并抛 503 错误；`server.mjs` 将 SDK 错误映射为 503。
- **Step 4（GREEN 验证）：** `npm test` 通过；以 `CLAUDE_WORKBENCH_SDK_EXECUTABLE=C:\不存在\claude.exe` 启动服务，健康检查返回不可用，`curl /api/state` 仍返回 200。
- **Step 5（提交）：** 提交 `fix: degrade sdk routes when runtime unavailable`。

### 任务 2.3：项目路径校验

<!-- comet-task-ref:1b2e10be-679f-47f6-b218-848d83fcfca4 -->

**Files:** 修改 `sdk-runtime.mjs`、`server.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `createSession({ projectPath })` 出错时抛带 `statusCode: 400` 的错误；不创建会话。

- **Step 1（RED）：** 添加测试：注入 `resolveProject` 抛错时 `createSession` 抛出 `statusCode === 400`，且 runtime 内部会话 Map 尺寸不变。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 在 `createSession` 起始调用 `resolveProject`，校验失败直接抛错，不触碰 `loadSdk` 与运行时解析。
- **Step 4（GREEN 验证）：** `npm test` 通过；向 `/api/sdk/sessions` 提交 `projectPath: "C:\\Windows"` 返回 400。
- **Step 5（提交）：** 提交 `feat: validate sdk session project path`。

### 任务 3.1：创建会话接口

<!-- comet-task-ref:b24df261-801d-48fa-bbf8-d400c9420437 -->

**Files:** 修改 `sdk-runtime.mjs`、`server.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `createSession({ projectPath, prompt, model, permissionMode })` 返回会话摘要与 `eventUrl`；HTTP 为 `POST /api/sdk/sessions`，成功 201。

- **Step 1（RED）：** 添加测试：mock `loadSdk` 返回可控 `query` 异步生成器；`createSession` 返回 `id`、`sessionId`、`projectPath`、`status: 'starting'`、`eventUrl`，且 `query` 只调用一次。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 实现会话对象、`query()` 启动、初始提示词入队；`server.mjs` 挂载创建路由并返回 201。
- **Step 4（GREEN 验证）：** `npm test` 通过；`POST /api/sdk/sessions` 返回 201 与 `eventUrl`。
- **Step 5（提交）：** 提交 `feat: add sdk session creation endpoint`。

### 任务 3.2：发送提示词

<!-- comet-task-ref:6e50a1aa-36ae-4858-a8f3-3b7966372b47 -->

**Files:** 修改 `sdk-runtime.mjs`、`server.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `send(id, prompt)` 将消息推入输入队列并返回 `{ accepted: true, status }`；HTTP `POST /api/sdk/sessions/message` 返回 202。

- **Step 1（RED）：** 添加测试：对同一会话连续 `send` 两次，输入队列收到两条 `{ type: 'user', message: { role: 'user', content } }` 消息；对已关闭会话 `send` 抛 `statusCode: 409`。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 实现 `send` 与状态更新（`idle` → `running`）；挂载 HTTP 路由。
- **Step 4（GREEN 验证）：** `npm test` 通过；接口连续两次调用返回 202。
- **Step 5（提交）：** 提交 `feat: add sdk session message endpoint`。

### 任务 3.3：WebSocket 事件流

<!-- comet-task-ref:37fced0a-5940-42fe-a422-8959cb430045 -->

**Files:** 修改 `sdk-runtime.mjs`、`server.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `subscribe(id, listener)` 先回放事件缓冲再推送新事件；WS 路径 `/api/sdk/events?session=<id>`，消息 `{ type: 'ready'|'event'|'error'|'exit', sessionId, ... }`。

- **Step 1（RED）：** 添加测试：启动 mock query 后先产生 2 条事件，再 `subscribe`，监听器先收到 `ready` 与 2 条回放；随后 mock 产生第 3 条事件，监听器收到新事件。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 实现 100 条环形缓冲、订阅广播与 `subscribe`；`server.mjs` 在 upgrade 分支处理 `/api/sdk/events`，沿用 Origin/Host 校验，未知或已关闭会话直接销毁连接。
- **Step 4（GREEN 验证）：** `npm test` 通过；用 `scripts/sdk-smoke.mjs` 的临时版本或 `ws` 客户端连接后能收到 `ready` 与 `system` 事件。
- **Step 5（提交）：** 提交 `feat: add sdk websocket event stream`。

### 任务 3.4：事件重连续接

<!-- comet-task-ref:c93e182e-267a-4cde-b27f-7433cd425f08 -->

**Files:** 修改 `sdk-runtime.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** 取消订阅后再次 `subscribe` 同一会话，回放缓冲且会话状态不变。

- **Step 1（RED）：** 添加测试：`subscribe` → 取消订阅 → 再次 `subscribe`，第二次仍收到 `ready` 与既有缓冲事件，会话 `status` 保持 `running`。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 确保订阅注册可重复、取消只移除监听器，不改变会话状态或输入队列。
- **Step 4（GREEN 验证）：** `npm test` 通过。
- **Step 5（提交）：** 提交 `feat: support sdk event stream resubscribe`。

### 任务 3.5：中断与关闭

<!-- comet-task-ref:434b29ef-186a-47af-b2b4-eb449a8867ee -->

**Files:** 修改 `sdk-runtime.mjs`、`server.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `interrupt(id)` 调用 `query.interrupt()` 并广播 `exit`/结果事件；`close(id)` 关闭队列、abort、状态置 `closed`，后续订阅被拒绝；HTTP 返回 200。

- **Step 1（RED）：** 添加测试：`interrupt` 对 `running` 会话调用 mock `interrupt` 一次，对 `idle` 会话不调用；`close` 后会话状态为 `closed`，`subscribe` 抛错，重复 `close` 幂等。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 实现 `interrupt`、`close`、`shutdown`，并挂载两个 HTTP 路由。
- **Step 4（GREEN 验证）：** `npm test` 通过；接口返回 200，关闭后 WS 连接被拒绝。
- **Step 5（提交）：** 提交 `feat: add sdk interrupt and close endpoints`。

### 任务 3.6：独立会话记录

<!-- comet-task-ref:fb848e5b-a7b0-44c3-a153-88aaa73b54c1 -->

**Files:** 修改 `sdk-runtime.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `sessionFile` 默认 `~/.claude/workbench-sdk-sessions.json`；记录结构 `{ sessions: [{ id, sessionId, projectPath, status, createdAt, lastUsedAt }] }`，最多 200 条，原子写。

- **Step 1（RED）：** 添加测试（使用临时目录）：创建会话后记录文件出现且仅含该会话；模拟损坏 JSON 时按空记录回退且不抛错；超过 200 条时保留最新 200 条。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 实现记录读写（临时文件 + rename）与容量裁剪；确认不读写 `workbench-workspace.json`。
- **Step 4（GREEN 验证）：** `npm test` 通过。
- **Step 5（提交）：** 提交 `feat: persist sdk sessions separately`。

### 任务 4.1：加载本地配置

<!-- comet-task-ref:fcc5887a-b967-413d-87a4-39e8ae81582d -->

**Files:** 修改 `sdk-runtime.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `query` 的 options 含 `settingSources: ['user', 'project', 'local']` 与 `systemPrompt: { type: 'preset', preset: 'claude_code' }`。

- **Step 1（RED）：** 添加测试：创建会话后断言 mock `query` 收到的 options 包含上述字段与 `cwd === projectPath`。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 在 `buildOptions()` 中加入配置来源与 system prompt preset。
- **Step 4（GREEN 验证）：** `npm test` 通过。
- **Step 5（提交）：** 提交 `feat: load claude settings in sdk sessions`。

### 任务 4.2：渠道环境注入

<!-- comet-task-ref:63ba470d-1a33-4740-93d3-818a759b4470 -->

**Files:** 修改 `sdk-runtime.mjs`、`server.mjs`；测试 `tests/sdk-runtime.test.mjs`

**Interfaces:** `buildChannelEnvFrom(state, readSecret)` 返回渠道环境增量；`buildOptions().env` 为 `{ ...process.env, ...channelEnv }`。

- **Step 1（RED）：** 添加测试：给定含激活渠道和模型槽位的状态，断言返回 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL` 与各槽位键；无渠道时返回 `{}`。
- **Step 2（RED 验证）：** `npm test` 预期失败。
- **Step 3（GREEN）：** 实现 `buildChannelEnvFrom`；`server.mjs` 用 `channelState()` 与 `channelApiKey()` 组装 `buildChannelEnv` 回调。
- **Step 4（GREEN 验证）：** `npm test` 通过；创建 SDK 会话时 mock options 的 `env` 含渠道键。
- **Step 5（提交）：** 提交 `feat: inject channel env into sdk sessions`。

### 任务 4.3：确认不改写全局设置

<!-- comet-task-ref:85b610ec-d666-486b-b1f9-e9c7974adac7 -->

**Files:** 修改 `tests/sdk-runtime.test.mjs`（必要时调整实现）

**Interfaces:** 创建 SDK 会话前后 `~/.claude/settings.json` 内容不变。

- **Step 1（RED）：** 添加测试：使用临时 `settings.json`，在 `createSession` 前后比较文件内容哈希，断言一致；断言实现未引用 `writeSettings`。
- **Step 2（RED 验证）：** `npm test` 预期失败（若实现已满足则记录为既有行为并继续）。
- **Step 3（GREEN）：** 移除任何全局设置写入，确保渠道只进入 `options.env`。
- **Step 4（GREEN 验证）：** `npm test` 通过；手动创建会话前后 `Get-FileHash ~/.claude/settings.json` 一致。
- **Step 5（提交）：** 提交 `test: assert sdk sessions do not mutate global settings`。

### 任务 5.1：桌面资源打包

<!-- comet-task-ref:3675b2dc-fc4d-4e28-824a-17a13980aab6 -->

**Files:** 修改 `scripts/prepare-desktop-resources.mjs`

**Interfaces:** `resources/workbench/node_modules/@anthropic-ai/claude-agent-sdk` 包含包文件与运行时；`resources/workbench/sdk-runtime.mjs` 存在。

- **Step 1（RED）：** 运行 `npm run build && node scripts/prepare-desktop-resources.mjs`，检查产物不含 `@anthropic-ai` 目录（预期失败）。
- **Step 2（GREEN）：** 在脚本中复制 `sdk-runtime.mjs` 与 `node_modules/@anthropic-ai/claude-agent-sdk` 全目录（保留可执行文件与 vendor 资源）。
- **Step 3（验证）：** 重新运行脚本，产物包含 SDK 包；在 `resources/workbench` 目录运行 `node -e "import('./sdk-runtime.mjs')"` 可加载。
- **Step 4（提交）：** 提交 `build: stage claude sdk runtime for desktop`。

### 任务 5.2：终端会话回归

<!-- comet-task-ref:f4c64048-deda-4679-9511-587f38ce93d1 -->

**Files:** 无代码改动；验证记录写入计划或检查点

**Interfaces:** 终端接口 `POST /api/workspace/session`、WS `/api/workspace/terminal`、`POST /api/workspace/session/stop` 行为不变。

- **Step 1：** 启动服务，创建一次终端会话，确认返回 `terminalUrl`。
- **Step 2：** 通过 WebSocket 发送 `input` 消息并确认收到 `data` 或 `ready` 响应。
- **Step 3：** 调用中断接口，确认返回 `stopped: true`。
- **Step 4：** 记录验证输出到 `comet state checkpoint`，无代码提交。

### 任务 6.1：冒烟脚本

<!-- comet-task-ref:d3afbf7a-46d5-494d-9cfe-cda4b41d68cb -->

**Files:** 新建 `scripts/sdk-smoke.mjs`

**Interfaces:** 脚本参数 `--base http://127.0.0.1:4173`（默认）与 `--health-only`；成功退出码 0，失败非 0。

- **Step 1（RED）：** 运行 `node scripts/sdk-smoke.mjs --health-only`，预期因脚本不存在失败。
- **Step 2（GREEN）：** 实现健康检查断言；再实现 `--health-only` 之外的完整链路：创建会话 → 连接 WS → 发送提示词 → 等待 `result` → 中断 → 关闭。
- **Step 3（验证）：** 本地服务运行且凭据可用时，`node scripts/sdk-smoke.mjs` 退出码 0；无凭据时 `--health-only` 退出码 0。
- **Step 4（提交）：** 提交 `test: add sdk smoke script`。

### 任务 6.2：迁移评估文档

<!-- comet-task-ref:71aa4bd6-4f57-48d3-8123-eed36cacdd0a -->

**Files:** 新建 `docs/claude-agent-sdk-migration.md`

**Interfaces:** 文档包含功能矩阵、批次划分、保留项，内容与 `design.md` 评估章节一致。

- **Step 1：** 从 `design.md` 的「现有功能迁移评估」复制矩阵与批次划分，补充本次已落地范围说明。
- **Step 2（验证）：** 对照 `design.md` 检查表格行数与结论一致，无遗漏。
- **Step 3（提交）：** 提交 `docs: add claude agent sdk migration assessment`。

### 任务 6.3：README 更新

<!-- comet-task-ref:47f06fd8-2091-482d-bad9-98042a8240d5 -->

**Files:** 修改 `README.md`

**Interfaces:** README 说明 SDK 骨架能力、依赖要求（Node 20.19+/22.12+）、终端模式仍为默认。

- **Step 1：** 在 Features 与 Build 章节补充 SDK 说明，注明当前仅后端接口可用、前端未接入。
- **Step 2（验证）：** 描述与 `/api/sdk/health`、`/api/sdk/sessions` 实际行为一致。
- **Step 3（提交）：** 提交 `docs: document claude sdk foundation`。

### 任务 6.4：集成验证

<!-- comet-task-ref:fd7539df-4a6d-4959-ac18-f81583265862 -->

**Files:** 无新增代码

**Interfaces:** 全链路构建与冒烟通过。

- **Step 1：** 运行 `npm test`，预期全部通过。
- **Step 2：** 运行 `npm run build`，预期构建成功。
- **Step 3：** 启动服务并运行 `node scripts/sdk-smoke.mjs`，预期退出码 0。
- **Step 4：** 记录结果到 `comet state checkpoint`，并按 Comet 要求运行 `comet check run add-claude-agent-sdk-foundation build --local -- <命令>` 录制证据。

## 自检记录

- 规格覆盖：健康检查（2.1/2.2）、会话创建（3.1/2.3）、事件流（3.3/3.4）、中断关闭（3.5）、配置渠道（4.1/4.2/4.3）、双模式隔离（5.2/全约束）、迁移评估（6.2）。
- 无占位步骤；每个任务包含 RED、GREEN、验证与提交。
- 接口命名前后一致：`createSdkRuntime`、`health`、`createSession`、`send`、`interrupt`、`close`、`subscribe`、`shutdown`、`buildChannelEnvFrom`、`resolveRuntime`、`createInputQueue`。
