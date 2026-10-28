## 1. 文件栏显示隐藏条目

- [x] 1.1 修改 `server/workspace/files.mjs` 的 `workspaceTree()`：移除 `entry.name.startsWith('.') && entry.name !== '.claude'` 过滤，保留 `~$` 临时文件跳过与 `WORKSPACE_SKIP` 重型目录跳过。验证：`GET /api/workspace/files` 返回的根节点包含 `.github`、`.gitignore` 等条目，且不含 `node_modules`、`.git`。 <!-- comet-task:fdf2cf78-9bf1-4add-a458-0adfd78f5b43 -->
- [x] 1.2 新增 `tests/workspace-files.test.mjs`：在临时目录构造 `.github/`、`.vscode/`、`.gitignore`、`.git/`、`node_modules/`，断言隐藏文件与隐藏文件夹可见、重型目录被排除、文件夹排在文件之前。验证：`node --test tests/workspace-files.test.mjs` 通过。 <!-- comet-task:f15a3e83-0bee-45a6-b3c7-263b8978f404 -->

## 2. 查看器面板与样式

- [x] 2.1 在 `index.html` 的 `.terminal-column` 内、`#terminalHost` 之后新增 `#fileViewer` 面板骨架（标题栏含文件名、相对路径与关闭按钮，正文为 `pre` 容器）。验证：`npm run build` 成功，页面源码中面板默认带 `hidden`。 <!-- comet-task:b0a43034-7ef7-4f81-bda2-5b0c6c200b0f -->
- [x] 2.2 在 `src/styles/files.css` 追加 `.file-viewer` 相关样式：以 `.terminal-column` 为定位父级的绝对覆盖层、不透明背景、等宽正文、长行横向滚动，并补充深色主题下的变量适配。验证：浏览器中浅色/深色主题下正文可读、长行可横向滚动、覆盖层不越出终端区域。 <!-- comet-task:17f8becc-9eb0-49af-a926-8fef1a115622 -->

## 3. 查看器逻辑

- [x] 3.1 新建 `src/workspace/viewer.mjs`：实现 `openViewer(path)`（请求 `GET /api/workspace/file` 并渲染）、`closeViewer()`、`renderViewer()`，错误经 `toast` 展示后端原文。验证：`npm run build` 成功。 <!-- comet-task:6d5a9d09-3a74-4360-82a6-1372591042c7 -->
- [x] 3.2 在 `src/workspace/state.mjs` 增加 `viewer: { path, name, size, modifiedAt, content, loading }` 状态字段。验证：打开与关闭查看器后该状态被正确写入与清空。 <!-- comet-task:1f13bb4e-5af3-4c6a-bb47-f9136e9cfde7 -->
- [x] 3.3 在 `src/workspace/files.mjs` 增加文本类型判定 `isPreviewableText(item)` 与 `activateTreeFile(path)`：文本类型进入查看器，非文本类型继续调用 `openProjectFile()`；`wireTree()` 的双击与 Enter 改为调用该函数。验证：双击 `README.md` 打开查看器；双击 `.docx`/`.pdf` 仍由系统应用打开。 <!-- comet-task:43c5687e-3e4a-4d48-b944-59f519ca0543 -->
- [x] 3.4 在文件右键菜单新增「用系统默认应用打开」（`#fileTreeOpenExternal`），接线到 `openProjectFile()`，并复用现有菜单定位、关闭与目标路径逻辑。验证：右键菜单出现该项，点击后由系统应用打开文件且不打开查看器。 <!-- comet-task:78107a19-3dcb-4a4f-bbd2-dfa2ca3195da -->
- [x] 3.5 `closeViewer()` 关闭面板后恢复终端视图并聚焦终端，隐藏面板不改变 `#terminalHost` 挂载与终端尺寸。验证：打开再关闭查看器后终端内容与连接状态不变，可直接继续输入。 <!-- comet-task:97a69649-eb82-4e73-9469-a10d3c8d0a52 -->

## 4. 集成验证

- [x] 4.1 运行 `npm test`，确认新增与既有单元测试全部通过。 <!-- comet-task:fdc30d21-fa17-490d-a831-3d2d7d61a481 -->
- [x] 4.2 运行 `npm run build`，确认前端构建成功。 <!-- comet-task:e4ad4a08-a0a0-435c-a6af-53c40ca2e56b -->
- [x] 4.3 在 worktree 启动服务，浏览器验证：文件栏显示 `.github`/`.gitignore` 等隐藏条目且不含 `.git`/`node_modules`；双击文本文件打开查看器；关闭后回到终端；右键「用系统默认应用打开」可用。 <!-- comet-task:20d849b1-03bd-4af2-ad83-445774e3caaa -->
