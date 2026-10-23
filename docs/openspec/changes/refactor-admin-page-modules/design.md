---
comet_change: refactor-admin-page-modules
role: technical-design
canonical_spec: openspec
---

## Context

`index.html` 273 行、107 KB，结构为：管理页骨架（导航、页面容器、抽屉、toast）→ 33 行内联样式 → 169 行压缩式内联脚本 → `<script type="module" src="/src/workstation.js">`。管理页脚本与管理页 DOM 一一对应，与 `workstation.js` 没有共享状态或函数。

脚本内部结构：

- 状态：`data`、`currentPage`、`query`、`statusFilter`、`editingChannelId`、`channelFormVisible`、`skillSource`、`skillSort`、`skillFilter`、`listPage`，以及 `window._flowOpen`、`_benchmarkChannel`、`_benchmarkErrors`、`_manualError`、`_selectedErrorId`、`_openDetailId`、`_toast` 等全局临时状态
- 公共：`esc`、`labelModel`、`toast`、`displayTime`、`displayDateTime`、`loadState`、`setPage`、`post`
- 页面渲染：`dashboardPage`、`channelModelPage`、`hookCardsPage`、`skillCardsPage`、`mcpCardsPage`、`pluginCardsPage`、`versionPage`、`errorPage`、`diagnosisPage`
- 交互：`wireFilters`、`wireToggles`、`wireDetails`、`wireChannels`、`wireCards`、`wireDiagnosis`、`wireVersions`、`wireSkillTranslationControls`
- 渲染入口 `render()` 与底部初始绑定、60 秒轮询

动机与范围见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 管理页脚本成为可独立阅读的 ES module，按页面与公共能力分文件
- `index.html` 只保留骨架与入口引用
- 保留全部 DOM 结构、选择器、交互、文案、接口调用与 60 秒轮询行为

**Non-Goals:**

- 不引入前端框架或状态管理库
- 不拆分 index.html 的 33 行内联样式（管理页样式，改动无收益）
- 不修改后端接口与响应结构
- 复用已有的 Playwright 依赖，不引入其他测试框架

## Decisions

### D1：目录结构 `src/admin/`

```
src/admin/
  index.mjs          # 入口：loadState、render、初始绑定、轮询
  state.mjs          # 页面状态与 window._* 临时状态的读写
  core/dom.mjs       # esc、toast、displayTime、displayDateTime、post
  pages/dashboard.mjs
  pages/models.mjs
  pages/hooks.mjs
  pages/skills.mjs
  pages/mcp.mjs
  pages/plugins.mjs
  pages/versions.mjs
  pages/errors.mjs
  pages/diagnosis.mjs
  common/cards.mjs    # filteredRows、toolbar、flowLine、cardDescription、generateButton、flowButton
  common/actions.mjs  # wireFilters、wireToggles、wireCards、wireDetails、openDetail、batchToggle
  common/translate.mjs # translateOneSkill、wireSkillTranslationControls、runSkillTranslationBatch
```

备选：全部放在 `src/admin.js` 单文件（只是换位置，未解决模块化，放弃）。

### D2：保留 `window._*` 全局键，用 `state.mjs` 统一读写

现有代码大量使用 `window._flowOpen` 等全局键做临时状态，且可能与调试或其他脚本交互。迁移时保留这些键的实际存储位置（`window`），在 `state.mjs` 中提供命名函数读写，避免散落的直接访问。页面级状态（`data`、`currentPage` 等）放入 `state.mjs` 导出的对象。

### D3：`render()` 与各页面渲染器保持原有调用契约

`render()` 继续根据 `currentPage` 从渲染器表取函数、写入 `#page.innerHTML`，随后按原顺序调用 `wireFilters`、`wireToggles`、`wireDetails`、`wireCards`，并按页面调用 `wireChannels` / `wireDiagnosis`。渲染器各自从 `state.mjs` 读取数据，不接收参数。

### D4：`index.html` 改为 module 入口并保留全局导出

把内联 `<script>` 替换为 `<script type="module" src="/src/admin/index.mjs"></script>`，位置保持在原脚本处（`workstation.js` 之前）。入口继续导出 `window.workbenchToast = toast` 与 `window.setWorkbenchPage = setPage`。

模块脚本默认 defer，DOM 解析完成后执行；原内联脚本位于 body 末尾，执行时机差异不影响页面功能，但验收时需确认首屏加载与自动扫描正常。

### D5：验证采用构建 + Playwright 冒烟 + 逐页验收

抽离完成后运行 `npm run build`，并复用 `@playwright/test` 与 chromium 新增管理页冒烟：

- 管理页加载并完成首次数据渲染
- 导航切换到渠道、Hooks、Skills、MCP、插件、版本、报错、诊断页面
- 关键词筛选
- 详情抽屉打开与关闭
- 刷新按钮触发重新扫描

冒烟只访问只读端点与纯前端交互，不保存渠道、不切换开关、不触发 AI 分析。渠道保存、批量开关、翻译与诊断等写操作保留手工验收。

### D6：Playwright 依赖与脚本边界

新增 devDependency `@playwright/test`，只使用已安装的 chromium。`playwright.config.mjs` 通过 `webServer` 启动 `node server.mjs`（独立端口），测试文件放在 `tests/e2e/admin.spec.mjs`，通过 `npm run test:e2e` 执行。

备选：仅手工验收（用户明确要求可重复冒烟，放弃）；把冒烟并入 `npm test`（每次单测都启动浏览器，放弃）。

## Risks / Trade-offs

- **压缩式长行迁移时漏片段** → 以函数为单位逐段搬迁，迁移后对照原脚本逐函数核对
- **`window._*` 状态遗漏导致交互失效** → 统一经 `state.mjs` 读写，迁移时搜索全部 `window._` 引用核对
- **module 延迟执行改变首屏时序** → 入口保持原有初始化顺序（`loadState` → `render` → 定时器），验收首屏与轮询
- **Vite 打包产物结构变化** → 属于预期变化；确认 `dist/index.html` 正确引用打包后的模块脚本
- **全局导出丢失** → 保留 `window.workbenchToast` 与 `window.setWorkbenchPage`，验收时检查存在
- **Playwright 固定端口与浏览器依赖** → 使用独立端口 4199；测试前确认 chromium 已安装，环境问题不当作实现回归
- **冒烟测试触碰真实配置** → 只访问只读端点与纯前端交互，不保存渠道、不切换开关

## Migration Plan

1. 建立 `src/admin/core/` 与 `state.mjs`，迁移公共函数
2. 迁移页面渲染器（dashboard → models → hooks/skills/mcp/plugins → versions/errors → diagnosis）
3. 迁移公共交互（筛选、开关、详情、卡片、批量、翻译）
4. 建立 `index.mjs`，迁移 `render`、初始绑定与轮询
5. 替换 `index.html` 内联脚本为 module 入口
6. 配置 Playwright 管理页冒烟
7. 构建、冒烟与逐页手工验收

回滚策略：所有改动位于 worktree 独立分支，任一步验证失败可整体回退到基线提交。
