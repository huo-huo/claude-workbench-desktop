## 1. 服务端设置存储

- [x] 1.1 新建 `server/workspace/preferences.mjs`，实现字段白名单、类型/范围校验与合并写入（验证：单元测试覆盖合法合并、未知字段忽略、非法字段拒绝） <!-- comet-task:3dc461c6-fdb4-45b5-a609-73573f7b77d0 -->
- [x] 1.2 在 `server/workspace/state.mjs` 中读取/保存 `preferences`，复用 `atomicJson`（验证：`tests/workspace-state.test.mjs` 扩展用例通过，重启读取一致） <!-- comet-task:ab2859b1-7d4c-40e2-abc2-0d30aa25800b -->
- [x] 1.3 在 `server/routes/handlers.mjs` 增加 `GET/POST /api/workspace/preferences`（验证：路由测试覆盖读取空设置、合并写入、非法字段 400） <!-- comet-task:c2446ce1-d88b-4c77-af1d-a66ef879542e -->

## 2. 前端设置加载与迁移

- [x] 2.1 新建 `src/workspace/settings.mjs`：加载服务端设置、应用 `app` 字段、写入 `localStorage` 缓存（验证：单元测试覆盖服务端成功、超时/失败回退缓存） <!-- comet-task:c02c85ec-692b-48e1-8489-aa85c87966c0 -->
- [x] 2.2 实现首次迁移：服务端为空时把现有 `localStorage` 键逐字段校验后写入（验证：单元测试覆盖迁移成功、已有服务端设置不覆盖、写入失败保留本地值） <!-- comet-task:1b090d82-3447-4923-a999-4906c94d5ce7 -->
- [x] 2.3 实现防抖合并写入 `saveWorkspaceSettings(patch)`（验证：单元测试覆盖连续修改只写一次、失败不阻断） <!-- comet-task:c1866fd0-ee97-4d5b-aa3d-1320c186a45f -->
- [x] 2.4 在 `src/workstation.js` 中先加载设置再渲染工作区，失败时提示并继续（验证：浏览器首屏主题与字号符合服务端设置） <!-- comet-task:0602c11f-0f66-4816-882c-c2746527f30b -->

## 3. 统一现有设置读写

- [x] 3.1 改造 `src/workspace/state.mjs` 与 `src/workspace/init.mjs`：视图、主题、侧栏折叠、项目展开读自 `app`/设置对象（验证：切换后刷新页面状态保持） <!-- comet-task:3d593da1-c70a-4e41-8972-89007757a1b9 -->
- [x] 3.2 改造 `src/workspace/preferences.mjs`、`projects.mjs`、`terminal.mjs`：字号、折叠项目、当前项目写入统一设置接口（验证：重启后终端字号与当前项目恢复） <!-- comet-task:5530cc21-4b40-451a-b820-588c415c1428 -->
- [x] 3.3 改造 `src/workspace/statusline.mjs`：状态栏显示项与字号纳入统一设置，同时保留配置面板交互（验证：调整后重启配置一致） <!-- comet-task:c017342f-69c4-4790-b2be-a54dcfa2f442 -->

## 4. 新增界面状态与显隐

- [x] 4.1 持久化输入区展开、会话栏折叠、文件栏折叠状态并在启动时恢复（验证：刷新与重启后状态一致） <!-- comet-task:f78c98f0-34d5-488f-80d8-d0c910d3ce20 -->
- [x] 4.2 在状态栏配置面板增加「显示状态栏」「显示工具栏」开关，默认显示并持久化（验证：关闭后区域移除、重启保持隐藏） <!-- comet-task:090cf90d-6831-454e-a5d4-938657ed74cb -->
- [x] 4.3 调整 `terminal.css` 的网格布局，使隐藏工具栏/状态栏后终端自动扩展，并保留可恢复入口（验证：隐藏后终端高度变化，仍能从可见入口重新开启） <!-- comet-task:94407745-aabb-40b8-909b-aa58d907b108 -->

## 5. 验证

- [x] 5.1 运行 `npm test` 与 `npm run build`（验证：退出码 0，无新增告警） <!-- comet-task:6e4b73e0-2227-4b84-90f1-6e4b5c90fd3b -->
- [x] 5.2 端到端验证跨端口持久化：写入设置后用不同端口重启服务并打开页面（验证：主题、字号、状态栏配置与显隐状态均保持） <!-- comet-task:eaffb6c3-923e-4558-a2b9-ec4620a4f944 -->
- [x] 5.3 降级验证：停掉服务端设置接口后启动页面（验证：页面用本地缓存正常启动并提示读取失败） <!-- comet-task:b1759e8c-43ec-4d71-8d41-2994a4122ff1 -->
