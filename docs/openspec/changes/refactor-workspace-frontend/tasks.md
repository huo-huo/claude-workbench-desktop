## 1. 基线与基础层

- [x] 1.1 在 worktree 运行 `npm run build`，记录基线结果作为后续对照（验证：退出码 0，`dist/` 产物生成） <!-- comet-task:687ae1e0-9032-413c-b602-0a9c11c02cca -->
- [x] 1.2 建立 `src/workspace/core/dom.mjs`，迁移 `$` 与 `escapeHtml`（验证：`npm run build` 通过） <!-- comet-task:0831b5ae-8114-469d-9ffd-1c492169cf72 -->
- [x] 1.3 建立 `src/workspace/core/api.mjs`，迁移 `api` 与 `toast`（验证：`npm run build` 通过） <!-- comet-task:255cb540-6795-4edd-96db-b45e8539bc0b -->
- [x] 1.4 建立 `src/workspace/state.mjs`，把 `workstation.js` 顶部全部模块级可变状态平移到 `app` 对象，字段名与初值保持不变（验证：`npm run build` 通过，`grep` 确认旧变量声明已移除） <!-- comet-task:e841903f-cd70-40fc-8302-f834ef450284 -->
- [x] 1.5 建立 `src/workspace/preferences.mjs`，迁移主题、字号、视图、项目折叠与导航折叠逻辑（验证：构建通过，切换主题与字号行为不变） <!-- comet-task:3184769c-81a8-4926-9c83-6841fcfc4bd7 -->

## 2. 项目与会话模块

- [x] 2.1 建立 `src/workspace/projects.mjs`，迁移项目刷新、渲染、选择、添加与隐藏相关函数（验证：构建通过，项目添加/切换/隐藏行为不变） <!-- comet-task:f5e06e35-7b99-4fe3-bf1c-2d2dd8bec3ac -->
- [x] 2.2 建立 `src/workspace/activity.mjs`，迁移会话活动监控与终端屏幕解析函数（验证：构建通过，会话状态指示仍正常更新） <!-- comet-task:2f1eab30-0a27-4efb-9f89-2a46626eee5d -->
- [x] 2.3 建立 `src/workspace/sessions.mjs`，迁移会话列表、分组折叠、新建/继续/恢复、关闭、中断与删除函数（验证：构建通过，会话列表与新建对话行为不变） <!-- comet-task:52b0d823-3ac1-4a57-a85e-6f381e3c699b -->

## 3. 终端模块

- [x] 3.1 建立 `src/workspace/terminal.mjs`，迁移 xterm 初始化、主题配色、连接与重连、尺寸适配、粘贴与光标抑制逻辑（验证：构建通过，终端连接、输入输出与字号缩放正常） <!-- comet-task:59297034-847d-4422-8183-01ae9f089c14 -->
- [x] 3.2 从 `sessions.mjs` 改为通过终端模块导出函数访问连接与适配，移除对 xterm 实例的直接读写（验证：构建通过，新建/切换/关闭会话行为不变） <!-- comet-task:4960d558-8aa0-4ced-8fd5-54b2f665a9aa -->

## 4. 文件树、输入区与提示词模块

- [x] 4.1 建立 `src/workspace/files.mjs`，迁移文件树刷新、展开、渲染、右键菜单、路径复制、打开与回收站操作（验证：构建通过，文件树全部操作行为不变） <!-- comet-task:c4e8cf2d-9101-4a9b-af82-aa665cc28018 -->
- [x] 4.2 建立 `src/workspace/composer.mjs`，迁移输入区显隐、发送、附件渲染、图片上传与粘贴/拖放（验证：构建通过，发送与图片附件行为不变） <!-- comet-task:b0abf602-b89f-4b7d-9f6e-e0ea0f68d9bf -->
- [x] 4.3 建立 `src/workspace/prompts.mjs`，迁移提示词库打开/关闭、列表渲染、整理、保存、插入与删除（验证：构建通过，提示词库全部操作行为不变） <!-- comet-task:d07bdf77-9b0a-4428-ab39-73e0a06e9a28 -->

## 5. 事件绑定与入口初始化

- [x] 5.1 将 `setupWorkspace` 中的绑定按领域拆为 `wireProjects`、`wireSessions`、`wireFiles`、`wireTerminal`、`wireComposer`、`wirePrompts`、`wirePreferences`，保持原有绑定顺序（验证：构建通过，所有按钮与快捷键行为不变） <!-- comet-task:0f4f4d41-924a-4d61-8b30-e8d9b16f379c -->
- [x] 5.2 建立 `src/workspace/init.mjs`，按原顺序调用各 `wire*` 并保留定时器与全局监听；`src/workstation.js` 只保留样式导入与 `init()` 调用（验证：`src/workstation.js` 降至 20 行以内，构建通过） <!-- comet-task:d49b9495-5756-49c0-89d0-3f83059f5864 -->
- [x] 5.3 删除 `src/workstation.js` 中已迁移的旧函数与不再使用的 import（验证：`grep` 确认无重复定义，构建通过） <!-- comet-task:a89e997e-8208-411f-930c-9a16af0758c2 -->

## 6. CSS 拆分

- [x] 6.1 按原段落顺序把 `src/workstation.css` 拆分为 `src/styles/` 下的主题、布局、项目、会话、文件、终端、输入区与提示词样式文件（验证：拆分后各文件选择器与原文件逐段一致） <!-- comet-task:1a5b5cba-9047-4cb6-b07e-cb05fed59a86 -->
- [x] 6.2 入口按原顺序导入样式并删除旧 `workstation.css`（验证：`npm run build` 通过，构建产物的 CSS 内容与原基线等价） <!-- comet-task:c3764d45-7e21-4cb7-9b09-06c7dcd138d8 -->

## 7. Playwright 冒烟与最终验证

- [x] 7.1 运行 `npm run build`，确认构建通过（验证：退出码 0） <!-- comet-task:d632d5a7-ee81-4f88-8a62-60ca888266c0 -->
- [x] 7.2 安装 `@playwright/test` 与 chromium，新增 `playwright.config.mjs` 和 `npm run test:e2e` 脚本（验证：`npx playwright --version` 可用，配置可加载） <!-- comet-task:5c46b611-9e3c-4c3c-a271-b69b42662c3f -->
- [x] 7.3 编写 `tests/e2e/workspace.spec.mjs`：管理页加载、切换到工作区、主题切换、终端字号、提示词库开关、文件树空状态（验证：六个场景均有断言） <!-- comet-task:e44f0517-636d-4fad-b434-019dcc0873bb -->
- [x] 7.4 运行 `npm run test:e2e`，确认冒烟通过（验证：退出码 0，无失败用例） <!-- comet-task:a60a1e14-a22a-47f7-8f00-18c5f998754e -->
- [x] 7.5 启动开发服务器 `npm run dev`，逐项手工验收：项目管理、会话列表与分组、终端连接与缩放、文件树操作、输入区与图片附件、提示词库、主题切换（验证：全部行为与文案与基线一致） <!-- comet-task:611497d4-f716-475e-8bb5-2649148e5d59 -->
- [x] 7.6 对照 1.1 基线，确认无 UI 行为变化并记录结果（验证：验收清单全部通过） <!-- comet-task:871fcb59-b9ee-4fd0-a818-0e68f21cfdf1 -->
