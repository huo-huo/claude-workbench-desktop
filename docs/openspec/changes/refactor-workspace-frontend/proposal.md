## Why

`src/workstation.js` 已增长到 1526 行，包含 20 余个模块级可变状态和近百个函数，覆盖项目列表、会话、终端、文件树、输入区、提示词库、主题与偏好设置。任何改动都需要在整个文件的全局状态与 DOM 查询中定位；`setupWorkspace` 一个函数就承担了 130 行事件绑定。`src/workstation.css` 同样混合了主题覆盖、布局与各组件样式。需要在严格不改变 UI 行为与文案的前提下按领域拆分模块。

## What Changes

- 将 `src/workstation.js` 拆分为入口文件与领域模块，入口只负责样式导入与初始化
- 按领域拆分：项目、会话、终端、文件树、输入区、提示词库、主题与偏好
- 共享状态集中到独立模块，各领域模块通过显式导出访问
- 事件绑定从 `setupWorkspace` 按领域拆为 `wire*` 函数，由初始化模块统一调用
- 将 `src/workstation.css` 按原层叠顺序拆分为 `src/styles/` 下的独立样式文件

无 **BREAKING** 变更：所有 UI 交互、文案、DOM 结构与本地存储键保持不变。

## Capabilities

### New Capabilities

无。本次为纯重构，不改变规格级行为。

### Modified Capabilities

无。现有能力的行为与验收要求均不变。

## Impact

- 代码：`src/workstation.js` 保留为 Vite 入口；新增 `src/workspace/` 模块目录与 `src/styles/` 样式目录
- 构建：Vite 入口路径不变，`npm run build` 产物结构不变
- UI：页面结构、交互、文案与本地存储键不变
- 后端：不涉及
- 测试：本项目暂无前端测试框架，本次不新增；以构建通过与手工行为对照验证
