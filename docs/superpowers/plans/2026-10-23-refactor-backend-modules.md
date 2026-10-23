---
change: refactor-backend-modules
design-doc: docs/openspec/changes/refactor-backend-modules/design.md
base-ref: 22c8d52559df4af0ad42c6030d982465297c1535
---

<!-- comet-task-authority: docs/openspec/changes/refactor-backend-modules/tasks.md -->

# refactor-backend-modules 实施计划

## 执行配置

- build_mode: autonomous
- tdd_mode: direct
- review_mode: standard

## 总体策略

- 迁移以函数为最小单位：只移动函数、改显式 import、改共享常量来源，函数体不改
- 依赖方向 `server.mjs -> routes -> 领域 -> core`，`core` 不 import 领域
- 每完成一组迁移，服务必须仍可启动、`npm test` 通过、`npm run build` 通过
- 原生 Windows 操作（文件夹选择、回收站、资源管理器定位）保留手工冒烟
- 全部任务完成后由独立审查者做一次 Build 分段审查，Verify 阶段完成最终集成审查

## 组 1：基线与基础层

### 1.1 记录基线
<!-- comet-task-ref:4b21a959-0f3e-414a-b8d5-b59e7f2fd24e -->
- 范围：在 worktree 运行 `npm test` 与 `npm run build`，记录退出码与结果
- 依赖：无
- 验收：两条命令退出码 0

### 1.2 core/paths.mjs
<!-- comet-task-ref:30295156-7f1c-49d6-aef8-d199a281bc8d -->
- 范围：迁移路径常量（ROOT、WEB_ROOT、HOME、CLAUDE、状态文件、PORT、上限）
- 依赖：1.1
- 约束：`server.mjs` 改为从该模块导入；常量值逐字保持
- 验收：`node --check` 通过，服务可启动

### 1.3 core/storage.mjs
<!-- comet-task-ref:16ad0cb8-5a01-43f8-80ed-d58ea40beb73 -->
- 范围：`safeReadJson`、`atomicJson`、`fileMtimeMs`、`hash`
- 依赖：1.2
- 验收：新增 `tests/server-core.test.mjs` 覆盖原子写入、损坏 JSON 回退、目录创建并通过

### 1.4 core/http.mjs
<!-- comet-task-ref:723ba5dc-9b8d-46d0-887f-f1dcfb334a55 -->
- 范围：`readRawBody`、`bodyJson`、`send`、`serveWorkspaceAsset`
- 依赖：1.2、1.3
- 验收：`tests/server-core.test.mjs` 覆盖请求体超限、JSON 解析失败、MIME 回退并通过

### 1.5 基础层回归
<!-- comet-task-ref:a1bf4dca-68af-4a95-a60a-c084c96b7104 -->
- 依赖：1.4
- 验收：`npm test` 全部通过，既有 sdk-runtime 测试无回归

## 组 2：工作区领域

### 2.1 workspace/state.mjs
<!-- comet-task-ref:45a272f0-1fbb-4b22-938d-ecc2ad8e3f58 -->
- 范围：`workspaceState`、`workspaceSessionName`、`safeWorkspaceRoot`、`recordWorkspaceProject`、`hideWorkspaceProject`、`listWorkspaceProjects`
- 依赖：1.5
- 验收：`npm test` 通过，`/api/workspace/projects` 结构不变

### 2.2 workspace/sessions.mjs
<!-- comet-task-ref:a6e980e9-30ca-474b-b023-de19ed05f16f -->
- 范围：`listWorkspaceSessions`、`removeWorkspaceSession`
- 依赖：2.1
- 验收：`/api/workspace/sessions` 与删除会话行为不变

### 2.3 workspace/files.mjs
<!-- comet-task-ref:96b4ae5e-5a34-4d32-a377-6f0cf8d9e5e2 -->
- 范围：`workspacePath`、`workspaceTree`、`workspaceFileInfo`、`workspaceFileText`、`workspaceAsset`、`saveWorkspaceImageUpload`
- 依赖：2.1、1.3
- 验收：`tests/server-core.test.mjs` 补充越界路径拒绝用例并通过；三个文件端点行为不变

### 2.4 workspace/native.mjs
<!-- comet-task-ref:621c5594-286a-457f-86d7-79020a916e42 -->
- 范围：文件夹选择、资源管理器定位、回收站、打开文件、剪贴板
- 依赖：2.1、2.3
- 约束：PowerShell 脚本文本逐字保持
- 验收：四个原生操作端点手工冒烟成功

## 组 3：无状态领域

### 3.1 platform/claude.mjs
<!-- comet-task-ref:c6f237c7-aa0d-466a-8c90-caaefa6a0ff7 -->
- 范围：`claudeInstallInfo`、`compareVersions`、`runProcess`、更新检查与升级、相关缓存
- 依赖：1.5
- 验收：`/api/updates/check` 响应结构不变

### 3.2 prompts/library.mjs
<!-- comet-task-ref:acca67ab-1a8c-4de2-8239-80b8a6e3e014 -->
- 范围：提示词库 CRUD 与 AI 整理
- 依赖：1.5
- 验收：`/api/prompt-library` 及 save/delete/refine 行为不变

### 3.3 prompts/cards.mjs
<!-- comet-task-ref:83abe6ad-93ba-4c6d-840b-df294bb1704e -->
- 范围：技能拆分、翻译、说明卡生成、报错分析
- 依赖：3.2、3.1
- 验收：generate-card、generate-cards-batch、translate-skill 行为不变

### 3.4 catalog 扫描模块
<!-- comet-task-ref:44876758-4b2f-4316-b5c4-184c9f1bbdff -->
- 范围：hooks / skills / mcp / plugins 扫描、推荐、`fileDetail`、开关
- 依赖：3.1
- 验收：`overview` 数据字段与开关行为不变

### 3.5 catalog/metrics.mjs
<!-- comet-task-ref:6b37ce2e-fbe9-4de5-b809-7ade2f0c3b91 -->
- 范围：`sessionMetrics`、`overview`、`sessionMetricCache`
- 依赖：3.4
- 验收：`/api/state` 返回内容不变

### 3.6 catalog/errors.mjs
<!-- comet-task-ref:1766950c-b66f-49cc-b6ea-bca77bf046ea -->
- 范围：`errorRows`、`errorRowsCache`
- 依赖：3.5
- 验收：`/api/state` 报错记录字段不变

## 组 4：有状态领域

### 4.1 channels/store.mjs
<!-- comet-task-ref:d9e4f754-51e3-4e9e-8c48-f7e808d9340f -->
- 范围：渠道状态、密钥保护、`saveChannel`、`activateChannel`、`channelApiKey`
- 依赖：1.5
- 验收：`/api/state` 渠道数据与 save/activate 行为不变

### 4.2 channels/models.mjs
<!-- comet-task-ref:c2302391-0477-45c4-96a3-6e696d1ab94b -->
- 范围：`modelData`、模型拉取、`saveModels`、`setChannelFallbacks`、项目设置辅助
- 依赖：4.1
- 验收：四个模型相关端点行为不变

### 4.3 channels/benchmark.mjs
<!-- comet-task-ref:7689b70a-2d62-4335-9151-6e5df4e4c75c -->
- 范围：测速请求、结果保存、`updateModelBenchmarkRun`、`callChannelModel`
- 依赖：4.1
- 验收：两个测速端点行为不变

### 4.4 terminal/sessions.mjs
<!-- comet-task-ref:e2b42d1f-6b38-4d3d-977f-2b2b7a0e0f72 -->
- 范围：终端管理器、WebSocket 服务、心跳、`createWorkspaceSession`
- 依赖：2.1、2.2、3.1
- 验收：新建对话、终端输入输出、关闭会话正常

### 4.5 sdk/bridge.mjs
<!-- comet-task-ref:a6872083-f7de-4433-a984-8b4724cf6159 -->
- 范围：`createSdkRuntime` 装配、SDK 事件流升级处理
- 依赖：4.1、4.2、4.4
- 验收：`/api/sdk/health` 响应不变，事件流可连接

## 组 5：路由表与入口

### 5.1 routes/index.mjs
<!-- comet-task-ref:12cf0826-1a26-4baf-8e60-493e4fc8cbfb -->
- 范围：`GET_ROUTES` / `POST_ROUTES` Map + `routes/handlers.mjs` 领域 handler
- 依赖：组 2-4 全部完成
- 约束：保留 body 解析条件、404 顺序、statusCode 透传
- 验收：`tests/server-routes.test.mjs` 覆盖命中、404、透传并通过

### 5.2 upgrade 路由表
<!-- comet-task-ref:d1644265-071f-4986-9a54-11da6e155b0d -->
- 范围：`/api/sdk/events` 与 `/api/workspace/terminal` 升级处理
- 依赖：5.1
- 验收：两条事件流可连接，非法 origin 被拒绝

### 5.3 入口瘦身
<!-- comet-task-ref:48fca3dd-f5dd-4dec-bcee-467a4577c4e4 -->
- 范围：`server.mjs` 只保留 `createServer` 工厂、监听与优雅退出
- 依赖：5.1、5.2
- 验收：`node --check` 通过，文件行数 ≤ 100

### 5.4 清理旧代码
<!-- comet-task-ref:fe168007-b1f3-482c-814c-82591bba0f79 -->
- 范围：删除已迁移的函数与 import
- 依赖：5.3
- 验收：`npm test` 通过，无重复定义

## 组 6：打包与最终验证

### 6.1 更新打包脚本
<!-- comet-task-ref:7747ad46-b87d-438e-bb5a-bf889ffd2481 -->
- 范围：`prepare-desktop-resources.mjs` 复制 `server/`
- 依赖：5.4
- 验收：`npm run build:desktop` 后 staged 目录包含完整 `server/`

### 6.2 全量测试
<!-- comet-task-ref:e19ec812-4379-431d-a86a-48fea84b5930 -->
- 验收：`npm test` 退出码 0

### 6.3 前端构建
<!-- comet-task-ref:1ce28d27-713d-4a68-a408-06897b42159e -->
- 验收：`npm run build` 退出码 0

### 6.4 端点冒烟
<!-- comet-task-ref:62beb285-393f-42f5-ac68-18841c68181f -->
- 验收：`/api/state`、`/api/workspace/projects`、`/api/workspace/sessions`、`/api/sdk/health` 响应结构与基线一致

### 6.5 行为对照
<!-- comet-task-ref:3375ff9b-279c-4352-b0e4-ca8b022fec92 -->
- 验收：响应字段、错误消息、状态码与 1.1 基线一致，记录结果
