---
comet_change: refactor-workspace-frontend
role: technical-design
canonical_spec: openspec
---

## Context

`src/workstation.js` 是 Vite 入口（`index.html` 通过 `<script type="module" src="/src/workstation.js">` 加载），1526 行，顶部定义 20 余个模块级可变状态，末尾的 `setupWorkspace()` 集中完成全部事件绑定。它与管理页内联脚本相互独立，没有共享的全局函数或状态。

领域函数分布：项目（`refreshProjects`/`renderProjects`/`activateProject`/`selectProject`/`hideProjectFromList`）、会话（`refreshSessions`/`startSession`/`openSavedSession`/`removeSession`/会话分组与活动监控）、终端（`ensureTerminal`/`connectTerminal`/`fitTerminal`/`pasteClipboardToTerminal`）、文件树（`refreshTree`/`toggleTreeFolder`/`wireTree`/`openProjectFile`/右键菜单）、输入区（`toggleComposer`/`sendComposerToTerminal`/图片粘贴与拖放）、提示词库（`openPromptManager`/`analyzePromptDraft`/`savePromptDraft`）、偏好（主题、字号、视图与折叠状态）。动机与范围见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 每个领域模块职责单一、可独立阅读，函数体逻辑保持不变
- 状态按领域集中，模块间依赖显式可见
- 事件绑定按领域拆分，入口只负责初始化顺序
- `src/workstation.css` 按原顺序拆分为独立样式文件

**Non-Goals:**

- 不引入前端框架或状态管理库
- 不改变任何 DOM 结构、CSS 选择器、交互、文案与 localStorage 键
- 除 Playwright 冒烟外不新增测试框架
- 不修改 `index.html` 与管理页内联脚本

## Decisions

### D1：目录结构 `src/workspace/` + `src/styles/`

```
src/
  workstation.js        # 入口：导入样式与 init
  workspace/
    core/dom.mjs        # $、escapeHtml
    core/api.mjs        # api()、toast()
    state.mjs           # 共享可变状态对象
    preferences.mjs     # 主题、字号、视图、折叠与导航状态
    projects.mjs
    sessions.mjs
    activity.mjs        # 会话活动监控
    terminal.mjs
    files.mjs
    composer.mjs
    prompts.mjs
    init.mjs            # setupWorkspace 拆分后的初始化与 wire 汇总
  styles/
    theme.css / layout.css / projects.css / sessions.css / files.css
    terminal.css / composer.css / prompts.css
```

`src/` 已是 Vite 源码目录，子目录不影响现有入口。备选：项目根新建 `web/`（需要改 Vite 配置与入口，放弃）。

### D2：共享状态用 `state.mjs` 导出的单一对象

把现有模块级变量平移到 `export const app = { ... }`，字段名与初值保持不变；各模块通过 `app.projectPath`、`app.activeSession` 等方式读写。不增加 getter/setter 或事件订阅抽象。

备选：每个领域各自持有状态并通过函数访问（改动面大、跨领域往返多，放弃）；引入状态管理库（新增依赖，放弃）。

### D3：终端模块拥有 xterm 实例与 WebSocket

`terminal.mjs` 导出 `ensureTerminal`、`connectTerminal`、`fitTerminal`、`sendTerminalInput` 等；`app.terminal`、`app.socket` 仍放在共享状态中供会话模块判断连接状态。会话模块通过终端模块的导出函数操作连接，不直接读写 xterm 实例。

### D4：事件绑定拆为 `wire*`，由 `init.mjs` 按原顺序调用

`setupWorkspace()` 内的绑定按领域拆为 `wireProjects`、`wireSessions`、`wireFiles`、`wireTerminal`、`wireComposer`、`wirePrompts`、`wirePreferences`，`init.mjs` 以与原文相同的顺序调用，并保留原有定时器与全局事件监听。

### D5：CSS 按原文件顺序拆分并顺序导入

按现有段落顺序拆为 `theme.css`（深色主题覆盖）、`layout.css`（外壳与栅格）、`projects.css`、`sessions.css`、`files.css`、`terminal.css`、`composer.css`、`prompts.css`。入口按原顺序 `import`，保证层叠顺序与拆分前一致。

### D6：验证采用构建 + Playwright 冒烟 + 手工验收

- 每个任务完成后运行 `npm run build`
- 新增 Playwright 冒烟测试：`playwright.config.mjs` 通过 `webServer` 启动 `node server.mjs`（随机端口），只访问只读端点
- 冒烟场景：管理页加载、切换到工作区、主题切换、终端字号、提示词库开关、文件树空状态
- 不创建真实终端会话、不添加项目、不写入任何配置
- 原生文件夹选择、回收站、资源管理器定位与真实终端会话保留手工验收

### D7：Playwright 依赖与配置边界

新增 devDependency `@playwright/test`，只安装 chromium 浏览器。测试文件放在 `tests/e2e/`，与现有 Node 测试分离；`npm test` 仍运行原有 Node 测试，Playwright 通过独立脚本 `npm run test:e2e` 执行。

备选：在 `npm test` 中串联 Playwright（会让每次单测都启动浏览器，放弃）；仅手工验收（用户明确要求可重复冒烟，放弃）。

## Risks / Trade-offs

- **跨领域状态归属不清导致行为漂移** → 先平移到 `app` 对象、保持字段名，迁移时只做 `x` → `app.x` 的机械替换
- **模块循环依赖** → 依赖方向固定为 `core -> state -> 领域模块 -> init`；终端与会话的相互调用通过终端模块导出函数，不反向导入会话模块
- **事件绑定顺序变化** → `init.mjs` 严格保持 `setupWorkspace` 原有调用顺序
- **CSS 层叠顺序变化** → 入口按原段落顺序 import，拆分后逐段对比样式效果
- **xterm 实例生命周期** → 实例仍只创建一次，迁移时保留 `ensureTerminal` 的幂等判断
- **Playwright 依赖体积与网络** → 只安装 chromium；测试失败时先确认浏览器已安装，不把环境问题当作实现回归
- **冒烟测试触碰真实配置** → 测试只访问只读端点与纯前端交互，不创建会话、不添加项目

## Migration Plan

1. 建立 `core/` 与 `state.mjs`，迁移工具函数与共享状态
2. 迁移项目与偏好模块，`npm run build` 验证
3. 迁移会话与活动监控模块
4. 迁移终端模块
5. 迁移文件树、输入区与提示词模块
6. 拆分 `setupWorkspace` 为 `wire*` 与 `init.mjs`
7. 拆分 CSS 并调整入口导入
8. 配置 Playwright 与冒烟用例
9. 构建、Playwright 与手工验收

回滚策略：所有改动位于 worktree 独立分支，任一步验证失败可整体回退到基线提交。
