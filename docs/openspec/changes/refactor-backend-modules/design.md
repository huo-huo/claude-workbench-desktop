---
comet_change: refactor-backend-modules
role: technical-design
canonical_spec: openspec
---

## Context

`server.mjs` 目前是 2477 行的单文件 Node.js 服务，包含 HTTP 路由（60 余条顺序 `if` 分支）、工作区状态、文件树与文件操作、文件夹选择与回收站、PTY 终端与 WebSocket、渠道与密钥、模型拉取与测速、提示词库、Hooks/Skills/MCP/Plugins 扫描、报错分析、更新检查以及 SDK 桥接。模块间通过文件顶部的全局常量和少量模块级可变状态（`workspaceTerminals`、`workspaceWs`、`sdkRuntime`、各类缓存）隐式共享。动机与范围见 `proposal.md`。

额外约束：

- `server.mjs` 是 Tauri 寻找的服务入口（`src-tauri/src/main.rs` 按文件名定位），入口路径不能变
- `scripts/prepare-desktop-resources.mjs` 只复制 `server.mjs` 与 `sdk-runtime.mjs` 到 `resources/workbench/`，拆分后必须同步复制新模块目录
- `sdk-runtime.mjs` 已有 767 行和完整测试，边界清晰，本次不动

## Goals / Non-Goals

**Goals:**

- `server.mjs` 只保留启动、组装、路由挂载和优雅退出
- 按领域建立单方向依赖的模块目录，每个模块职责单一、可独立阅读
- HTTP 路由改为集中声明的路由表，消除顺序 `if` 链
- 所有外部行为保持不变，并为拆分出的基础模块补充冒烟测试

**Non-Goals:**

- 不引入依赖注入容器、Web 框架或新运行时依赖
- 不拆分 `sdk-runtime.mjs`
- 不改变并发模型、端口、启动参数或持久化文件格式
- 不做函数级重构以外的行为优化、错误处理调整或日志改动

## Decisions

### D1：模块放在项目根目录 `server/`，入口仍为 `server.mjs`

`src/` 当前是 Vite 前端源码目录，后端代码放进去会造成构建边界混淆。选择根目录 `server/`，与 `server.mjs` 入口并列；入口内只做装配。

```
server/
  core/        paths.mjs / storage.mjs / http.mjs
  workspace/   state.mjs / files.mjs / native.mjs / sessions.mjs
  terminal/    sessions.mjs
  channels/    store.mjs / models.mjs / benchmark.mjs
  prompts/     library.mjs / cards.mjs
  catalog/     hooks.mjs / skills.mjs / mcp.mjs / plugins.mjs / metrics.mjs / errors.mjs
  platform/    updates.mjs
  sdk/         bridge.mjs
  routes/      index.mjs / handlers.mjs
```

备选：`src/server/`（与前端同根，易与 Vite 入口混淆，放弃）；单层 `server/*.mjs`（文件数多且无分组，放弃）。

### D2：分层只做单向依赖，不引入容器

依赖方向固定为 `routes -> domains -> core`，`core` 不反向依赖任何领域模块。跨模块共享的少量状态以模块单例导出（ESM 模块缓存天然单例），保持现有语义；不引入 DI 容器或事件总线。

### D3：HTTP 路由用集中路由表

`routes/index.mjs` 声明 `GET_ROUTES`、`POST_ROUTES` 两组 `Map`，`Map` 中每条记录保存处理函数；匹配不到时沿用现有 404 与静态资源兜底逻辑。WebSocket upgrade 同样按路径用分支表处理，保留 `sdk/events` 与 `workspace/terminal` 两条现有路径及 origin 校验。

行为等价要求：

- `POST /api/*` 才读取并解析 JSON body 的规则不变
- `error.statusCode` 优先、未知错误按 400 返回的兜底不变
- 静态资源兜底与 `serveWorkspaceAsset` 的匹配顺序不变

handler 归属：`routes/handlers.mjs` 按领域提供 handler，是唯一接触 `req` / `res` / body 的层；领域模块只导出业务函数，不感知 HTTP。`routes/index.mjs` 只负责 Map 声明与分发。

备选：保留顺序 `if` 链只做函数迁移（改动小但未消除问题，放弃）；领域模块各自导出 handler（HTTP 与领域耦合，放弃）；引入 Express/Fastify（新增依赖，违反约束，放弃）。

### D4：迁移以函数为最小单位，不改变函数实现

迁移只做三件事：移动函数、把闭包依赖改为显式 import、把共享常量改为从 `core` 导入。函数体逻辑、错误消息、默认值和边界条件保持原样。命名保持现有名称，便于对照。

### D5：打包脚本同步复制 `server/` 目录

`scripts/prepare-desktop-resources.mjs` 增加 `fs.cpSync(root/server, destination/server, { recursive: true })`。`src-tauri/src/main.rs` 不做改动。

### D6：测试覆盖基础层、路由层与端点冒烟

- `tests/server-core.test.mjs`：JSON 原子写入、损坏 JSON 回退、路径安全、请求体限制与 MIME 回退
- `tests/server-routes.test.mjs`：GET/POST 路由表命中、未命中 404、`statusCode` 透传
- `tests/server-smoke.test.mjs`：通过工厂启动真实服务（随机端口），请求 `/api/state`、`/api/workspace/projects`、`/api/workspace/sessions`、`/api/sdk/health`，断言状态码与关键字段；只读端点，不写入真实配置
- 现有 `tests/sdk-runtime.test.mjs` 必须保持全绿
- 原生操作（文件夹选择、回收站、资源管理器定位）保留手工冒烟

### D7：服务创建改为可测试工厂，入口行为不变

`server.mjs` 导出 `createServer(options = {})`，内部创建 HTTP server 与 WebSocket upgrade 处理，可注入端口；`server.mjs` 在作为入口执行时调用工厂并监听默认端口。这样冒烟测试可以启动真实服务而不依赖固定端口，且入口的启动、端口与退出行为保持不变。

## Risks / Trade-offs

- **隐式闭包依赖遗漏** → 迁移前导出 `server.mjs` 的调用关系清单，按依赖顺序迁移，每迁完一层运行 `npm test`
- **ESM 循环依赖** → 强制 `core` 层不 import 领域模块；发现循环时把共享逻辑下沉到 `core`
- **行为漂移（响应字段、错误消息、状态码）** → 以现有函数体为准逐字迁移，路由表改造后对比关键端点的响应结构
- **打包资源漏复制导致桌面版启动失败** → 更新 `prepare-desktop-resources.mjs`，执行 `npm run build:desktop` 并检查 staged 目录包含 `server/`
- **冒烟测试触碰真实用户配置** → 只请求只读端点，不调用写入接口；测试使用随机端口与独立超时，避免影响正在运行的本机实例
- **模块拆分过细增加跳转成本** → 按领域聚合，不为单个函数建文件；同一领域内聚到 1-3 个文件

## Migration Plan

1. 建立 `server/core/`，迁移路径常量、JSON 读写与 HTTP 辅助函数；运行测试
2. 迁移无状态领域：`catalog/`、`platform/updates`、`prompts/`
3. 迁移有状态领域：`workspace/`（含文件与原生操作）、`channels/`、`terminal/`、`sdk/`
4. 建立 `routes/` 路由表与 `routes/handlers.mjs`，接管现有分发逻辑
5. `server.mjs` 瘦身为入口：导出 `createServer` 工厂，导入路由、启动 HTTP 与 WebSocket、注册退出清理
6. 更新 `prepare-desktop-resources.mjs`，补充基础层、路由表与端点冒烟测试，执行 `npm test`、`npm run build`、`npm run build:desktop` 验证

回滚策略：全部改动位于 worktree 的独立分支，任一步验证失败可整体回退到基线提交。
