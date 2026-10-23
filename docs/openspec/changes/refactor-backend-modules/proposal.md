## Why

`server.mjs` 已增长到 2477 行，同时承担 HTTP 路由、工作区与会话管理、文件与终端、渠道与密钥、模型测速、提示词库、配置扫描与 SDK 桥接等十余类职责。任何一处修改都必须在混杂的全局状态中定位，回归风险高，也无法对单个职责进行独立测试。需要在严格不改变对外行为的前提下按职责拆分模块，建立可独立理解和验证的边界。

## What Changes

- 将 `server.mjs` 拆分为路由层与领域模块，`server.mjs` 只保留启动与组装职责
- 新增基础层模块：JSON 持久化、路径安全、HTTP 请求与响应辅助
- 按领域拆分模块：工作区与会话、文件树与文件操作、终端 PTY/WebSocket、渠道与密钥、模型拉取与测速、提示词库、Hooks/Skills/MCP/Plugins 扫描、报错分析、更新检查、SDK 桥接
- HTTP 路由从 60 余条顺序 `if` 分支改为集中注册的路由表，端点路径、方法与响应保持不变
- 为拆分出的关键模块补充冒烟测试

无 **BREAKING** 变更：所有 API 端点、请求体、响应结构与持久化文件格式保持不变。

## Capabilities

### New Capabilities

无。本次为纯重构，不改变规格级行为。

### Modified Capabilities

无。现有能力的行为与验收要求均不变。

## Impact

- 代码：`server.mjs` 变为组装入口；新增 `src/server/` 模块目录；`sdk-runtime.mjs` 保持既有边界不变
- API：所有 `/api/*` 端点路径、方法、请求与响应不变
- 依赖：不新增任何运行时依赖
- 持久化：`workbench-state.json`、`workbench-workspace.json`、`workbench-secrets.dpapi.json` 等文件格式不变
- 测试：新增关键模块冒烟测试；现有 `tests/sdk-runtime.test.mjs` 必须保持通过
