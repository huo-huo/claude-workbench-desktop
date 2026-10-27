## Why

`index.html` 已增长到 107 KB，其中管理页的全部逻辑以内联传统脚本形式集中在一个 `<script>` 块中：43 个函数、9 个页面渲染器与筛选、开关、详情、翻译、诊断、测速等交互全部塞在 169 行压缩式长行里。Vite 无法处理这段内联脚本，模块边界不存在，任何页面改动都要在超长行中定位。需要抽离为 ES module 并按页面与公共能力拆分，`index.html` 只保留骨架与入口引用。

## What Changes

- 把 `index.html` 中的管理页内联脚本抽离为 `src/admin/` 下的 ES module
- 按页面拆分：运行概览、渠道与模型、Hooks、Skills、MCP、插件、版本管理、报错记录、AI 诊断
- 抽离公共能力：筛选与工具栏、开关与详情、说明卡生成、技能翻译、批量操作
- `index.html` 改为 `<script type="module" src="/src/admin/index.mjs">`，只保留页面骨架
- 保留 `window.workbenchToast` 与 `window.setWorkbenchPage` 两个对外全局函数

无 **BREAKING** 变更：所有页面结构、交互、文案、接口调用与行为保持不变。

## Capabilities

### New Capabilities

无。本次为纯重构，不改变规格级行为。

### Modified Capabilities

无。现有能力的行为与验收要求均不变。

## Impact

- 代码：新增 `src/admin/` 模块目录；`index.html` 移除内联脚本
- 构建：管理页脚本纳入 Vite 打包，`dist/index.html` 体积下降，产物结构变化但页面行为不变
- 后端：不涉及
- 依赖：不新增
- 测试：本项目暂无前端测试框架，本次不新增；以构建通过与手工验收为准
