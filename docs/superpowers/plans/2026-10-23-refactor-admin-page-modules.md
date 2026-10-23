---
change: refactor-admin-page-modules
design-doc: docs/openspec/changes/refactor-admin-page-modules/design.md
base-ref: 22c8d52559df4af0ad42c6030d982465297c1535
---

<!-- comet-task-authority: docs/openspec/changes/refactor-admin-page-modules/tasks.md -->

# refactor-admin-page-modules 实施计划

## 执行配置

- build_mode: subagent-driven-development
- tdd_mode: direct
- review_mode: standard

## 文件结构

```
src/admin/
  index.mjs              入口：loadState、setPage、render、初始绑定、60 秒轮询
  state.mjs              页面状态与 window._* 读写
  core/dom.mjs           esc、toast、displayTime、displayDateTime、post、labelModel
  pages/dashboard.mjs    概览页
  pages/models.mjs       渠道与模型页 + 表单 + wireChannels
  pages/hooks.mjs        Hooks 页
  pages/skills.mjs       Skills 页 + 翻译按钮装配
  pages/mcp.mjs          MCP 页
  pages/plugins.mjs      插件页
  pages/versions.mjs     版本页 + wireVersions
  pages/errors.mjs       报错记录页
  pages/diagnosis.mjs    诊断页 + wireDiagnosis
  common/cards.mjs       filteredRows、toolbar、flowLine、cardDescription、generateButton、flowButton
  common/actions.mjs     wireFilters、wireToggles、wireCards、wireDetails、openDetail、batchToggle
  common/translate.mjs   translateOneSkill、wireSkillTranslationControls、runSkillTranslationBatch
```

## 总体策略

- 源文件 `index.html` 第 105-273 行为传统内联脚本。函数体多为压缩长行，迁移时按函数逐个提取，函数体保持原样
- 页面级状态与 `window._*` 统一由 `state.mjs` 读写；`window._*` 的实际存储位置不变
- 函数体逻辑、文案、选择器、接口调用与 60 秒轮询保持不变
- 每完成一个工作包运行 `npm run build`
- 实现代理只负责实现与自测，不勾选任务；主会话负责验收、审查与勾选

## 组 1：基线与公共层

### 1.1 记录基线
<!-- comet-task-ref:2b34f6cf-8892-45d8-b959-81df968bfa04 -->
- 范围：`npm run build`，保存 `dist/index.html` 引用结构
- 验收：退出码 0

### 1.2 core/dom.mjs
<!-- comet-task-ref:49bc81c5-f1d3-4454-842c-9be24fc8f9ec -->
- 范围：`esc`、`toast`、`displayTime`、`displayDateTime`、`post`、`labelModel`
- 验收：构建通过

### 1.3 state.mjs
<!-- comet-task-ref:8d29ad61-7c79-4197-9b05-f2db9c7e4ec7 -->
- 范围：`data`、`currentPage`、`query`、`statusFilter`、`editingChannelId`、`channelFormVisible`、`manualError`、`skillSource`、`skillSort`、`skillFilter`、`listPage`，以及 `window._flowOpen`、`_benchmarkChannel`、`_benchmarkErrors`、`_manualError`、`_selectedErrorId`、`_openDetailId`、`_toast` 的读写函数
- 验收：构建通过；原脚本全部 `window._` 引用有对应迁移

### 1.4 common/cards.mjs
<!-- comet-task-ref:5051d50b-de2e-4d9d-8778-64f5d0cf6664 -->
- 范围：`filteredRows`、`toolbar`、`flowLine`、`cardDescription`、`generateButton`、`flowButton`
- 验收：构建通过

## 组 2：页面渲染器

每个页面任务：从内联脚本提取对应函数，写为 ES module 导出，内部引用 `state.mjs` 与 `core/dom.mjs`，保持模板字符串逐字不变。

### 2.1 dashboard
<!-- comet-task-ref:29d9f368-ef3c-4e23-9857-7a331b4cf9f3 -->
- 范围：`dashboardPage`、`titleBlock`
- 验收：构建通过

### 2.2 models
<!-- comet-task-ref:71112c6b-df04-47cf-a2c7-4a92cd2d627c -->
- 范围：`channelModelPage`、`channelFormMarkup`、`channelFormMarkupV2`、`channelStateForUi`、`wireChannels`
- 验收：构建通过

### 2.3 hooks/mcp/plugins
<!-- comet-task-ref:41bf7a02-5139-4928-8c6e-e0cd8fea8051 -->
- 范围：三个页面渲染函数
- 验收：构建通过

### 2.4 skills
<!-- comet-task-ref:f7378a35-61a8-4f72-8faf-60bfa81d29ee -->
- 范围：`skillCardsPage` 与翻译按钮装配
- 验收：构建通过

### 2.5 versions/errors
<!-- comet-task-ref:80097df8-fd2e-445f-9857-73d225a244ef -->
- 范围：`versionPage`、`errorPage`、`wireVersions`
- 验收：构建通过

### 2.6 diagnosis
<!-- comet-task-ref:778a6539-0ad7-4e3e-9be4-d3cd9f89104a -->
- 范围：`diagnoseError`、`redactPrompt`、`agentPrompt`、`diagnosisPage`、`wireDiagnosis`
- 验收：构建通过

## 组 3：公共交互

### 3.1 actions
<!-- comet-task-ref:47a7d143-dd1c-41a2-9409-36f27c433f45 -->
- 范围：`wireFilters`、`wireToggles`、`wireCards`、`wireDetails`、`openDetail`、`getBatchRows`、`batchToggle`
- 验收：构建通过

### 3.2 translate
<!-- comet-task-ref:3bc2f5a6-70a3-49b3-91e3-c74bc7e134ea -->
- 范围：`translateOneSkill`、`wireSkillTranslationControls`、`runSkillTranslationBatch`、批量翻译状态
- 验收：构建通过

## 组 4：入口与 HTML

### 4.1 index.mjs
<!-- comet-task-ref:fe0cc49a-ea92-4feb-be71-c64744c88d1b -->
- 范围：`loadState`、`setPage`、`render`、导航与刷新绑定、抽屉绑定、初始 `loadState`、60 秒轮询；保留 `window.workbenchToast` 与 `window.setWorkbenchPage`
- 验收：构建通过

### 4.2 替换内联脚本
<!-- comet-task-ref:327e9853-0e4b-4635-93fa-a795da5aa7b9 -->
- 范围：`index.html` 105-273 行替换为 `<script type="module" src="/src/admin/index.mjs"></script>`
- 验收：`index.html` 不再包含管理页内联逻辑，构建通过

### 4.3 逐函数核对
<!-- comet-task-ref:a15e5d43-c392-44c3-86b5-ce9eb4461556 -->
- 验收：旧函数名在 `index.html` 中已不存在，全部在 `src/admin/` 中实现

## 组 5：Playwright 与验证

### 5.1 构建
<!-- comet-task-ref:cc6218f9-4657-41d7-b89d-6e620e9fc59a -->
- 验收：`npm run build` 退出码 0，`dist/index.html` 引用正确

### 5.2 Playwright 配置
<!-- comet-task-ref:66fedf18-2947-4ea1-a4ff-163ada5bb507 -->
- 范围：安装 `@playwright/test`，新增 `playwright.config.mjs`（端口 4199，webServer 启动 `node server.mjs`）与 `npm run test:e2e`
- 验收：`npx playwright --version` 可用

### 5.3 管理页冒烟
<!-- comet-task-ref:1038cd5e-baa9-4b44-b05a-3940c6af1bd7 -->
- 范围：`tests/e2e/admin.spec.mjs`：加载、导航切页、关键词筛选、详情抽屉开关、刷新
- 约束：监听 pageerror；不保存渠道、不切换开关、不触发 AI 分析
- 验收：五个场景均有断言

### 5.4 运行冒烟
<!-- comet-task-ref:13d0a4e6-5bb9-4aaa-9293-c7d71a0ddd29 -->
- 验收：`npm run test:e2e` 退出码 0

### 5.5 逐页手工验收
<!-- comet-task-ref:855a0050-585f-4619-8c52-e7e8c77bc638 -->
- 范围：九个页面渲染、筛选、详情、测速、翻译、诊断
- 验收：与基线一致

### 5.6 对照基线
<!-- comet-task-ref:130e3bb1-94df-4e25-9849-08c5d4903ee8 -->
- 验收：无行为变化并记录结果
