## Why

对话工作站中间终端区（工具栏、终端输出、底部输入区、状态栏）是用户停留时间最长的区域，但当前存在三个问题：工具栏 8 个按钮挤在 64px 高的一行里且字号仅 9px，窄窗口时标题和项目路径被挤压；输入区与状态栏字号偏小（8–11px）、信息密度高，长时间阅读吃力；终端高频输出时逐块写入与多处 `fit` 触发会带来卡顿和布局抖动。需要在不改变核心终端行为的前提下，集中优化这一区域的排版、性能与操作体验。

## What Changes

- 工具栏：按「输入 / 会话控制 / 显示设置」分组，窄宽度时把低频按钮收进「更多」菜单，保证标题与项目路径不被挤掉；统一按钮字号与间距。
- 输入区与状态栏：提高提示文字、按钮与状态栏的最小可读字号与行高；精简状态栏中重复或低价值信息；输入框改为自动高度，去掉手动拖拽 resize 造成的布局跳动。
- 性能：终端输出按渲染帧批量写入；`fitTerminal` 的 ResizeObserver / 窗口 resize / focus / visibilitychange 触发合并并防抖；减少高频轮询对终端区的影响。
- 交互：明确 `Enter` 与 `Ctrl+Enter` 在输入区中的行为；增加「切换输入区 / 回到终端」的键盘快捷键；补齐工具栏按钮的焦点样式、`aria-expanded` 与禁用态提示。
- 非目标：不修复设置持久化问题（桌面端随机端口导致 `localStorage` 按源隔离，属独立 change，按完整流程处理）；不改服务端接口、Rust 启动层和 Claude CLI 协议；不新增命令、模型或会话能力。

## Capabilities

### New Capabilities

- `command-area`: 对话工作站中间终端区的布局与交互约定，覆盖工具栏窄宽度溢出、输入区焦点与快捷键、输入区与状态栏的排版可读性，以及高频输出下的渲染响应。

### Modified Capabilities

<!-- 无：状态栏数据来源、启用开关与模型切换等行为不变，本次只调整展示密度与排版，不修改既有 requirement。 -->

## Impact

- 前端模块：`src/workspace/terminal.mjs`、`src/workspace/composer.mjs`、`src/workspace/statusline.mjs`、`src/workspace/init.mjs`
- 样式与结构：`src/styles/terminal.css`、`src/styles/composer.css`、`src/workstation.css`、`index.html`
- 测试：`tests/` 下与终端写入、快捷键、状态栏渲染相关的用例
- 不涉及服务端 API、数据格式、依赖版本与 Rust 层
