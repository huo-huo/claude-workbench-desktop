## 1. 基线与公共层

- [x] 1.1 在 worktree 运行 `npm run build`，记录基线结果并保存 `dist/index.html` 的引用结构作为对照（验证：退出码 0） <!-- comet-task:2b34f6cf-8892-45d8-b959-81df968bfa04 -->
- [x] 1.2 建立 `src/admin/core/dom.mjs`，迁移 `esc`、`toast`、`displayTime`、`displayDateTime`、`post`、`labelModel`（验证：`npm run build` 通过） <!-- comet-task:49bc81c5-f1d3-4454-842c-9be24fc8f9ec -->
- [x] 1.3 建立 `src/admin/state.mjs`，迁移页面级状态与 `window._*` 临时状态的读写函数（验证：构建通过，`grep` 确认原脚本中全部 `window._` 引用已有对应迁移） <!-- comet-task:8d29ad61-7c79-4197-9b05-f2db9c7e4ec7 -->
- [x] 1.4 建立 `src/admin/common/cards.mjs`，迁移 `filteredRows`、`toolbar`、`flowLine`、`cardDescription`、`generateButton`、`flowButton`（验证：构建通过） <!-- comet-task:5051d50b-de2e-4d9d-8778-64f5d0cf6664 -->

## 2. 页面渲染器迁移

- [x] 2.1 建立 `src/admin/pages/dashboard.mjs`，迁移 `dashboardPage` 与 `titleBlock`（验证：构建通过，概览页渲染一致） <!-- comet-task:29d9f368-ef3c-4e23-9857-7a331b4cf9f3 -->
- [x] 2.2 建立 `src/admin/pages/models.mjs`，迁移 `channelModelPage`、`channelFormMarkup`、`channelFormMarkupV2`、`channelStateForUi` 与 `wireChannels`（验证：构建通过，渠道新增/编辑/拉取模型/测速/切换行为一致） <!-- comet-task:71112c6b-df04-47cf-a2c7-4a92cd2d627c -->
- [x] 2.3 建立 `src/admin/pages/hooks.mjs`、`mcp.mjs`、`plugins.mjs`，迁移对应页面渲染函数（验证：构建通过，三页渲染一致） <!-- comet-task:41bf7a02-5139-4928-8c6e-e0cd8fea8051 -->
- [x] 2.4 建立 `src/admin/pages/skills.mjs`，迁移 `skillCardsPage` 与翻译按钮装配（验证：构建通过，Skills 页筛选、排序、分页与翻译入口一致） <!-- comet-task:f7378a35-61a8-4f72-8faf-60bfa81d29ee -->
- [x] 2.5 建立 `src/admin/pages/versions.mjs`、`errors.mjs`，迁移版本页、报错页与 `wireVersions`（验证：构建通过，两页渲染一致） <!-- comet-task:80097df8-fd2e-445f-9857-73d225a244ef -->
- [x] 2.6 建立 `src/admin/pages/diagnosis.mjs`，迁移 `diagnoseError`、`redactPrompt`、`agentPrompt`、`diagnosisPage` 与 `wireDiagnosis`（验证：构建通过，诊断页与复制提示词行为一致） <!-- comet-task:778a6539-0ad7-4e3e-9be4-d3cd9f89104a -->

## 3. 公共交互迁移

- [x] 3.1 建立 `src/admin/common/actions.mjs`，迁移 `wireFilters`、`wireToggles`、`wireCards`、`wireDetails`、`openDetail`、`getBatchRows`、`batchToggle`（验证：构建通过，搜索、筛选、开关、详情、批量操作一致） <!-- comet-task:47a7d143-dd1c-41a2-9409-36f27c433f45 -->
- [x] 3.2 建立 `src/admin/common/translate.mjs`，迁移 `translateOneSkill`、`wireSkillTranslationControls`、`runSkillTranslationBatch` 与批量翻译状态（验证：构建通过，单条与批量翻译流程一致） <!-- comet-task:3bc2f5a6-70a3-49b3-91e3-c74bc7e134ea -->

## 4. 入口与 HTML 替换

- [x] 4.1 建立 `src/admin/index.mjs`，迁移 `loadState`、`setPage`、`render`、导航与刷新绑定、抽屉绑定、初始 `loadState` 调用与 60 秒轮询，并保留 `window.workbenchToast` 与 `window.setWorkbenchPage`（验证：构建通过，页面自动加载与刷新正常） <!-- comet-task:fe0cc49a-ea92-4feb-be71-c64744c88d1b -->
- [x] 4.2 把 `index.html` 中 105-273 行的内联脚本替换为 `<script type="module" src="/src/admin/index.mjs"></script>`（验证：`index.html` 不再包含管理页内联逻辑，构建通过） <!-- comet-task:327e9853-0e4b-4635-93fa-a795da5aa7b9 -->
- [x] 4.3 确认原内联脚本中的全部函数均已在模块中实现，无遗漏（验证：逐函数对照清单，`grep` 确认旧函数名在 `index.html` 中已不存在） <!-- comet-task:a15e5d43-c392-44c3-86b5-ce9eb4461556 -->

## 5. Playwright 冒烟与最终验证

- [x] 5.1 运行 `npm run build`，确认构建通过且 `dist/index.html` 正确引用打包后的管理页脚本（验证：退出码 0，产物引用正确） <!-- comet-task:cc6218f9-4657-41d7-b89d-6e620e9fc59a -->
- [x] 5.2 安装 `@playwright/test`，新增 `playwright.config.mjs` 与 `npm run test:e2e` 脚本（验证：`npx playwright --version` 可用，配置可加载） <!-- comet-task:66fedf18-2947-4ea1-a4ff-163ada5bb507 -->
- [x] 5.3 编写 `tests/e2e/admin.spec.mjs`：管理页加载、导航切页、关键词筛选、详情抽屉开关、刷新按钮（验证：五个场景均有断言，且监听页面脚本错误） <!-- comet-task:1038cd5e-baa9-4b44-b05a-3940c6af1bd7 -->
- [x] 5.4 运行 `npm run test:e2e`，确认冒烟通过（验证：退出码 0，无失败用例） <!-- comet-task:13d0a4e6-5bb9-4aaa-9293-c7d71a0ddd29 -->
- [x] 5.5 启动 `npm run dev`，逐页手工验收：运行概览、渠道与模型、Hooks、Skills、MCP、插件、版本管理、报错记录、AI 诊断（验证：页面渲染、筛选、详情、测速、翻译、诊断全部与基线一致） <!-- comet-task:855a0050-585f-4619-8c52-e7e8c77bc638 -->
- [x] 5.6 对照 1.1 基线，确认无行为变化并记录结果（验证：验收清单全部通过） <!-- comet-task:130e3bb1-94df-4e25-9849-08c5d4903ee8 -->
