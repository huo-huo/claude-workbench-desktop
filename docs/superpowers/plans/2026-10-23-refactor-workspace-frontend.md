---
change: refactor-workspace-frontend
design-doc: docs/openspec/changes/refactor-workspace-frontend/design.md
base-ref: 22c8d52559df4af0ad42c6030d982465297c1535
---

<!-- comet-task-authority: docs/openspec/changes/refactor-workspace-frontend/tasks.md -->

# refactor-workspace-frontend 实施计划

## 执行配置

- build_mode: autonomous
- tdd_mode: direct
- review_mode: standard

## 总体策略

- 迁移以函数为最小单位：移动函数、改显式 import、共享状态改为 `app.字段`
- 依赖方向 `core -> state -> 领域模块 -> init`，终端模块持有 xterm 与 WebSocket
- 每完成一组迁移运行 `npm run build`
- 事件绑定顺序与 CSS 导入顺序保持与拆分前一致
- 最终由独立审查者做一次分段审查，Verify 完成最终集成审查

## 组 1：基线与基础层

### 1.1 记录基线
<!-- comet-task-ref:687ae1e0-9032-413c-b602-0a9c11c02cca -->
- 范围：worktree 运行 `npm run build` 记录结果
- 验收：退出码 0

### 1.2 core/dom.mjs
<!-- comet-task-ref:0831b5ae-8114-469d-9ffd-1c492169cf72 -->
- 范围：`$`、`escapeHtml`
- 依赖：1.1
- 验收：构建通过

### 1.3 core/api.mjs
<!-- comet-task-ref:255cb540-6795-4edd-96db-b45e8539bc0b -->
- 范围：`api`、`toast`
- 依赖：1.1
- 验收：构建通过

### 1.4 state.mjs
<!-- comet-task-ref:e841903f-cd70-40fc-8302-f834ef450284 -->
- 范围：顶部全部模块级可变状态平移到 `app` 对象，字段名与初值不变
- 依赖：1.2、1.3
- 验收：构建通过，旧变量声明已移除

### 1.5 preferences.mjs
<!-- comet-task-ref:3184769c-81a8-4926-9c83-6841fcfc4bd7 -->
- 范围：主题、字号、视图、项目折叠与导航折叠
- 依赖：1.4
- 验收：构建通过，主题与字号行为不变

## 组 2：项目与会话

### 2.1 projects.mjs
<!-- comet-task-ref:f5e06e35-7b99-4fe3-bf1c-2d2dd8bec3ac -->
- 范围：项目刷新、渲染、选择、添加、隐藏
- 依赖：1.5
- 验收：构建通过，项目操作不变

### 2.2 activity.mjs
<!-- comet-task-ref:2f1eab30-0a27-4efb-9f89-2a46626eee5d -->
- 范围：会话活动监控与终端屏幕解析
- 依赖：1.5
- 验收：构建通过，状态指示正常更新

### 2.3 sessions.mjs
<!-- comet-task-ref:52b0d823-3ac1-4a57-a85e-6f381e3c699b -->
- 范围：会话列表、分组折叠、新建/继续/恢复、关闭、中断、删除
- 依赖：2.1、2.2
- 验收：构建通过，会话行为不变

## 组 3：终端

### 3.1 terminal.mjs
<!-- comet-task-ref:59297034-847d-4422-8183-01ae9f089c14 -->
- 范围：xterm 初始化、主题配色、连接与重连、尺寸适配、粘贴、光标抑制
- 依赖：2.3
- 验收：构建通过，终端连接与缩放正常

### 3.2 解耦 xterm 实例访问
<!-- comet-task-ref:4960d558-8aa0-4ced-8fd5-54b2f665a9aa -->
- 范围：sessions 通过终端模块导出函数访问连接与适配
- 依赖：3.1
- 验收：构建通过，会话切换/关闭行为不变

## 组 4：文件树、输入区与提示词

### 4.1 files.mjs
<!-- comet-task-ref:c4e8cf2d-9101-4a9b-af82-aa665cc28018 -->
- 范围：文件树刷新、展开、渲染、右键菜单、路径复制、打开、回收站
- 依赖：3.1
- 验收：构建通过，文件树操作不变

### 4.2 composer.mjs
<!-- comet-task-ref:b0abf602-b89f-4b7d-9f6e-e0ea0f68d9bf -->
- 范围：输入区显隐、发送、附件渲染、图片上传、粘贴/拖放
- 依赖：3.1
- 验收：构建通过，发送与附件行为不变

### 4.3 prompts.mjs
<!-- comet-task-ref:d07bdf77-9b0a-4428-ab39-73e0a06e9a28 -->
- 范围：提示词库打开/关闭、列表渲染、整理、保存、插入、删除
- 依赖：4.2
- 验收：构建通过，提示词库操作不变

## 组 5：事件绑定与入口

### 5.1 拆分 wire*
<!-- comet-task-ref:0f4f4d41-924a-4d61-8b30-e8d9b16f379c -->
- 范围：`wireProjects`、`wireSessions`、`wireFiles`、`wireTerminal`、`wireComposer`、`wirePrompts`、`wirePreferences`
- 依赖：组 2-4
- 约束：保持原有绑定顺序
- 验收：构建通过，按钮与快捷键行为不变

### 5.2 init.mjs
<!-- comet-task-ref:d49b9495-5756-49c0-89d0-3f83059f5864 -->
- 范围：按原顺序调用各 `wire*`，保留定时器与全局监听
- 依赖：5.1
- 验收：`src/workstation.js` ≤ 20 行，构建通过

### 5.3 清理旧实现
<!-- comet-task-ref:a89e997e-8208-411f-930c-9a16af0758c2 -->
- 范围：删除已迁移函数与未使用 import
- 依赖：5.2
- 验收：构建通过，无重复定义

## 组 6：CSS 拆分

### 6.1 拆分样式文件
<!-- comet-task-ref:1a5b5cba-9047-4cb6-b07e-cb05fed59a86 -->
- 范围：按原段落顺序拆为 `src/styles/` 下 8 个文件
- 依赖：5.3
- 约束：选择器与原文件逐段一致
- 验收：拆分后内容逐段一致

### 6.2 入口按顺序导入
<!-- comet-task-ref:c3764d45-7e21-4cb7-9b09-06c7dcd138d8 -->
- 范围：入口按原顺序 import，删除旧 `workstation.css`
- 依赖：6.1
- 验收：构建通过，CSS 产物与基线等价

## 组 7：Playwright 与最终验证

### 7.1 构建
<!-- comet-task-ref:d632d5a7-ee81-4f88-8a62-60ca888266c0 -->
- 验收：`npm run build` 退出码 0

### 7.2 Playwright 配置
<!-- comet-task-ref:5c46b611-9e3c-4c3c-a271-b69b42662c3f -->
- 范围：安装 `@playwright/test` 与 chromium，新增 `playwright.config.mjs`、`npm run test:e2e`
- 依赖：7.1
- 约束：`webServer` 用随机端口启动 `node server.mjs`，只访问只读端点
- 验收：`npx playwright --version` 可用

### 7.3 冒烟用例
<!-- comet-task-ref:e44f0517-636d-4fad-b434-019dcc0873bb -->
- 范围：`tests/e2e/workspace.spec.mjs` 六个场景
- 依赖：7.2
- 验收：六个场景均有断言

### 7.4 运行冒烟
<!-- comet-task-ref:a60a1e14-a22a-47f7-8f00-18c5f998754e -->
- 验收：`npm run test:e2e` 退出码 0

### 7.5 手工验收
<!-- comet-task-ref:611497d4-f716-475e-8bb5-2649148e5d59 -->
- 范围：项目管理、会话、终端、文件树、输入区、提示词、主题
- 验收：行为与文案与基线一致

### 7.6 对照基线
<!-- comet-task-ref:871fcb59-b9ee-4fd0-a818-0e68f21cfdf1 -->
- 验收：无 UI 行为变化并记录结果
