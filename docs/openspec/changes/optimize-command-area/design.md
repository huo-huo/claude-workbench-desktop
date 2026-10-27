## Context

当前终端区由 `index.html` 的 `.terminal-column` 结构、`src/styles/terminal.css` 与 `composer.css`，以及 `terminal.mjs`、`composer.mjs`、`statusline.mjs`、`init.mjs` 共同实现。工具栏是 8 个直接平铺的按钮（字号 9px），输入区提示 8px、按钮 9px、文本域 11px，状态栏默认 8px 且两行信息密集；`terminal.mjs` 对每个 WebSocket `data` 消息直接调用 `terminal.write`，`fitTerminal` 同时被 `ResizeObserver`、`window.resize`、`window.focus` 和 `visibilitychange` 触发且无合并。行为要求见 `specs/command-area/spec.md`，动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 用尽量少的结构改动实现工具栏窄宽度收敛、输入区快捷键、可读排版与高频输出合并渲染。
- 保持现有终端、会话、状态栏数据和事件绑定逻辑不变，改动集中在展示层与调度层。

**Non-Goals:**

- 不处理设置持久化（桌面端随机端口导致 localStorage 按源隔离，另开完整流程 change）。
- 不引入前端框架、组件库或新依赖；不修改服务端、Claude CLI 协议与 Rust 启动层。
- 不改变状态栏的数据来源、启用开关与模型切换行为。

## Decisions

### 1. 工具栏「更多」菜单：按优先级移动已有按钮，而非复制

新增一个「更多」按钮和菜单容器，用一个纯函数按固定优先级把低频按钮从工具栏移动到菜单（`appendChild`），恢复宽度时再移回原位。选择移动节点而不复制按钮，是因为现有事件监听器直接绑定在按钮上，移动 DOM 会保留监听器与状态（`disabled`、`aria-expanded`），避免维护两份逻辑。

- 备选：纯 CSS 隐藏尾部按钮——无法保证被隐藏操作仍可使用，否决。
- 备选：为菜单复制一份按钮——需要同步状态与事件，否决。
- 优先级：`重绘屏幕`、`中断`、`收起视图` 保持在工具栏；`文件栏`、`状态栏配置`、字号组、`粘贴/语音输入` 按宽度从低到高收敛。窄宽度下标题与路径优先保留。

### 2. 快捷键放在输入区与文档级监听，避免抢终端按键

`Ctrl+Enter` 与 `Esc` 在输入区的 `keydown` 中处理；`Ctrl+`` ` 在文档级 `keydown` 中处理，但仅在焦点不在终端、或终端未捕获该组合时生效。这样不会干扰 xterm 的自定义按键处理（`attachCustomKeyEventHandler`）。快捷键判定抽成纯函数（如 `matchComposerShortcut(event)`）便于单元测试。

### 3. 输入区自动高度：JS 计算 + CSS 上限，移除手动 resize

移除 `textarea` 的 `resize: vertical`，在 `input` 事件中按 `scrollHeight` 调整高度，达到 `max-height` 后内部滚动。选择 JS 而非 CSS `field-sizing: content`，是因为 WebView2 版本不稳定，需要确定性行为。

### 4. 可读排版：提高字号下限并精简默认状态栏

输入区提示、按钮与状态栏默认字号统一到 10px；状态栏字号配置范围调整为 10–14px，读取旧配置时按 10px 夹紧。状态栏默认隐藏与第一行重复的同类计数，保留配置面板可恢复。样式集中修改 `terminal.css`、`composer.css`，避免散落在组件内联样式。

### 5. 高频输出批量化与 fit 防抖

`terminal.mjs` 引入写队列：`data` 消息进入队列，在 `requestAnimationFrame` 中合并为一次 `terminal.write`；`ready` 消息保留立即写入并使用回调，避免影响重绘和 Ctrl+L 逻辑。`fitTerminal` 包一层 80–120ms 防抖，`ResizeObserver`、`window.resize`、`focus`、`visibilitychange` 统一走防抖版本，防抖结束后补发一次 PTY 尺寸同步。批处理与防抖逻辑抽成独立纯函数/小模块，便于在没有 DOM 的环境下测试。

## Risks / Trade-offs

- [移动 DOM 导致按钮顺序混乱] → 用固定优先级数组计算移入/移出顺序，并在恢复时按原索引插回。
- [批量写入影响 `ready` 的重绘回调与 Ctrl+L] → 只批处理 `data`；`ready` 保持同步写入，测试覆盖顺序与完整性。
- [防抖延迟导致终端尺寸短时不一致] → 防抖结束立即补一次 `fit` 与 resize 同步；保留现有 `lastTerminalPtySize` 去重。
- [字号提升挤压状态栏空间] → 默认隐藏重复项，必要时允许状态栏换行而非裁切。
- [快捷键与终端按键冲突] → 仅在输入区焦点内处理 `Esc`；`Ctrl+`` ` 在输入区或工具栏焦点时处理，终端焦点时交给 xterm。
- [窄窗口阈值判断在 WebView2 与浏览器不一致] → 用实际测量（按钮总宽与容器宽）而非固定媒体查询阈值。

## Migration Plan

无数据迁移。改动只涉及前端展示与调度，回滚方式为整体回退本分支提交。

## Open Questions

无。
