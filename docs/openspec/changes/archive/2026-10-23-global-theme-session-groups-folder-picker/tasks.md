## 1. 全局主题

- [x] 1.1 将主题切换按钮从终端工具栏移到顶部栏 `.top-actions`，管理页与对话工作站共用同一按钮；验证：两个视图下顶部栏都能看到按钮，终端工具栏不再有重复按钮。 <!-- comet-task:8d75b70f-8ee7-4c0a-bba3-9065e615205a -->
- [x] 1.2 在 `document.body` 上应用主题 class，并用 `body.theme-dark` 覆盖应用级 CSS 变量与关键硬编码颜色；验证：切换深色后逐页检查管理页各子页面、工作区侧栏、终端栏与文件栏，无残留浅色面板。 <!-- comet-task:55e08f54-3ffe-4630-b2bd-3505fd037766 -->
- [x] 1.3 为 xterm 准备深色与浅色两套 theme，主题切换时更新实例并在下一帧 `fit()`；验证：切换主题后终端背景与文字配色跟随变化，尺寸正常。 <!-- comet-task:a1ffb674-0a6c-438d-b116-06a0a3ae2781 -->
- [x] 1.4 沿用 `claude-workbench-workspace-theme` 持久化主题，启动时恢复；验证：选择深色后重新加载页面与应用，主题保持深色；清除该 key 后默认浅色。 <!-- comet-task:8d84ae17-e430-49f6-acfb-3a45fc86b69d -->
- [x] 1.5 维护主题按钮的 `aria-pressed` 与可访问名称；验证：按钮在深色/浅色下状态属性与文案一致。 <!-- comet-task:ac0f0eaa-2464-4e9a-b92b-021c632b634b -->

## 2. 会话按项目分组

- [x] 2.1 增加 projectPath 规范化函数（统一斜杠、去尾斜杠、转小写），按分组 key 聚合会话并渲染分组标题（项目名 + 路径），组内按 `lastUsedAt` 倒序；验证：构造两个项目的会话，分组正确且组内顺序符合最近使用时间。 <!-- comet-task:5ad6f49d-c136-45b5-aa71-ae44024ffbf3 -->
- [x] 2.2 分组标题支持点击折叠/展开，折叠状态写入 `claude-workbench-collapsed-projects`；验证：折叠后刷新页面与重开应用仍保持，新项目默认展开。 <!-- comet-task:25c4b01c-1606-40cd-af86-9ce60e3af1e9 -->
- [x] 2.3 保持会话行既有 `data-session-id`、`data-remove-session` 约定，使打开会话、移除会话和状态刷新继续工作；验证：分组内打开、移除会话正常，运行状态标记可更新，移除后空分组消失。 <!-- comet-task:686b8513-dcc1-4477-8bd1-76dbea6b05d7 -->

## 3. 系统“打开”式文件夹选择器

- [x] 3.1 在 `selectWorkspaceFolder()` 中用 PowerShell + COM `IFileOpenDialog`（`FOS_PICKFOLDERS`，标题“打开”）替换 `FolderBrowserDialog`，保留 Base64 UTF-8 输出与 `safeWorkspaceRoot()` 校验；验证：点击添加项目文件夹弹出资源管理器风格的选择窗口，确认按钮为“打开”。 <!-- comet-task:c8424226-73ec-456d-8a42-ca0e2c68147c -->
- [x] 3.2 现代对话框启动失败时回退旧式 `FolderBrowserDialog`，两者都失败时返回明确错误；验证：正常环境走现代对话框，模拟失败路径时回退或提示错误且应用不崩溃。 <!-- comet-task:d2056bec-bcbd-4313-ae03-3a3400dbb950 -->
- [x] 3.3 验证 `/api/workspace/select-folder` 契约不变：选择目录后项目加入列表并激活，取消后状态不变；验证：分别执行选择与取消，检查项目列表、当前项目与文件树刷新行为。 <!-- comet-task:0c198392-b0da-4fdf-aa91-b2bcebf6a3c7 -->

## 4. 集成验证

- [x] 4.1 运行 `npm run build`，验证构建成功且无报错。 <!-- comet-task:4bc5cb8e-c65d-4f1c-87ad-25d9abe3f047 -->
- [x] 4.2 启动 `npm run dev`（或 `npm run desktop:dev`），按三个能力逐项手工验收：全局主题与持久化、会话分组与折叠持久化、系统打开式文件夹选择器。 <!-- comet-task:9d7c1b98-a38a-44fd-b8a1-26156164de16 -->
