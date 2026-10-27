## 1. 基线与基础层

- [x] 1.1 在 worktree 运行 `npm test` 与 `npm run build`，记录基线结果作为后续对照（验证：两条命令均退出码 0） <!-- comet-task:4b21a959-0f3e-414a-b8d5-b59e7f2fd24e -->
- [x] 1.2 建立 `server/core/paths.mjs`，迁移 ROOT、WEB_ROOT、HOME、CLAUDE、各状态文件路径、PORT 与请求体上限常量（验证：`node --check server/core/paths.mjs` 通过，且 `server.mjs` 改从该模块导入后服务可启动） <!-- comet-task:30295156-7f1c-49d6-aef8-d199a281bc8d -->
- [x] 1.3 建立 `server/core/storage.mjs`，迁移 `safeReadJson`、`atomicJson`、`fileMtimeMs`、`hash`（验证：新增 `tests/server-core.test.mjs`，覆盖原子写入、损坏 JSON 回退与目录创建，且 `npm test` 通过） <!-- comet-task:16ad0cb8-5a01-43f8-80ed-d58ea40beb73 -->
- [x] 1.4 建立 `server/core/http.mjs`，迁移 `readRawBody`、`bodyJson`、`send`、`serveWorkspaceAsset`（验证：`tests/server-core.test.mjs` 覆盖请求体超限、JSON 解析失败与 MIME 回退，且通过） <!-- comet-task:723ba5dc-9b8d-46d0-887f-f1dcfb334a55 -->
- [x] 1.5 完成基础层迁移后运行 `npm test`，确认既有 `tests/sdk-runtime.test.mjs` 无回归（验证：测试全部通过） <!-- comet-task:a1bf4dca-68af-4a95-a60a-c084c96b7104 -->

## 2. 工作区领域迁移

- [x] 2.1 建立 `server/workspace/state.mjs`，迁移 `workspaceState`、`workspaceSessionName`、`safeWorkspaceRoot`、`recordWorkspaceProject`、`hideWorkspaceProject`、`listWorkspaceProjects`（验证：`npm test` 通过，服务启动后 `/api/workspace/projects` 返回结构不变） <!-- comet-task:45a272f0-1fbb-4b22-938d-ecc2ad8e3f58 -->
- [x] 2.2 建立 `server/workspace/sessions.mjs`，迁移 `listWorkspaceSessions`、`removeWorkspaceSession`（验证：`/api/workspace/sessions` 与删除会话行为不变） <!-- comet-task:a6e980e9-30ca-474b-b023-de19ed05f16f -->
- [x] 2.3 建立 `server/workspace/files.mjs`，迁移 `workspacePath`、`workspaceTree`、`workspaceFileInfo`、`workspaceFileText`、`workspaceAsset`、`saveWorkspaceImageUpload`（验证：`tests/server-core.test.mjs` 补充越界路径拒绝用例并通过；`/api/workspace/files`、`/api/workspace/file`、`/api/workspace/asset` 行为不变） <!-- comet-task:96b4ae5e-5a34-4d32-a377-6f0cf8d9e5e2 -->
- [x] 2.4 建立 `server/workspace/native.mjs`，迁移 `decodeFolderSelection`、`selectWorkspaceFolderModern`、`selectWorkspaceFolderLegacy`、`selectWorkspaceFolder`、`revealWorkspaceFile`、`recycleWorkspaceItem`、`openWorkspaceFile`、`readWorkspaceClipboard`（验证：四个原生操作端点手工冒烟成功，PowerShell 脚本文本保持原样） <!-- comet-task:621c5594-286a-457f-86d7-79020a916e42 -->

## 3. 无状态领域迁移

- [x] 3.1 建立 `server/platform/claude.mjs`，迁移 `claudeInstallInfo`、`compareVersions`、`runProcess`、`checkClaudeUpdate`、`upgradeClaudeCode` 及 `updateCheckCache`、`claudeInfoCache`（验证：`/api/updates/check` 响应结构不变） <!-- comet-task:c6f237c7-aa0d-466a-8c90-caaefa6a0ff7 -->
- [x] 3.2 建立 `server/prompts/library.mjs`，迁移 `promptLibraryRows`、`savePromptLibraryItem`、`deletePromptLibraryItem`、`refinePromptLibraryItem`（验证：`/api/prompt-library` 及 save/delete/refine 端点行为不变） <!-- comet-task:acca67ab-1a8c-4de2-8239-80b8a6e3e014 -->
- [x] 3.3 建立 `server/prompts/cards.mjs`，迁移 `splitSkillMarkdown`、`translateSkillFile`、`generateCard`、`generateCardsBatch`、`analyzeErrors`、技能翻译缓存函数（验证：`/api/generate-card`、`/api/generate-cards-batch`、`/api/translate-skill` 行为不变） <!-- comet-task:83abe6ad-93ba-4c6d-840b-df294bb1704e -->
- [x] 3.4 建立 `server/catalog/hooks.mjs`、`skills.mjs`、`mcp.mjs`、`plugins.mjs`，迁移对应扫描、推荐、`fileDetail` 与开关函数（验证：`overview` 数据中 hooks/skills/mcp/plugins 字段与开关行为不变） <!-- comet-task:44876758-4b2f-4316-b5c4-184c9f1bbdff -->
- [x] 3.5 建立 `server/catalog/metrics.mjs`，迁移 `sessionMetrics`、`overview` 与 `sessionMetricCache`（验证：`/api/state` 返回内容不变） <!-- comet-task:6b37ce2e-fbe9-4de5-b809-7ade2f0c3b91 -->
- [x] 3.6 建立 `server/catalog/errors.mjs`，迁移 `errorRows`、`errorRowsCache`（验证：`/api/state` 中报错记录字段不变） <!-- comet-task:1766950c-b66f-49cc-b6ea-bca77bf046ea -->

## 4. 有状态领域迁移

- [x] 4.1 建立 `server/channels/store.mjs`，迁移渠道状态、密钥保护、`saveChannel`、`activateChannel`、`channelApiKey`（验证：`/api/state` 渠道数据与 `/api/save-channel`、`/api/activate-channel` 行为不变） <!-- comet-task:d9e4f754-51e3-4e9e-8c48-f7e808d9340f -->
- [x] 4.2 建立 `server/channels/models.mjs`，迁移 `modelData`、模型拉取、`saveModels`、`setChannelFallbacks` 与项目设置辅助函数（验证：`/api/channel-models`、`/api/channel-models-draft`、`/api/save-models`、`/api/set-channel-fallbacks` 行为不变） <!-- comet-task:c2302391-0477-45c4-96a3-6e696d1ab94b -->
- [x] 4.3 建立 `server/channels/benchmark.mjs`，迁移 `benchmarkModelRequest`、`benchmarkModel`、`updateModelBenchmarkRun`、`callChannelModel`、`saveBenchmarkResult`（验证：`/api/model-benchmark` 与 `/api/model-benchmark-run` 行为不变） <!-- comet-task:7689b70a-2d62-4335-9151-6e5df4e4c75c -->
- [x] 4.4 建立 `server/terminal/sessions.mjs`，迁移 `workspaceTerminals`、`workspaceWs`、心跳、`createWorkspaceSession` 与终端 WebSocket 处理（验证：启动服务后新建对话、终端输入输出、关闭会话均正常） <!-- comet-task:e2b42d1f-6b38-4d3d-977f-2b2b7a0e0f72 -->
- [x] 4.5 建立 `server/sdk/bridge.mjs`，迁移 `createSdkRuntime` 装配与 `/api/sdk/events` WebSocket 处理（验证：`/api/sdk/health` 响应不变，SDK 会话事件流可连接） <!-- comet-task:a6872083-f7de-4433-a984-8b4724cf6159 -->

## 5. 路由表与入口瘦身

- [x] 5.1 建立 `server/routes/index.mjs`，用 `GET_ROUTES` / `POST_ROUTES` Map 接管全部现有端点，保持匹配顺序、body 解析条件与错误状态码透传语义（验证：新增 `tests/server-routes.test.mjs`，覆盖命中、未命中 404 与 statusCode 透传，且通过） <!-- comet-task:12cf0826-1a26-4baf-8e60-493e4fc8cbfb -->
- [x] 5.2 建立 WebSocket upgrade 路由表，接管 `/api/sdk/events` 与 `/api/workspace/terminal`，保留 origin 校验与未知路径拒绝（验证：两条事件流均可正常连接，非法 origin 被拒绝） <!-- comet-task:d1644265-071f-4986-9a54-11da6e155b0d -->
- [x] 5.3 把 `server.mjs` 瘦身为入口，只保留模块导入、HTTP 服务创建、upgrade 挂载、监听与优雅退出（验证：`node --check server.mjs` 通过，文件行数降至 100 行以内） <!-- comet-task:48fca3dd-f5dd-4dec-bcee-467a4577c4e4 -->
- [x] 5.4 删除 `server.mjs` 中已迁移的旧函数与不再使用的 import（验证：`npm test` 通过，`grep` 确认无重复定义） <!-- comet-task:fe168007-b1f3-482c-814c-82591bba0f79 -->

## 6. 打包与最终验证

- [x] 6.1 更新 `scripts/prepare-desktop-resources.mjs`，把 `server/` 目录复制到 `resources/workbench/server/`（验证：`npm run build:desktop` 后 staged 目录包含完整 `server/`） <!-- comet-task:7747ad46-b87d-438e-bb5a-bf889ffd2481 -->
- [x] 6.2 运行 `npm test`，确认全部测试通过（验证：退出码 0） <!-- comet-task:e19ec812-4379-431d-a86a-48fea84b5930 -->
- [x] 6.3 运行 `npm run build`，确认前端构建通过（验证：退出码 0） <!-- comet-task:1ce28d27-713d-4a68-a408-06897b42159e -->
- [x] 6.4 启动服务并冒烟关键端点：`/api/state`、`/api/workspace/projects`、`/api/workspace/sessions`、`/api/sdk/health`（验证：响应结构与基线一致） <!-- comet-task:62beb285-393f-42f5-ac68-18841c68181f -->
- [x] 6.5 对照 1.1 基线，确认无行为变化并记录结果（验证：相关端点响应字段、错误消息与状态码一致） <!-- comet-task:3375ff9b-279c-4352-b0e4-ca8b022fec92 -->
