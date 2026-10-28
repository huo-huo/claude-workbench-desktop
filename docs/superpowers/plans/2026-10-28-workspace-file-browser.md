---
archived-with: 2026-10-28-workspace-file-browser
status: final
---
# 文件栏隐藏条目与内置文本查看器 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 主会话负责协调与审查，实现代理按任务包逐项交付。

<!-- comet-task-authority: docs/openspec/changes/workspace-file-browser/tasks.md -->

**Goal:** 文件栏显示以 `.` 开头的隐藏文件与文件夹，并让用户在工作台内只读查看文本文件内容。

**Architecture:** 后端只放开一处目录过滤；前端新增覆盖终端区域的独立查看器面板，复用既有 `GET /api/workspace/file` 接口，按扩展名判型分流到内置查看或系统打开。

**Tech Stack:** Node ESM 后端（原生 `node:fs`）、原生 ES Module 前端、Vite 构建、`node --test` 单元测试、Playwright 端到端测试。

**Spec:** `docs/openspec/changes/workspace-file-browser/design.md`（需求契约见 `docs/openspec/changes/workspace-file-browser/specs/workspace-file-browser/spec.md`）

## Global Constraints

- 工作区：`E:\work\workspace\huohuo\claude-workbench-desktop\.worktrees\workspace-file-browser`（分支 `comet/workspace-file-browser`）。
- 不新增后端路由、不新增第三方依赖、不改变现有接口契约。
- 文件树继续跳过 `WORKSPACE_SKIP` 中的重型目录（`.git`、`node_modules`、`.next`、`.turbo`、`dist`、`build`、`target`、`.venv`、`vendor`）。
- 查看器只读，不提供编辑/保存，不修改磁盘文件。
- 新增代码注释使用中文；前端文本一律 `textContent` 渲染，不拼接 HTML。
- 验收命令：`npm test`、`npm run build`。

---

### Task 1: 后端文件树放开隐藏条目

<!-- comet-task-ref:fdf2cf78-9bf1-4add-a458-0adfd78f5b43 -->

**Files:**
- Modify: `server/workspace/files.mjs:31-34`
- Test: `tests/workspace-files.test.mjs`（Task 2 创建后一起运行）

**Interfaces:**
- Produces: `workspaceTree(root, requested, depth, budget)` 返回的节点可包含 `.` 开头的 `name`；`entry.isFile()` 的 `~$` 临时文件与 `WORKSPACE_SKIP` 命中项仍被跳过。

**Step 1: 修改过滤逻辑**

把 `server/workspace/files.mjs` 的循环开头改成（删掉隐藏项判断，保留 `~$` 与重型目录跳过）：

```js
  for (const entry of entries) {
    // 只跳过 Office 临时文件；隐藏文件与隐藏文件夹照常展示
    if (entry.isFile() && entry.name.startsWith('~$')) continue;
    if (WORKSPACE_SKIP.has(entry.name.toLowerCase())) continue;
    const fullPath = path.join(real, entry.name);
```

**Step 2: 手工验证返回结果**

Run:

```powershell
node -e "import('./server/workspace/files.mjs').then(m=>{const t=m.workspaceTree(process.cwd());console.log(t.children.filter(c=>c.name.startsWith('.' )).map(c=>c.name).join(','))})"
```

Expected: 输出包含 `.comet`、`.gitignore` 等名称，且不包含 `.git`、`node_modules`。

**Step 3: 提交**

```powershell
git add server/workspace/files.mjs
git commit -m "feat: 文件栏显示隐藏文件与隐藏文件夹"
```

---

### Task 2: 文件树过滤单元测试

<!-- comet-task-ref:f15a3e83-0bee-45a6-b3c7-263b8978f404 -->

**Files:**
- Create: `tests/workspace-files.test.mjs`

**Interfaces:**
- Consumes: `workspaceTree(root)`（Task 1）。
- Produces: `tests/workspace-files.test.mjs` 中 `createFixture()` 供后续任务复用。

**Step 1: 写失败的测试**

新建 `tests/workspace-files.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceTree } from '../server/workspace/files.mjs';

/** 构造最小项目目录：两个隐藏文件夹、一个隐藏文件、两个重型目录 */
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-tree-'));
  fs.mkdirSync(path.join(root, '.github'));
  fs.mkdirSync(path.join(root, '.vscode'));
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# demo\n');
  fs.writeFileSync(path.join(root, '~$draft.docx'), 'tmp');
  return root;
}

test('文件树展示隐藏文件与隐藏文件夹', () => {
  const root = createFixture();
  const names = workspaceTree(root).children.map(item => item.name);
  assert.ok(names.includes('.github'));
  assert.ok(names.includes('.vscode'));
  assert.ok(names.includes('.gitignore'));
});

test('文件树仍跳过重型目录与 Office 临时文件', () => {
  const root = createFixture();
  const names = workspaceTree(root).children.map(item => item.name);
  assert.ok(!names.includes('.git'));
  assert.ok(!names.includes('node_modules'));
  assert.ok(!names.includes('~$draft.docx'));
});

test('文件夹排在文件之前', () => {
  const root = createFixture();
  const types = workspaceTree(root).children.map(item => item.type);
  const lastFolder = types.lastIndexOf('folder');
  const firstFile = types.indexOf('file');
  assert.ok(lastFolder < firstFile);
});
```

**Step 2: 运行测试确认失败（RED）**

Run: `node --test tests/workspace-files.test.mjs`
Expected: 若 Task 1 未允许隐藏项，第一条测试 FAIL（`names` 中缺少 `.github`）；其余两条通过。

**Step 3: 运行测试确认通过（GREEN）**

Run: `node --test tests/workspace-files.test.mjs`
Expected: 3 个测试全部 PASS。

**Step 4: 提交**

```powershell
git add tests/workspace-files.test.mjs
git commit -m "test: 覆盖文件树隐藏条目与重型目录过滤"
```

---

### Task 3: 查看器面板骨架

<!-- comet-task-ref:b0a43034-7ef7-4f81-bda2-5b0c6c200b0f -->

**Files:**
- Modify: `index.html:76`（在 `#terminalHost` 之后插入）、`index.html:129`（右键菜单）

**Interfaces:**
- Produces: DOM 节点 `#fileViewer`、`#fileViewerName`、`#fileViewerPath`、`#fileViewerSize`、`#fileViewerContent`、`#closeFileViewer`、`#fileTreeOpenExternal`。

**Step 1: 在终端区域插入面板**

在 `index.html` 的 `<div class="terminal-host" id="terminalHost">…</div>` 之后、`<section class="terminal-composer" …>` 之前插入：

```html
          <section class="file-viewer" id="fileViewer" aria-label="文件查看器" hidden><header class="file-viewer-head"><div class="file-viewer-title"><strong id="fileViewerName">文件</strong><span id="fileViewerPath"></span></div><div class="file-viewer-actions"><span class="file-viewer-size" id="fileViewerSize"></span><button class="btn flat" id="closeFileViewer" type="button" title="关闭查看器，回到终端">关闭</button></div></header><pre class="file-viewer-body" id="fileViewerContent"></pre></section>
```

**Step 2: 右键菜单增加系统打开项**

把 `index.html` 中 `#fileTreeContextMenu` 的内容改成（在「复制路径」之后、分隔线之前插入）：

```html
  <div class="workspace-context-menu" id="fileTreeContextMenu" role="menu" hidden><button id="fileTreeRevealPath" role="menuitem">在文件夹中显示</button><button id="fileTreeAddToConversation" role="menuitem">添加到对话</button><button id="fileTreeCopyPath" role="menuitem">复制路径</button><button id="fileTreeOpenExternal" role="menuitem">用系统默认应用打开</button><div class="menu-separator" role="separator"></div><button id="fileTreeRecycle" class="menu-danger" role="menuitem">移到回收站</button></div>
```

**Step 3: 验证构建**

Run: `npm run build`
Expected: 构建成功，无 HTML 相关报错。

**Step 4: 提交**

```powershell
git add index.html
git commit -m "feat: 增加文件查看器面板骨架与系统打开菜单项"
```

---

### Task 4: 查看器样式

<!-- comet-task-ref:17f8becc-9eb0-49af-a926-8fef1a115622 -->

**Files:**
- Modify: `src/styles/files.css`（追加到文件末尾）

**Interfaces:**
- Consumes: Task 3 的 `.file-viewer`、`.file-viewer-head`、`.file-viewer-title`、`.file-viewer-actions`、`.file-viewer-size`、`.file-viewer-body` 类名。

**Step 1: 追加样式**

在 `src/styles/files.css` 末尾追加：

```css
/* 文件查看器：与终端同行重叠显示，不改变终端网格行高 */
.terminal-column .file-viewer{grid-row:2;grid-column:1;z-index:3;display:flex;flex-direction:column;min-height:0;background:var(--terminal-bg);color:var(--terminal-chrome-fg);border-top:1px solid var(--terminal-chrome-line)}
.file-viewer-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-bottom:1px solid var(--terminal-chrome-line);background:var(--terminal-chrome-bg)}
.file-viewer-title{display:flex;flex-direction:column;min-width:0;gap:2px}
.file-viewer-title strong{font:600 13px/1.3 var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file-viewer-title span{font:9px var(--mono);color:var(--terminal-chrome-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file-viewer-actions{display:flex;align-items:center;gap:8px;flex:none}
.file-viewer-size{font:9px var(--mono);color:var(--terminal-chrome-muted)}
.file-viewer-body{flex:1;min-height:0;margin:0;padding:10px 12px;overflow:auto;white-space:pre;font:12px/1.6 var(--mono);tab-size:2}
```

**Step 2: 验证构建**

Run: `npm run build`
Expected: 构建成功，产物 CSS 中出现 `.file-viewer-body`。

**Step 3: 提交**

```powershell
git add src/styles/files.css
git commit -m "style: 增加文件查看器面板样式"
```

---

### Task 5: 查看器状态字段

<!-- comet-task-ref:1f13bb4e-5af3-4c6a-bb47-f9136e9cfde7 -->

**Files:**
- Modify: `src/workspace/state.mjs:37-38`

**Interfaces:**
- Produces: `app.viewer = { path, name, size, modifiedAt, content, loading }`，初始为空串/0/false。

**Step 1: 增加状态字段**

在 `src/workspace/state.mjs` 的 `lastFileOpen` 之后加入：

```js
  // 内置查看器：path 非空表示面板打开
  viewer: { path: '', name: '', size: 0, modifiedAt: '', content: '', loading: false },
```

**Step 2: 验证构建**

Run: `npm run build`
Expected: 构建成功。

**Step 3: 提交**

```powershell
git add src/workspace/state.mjs
git commit -m "feat: 增加文件查看器状态字段"
```

---

### Task 6: 查看器模块

<!-- comet-task-ref:6d5a9d09-3a74-4360-82a6-1372591042c7 -->

**Files:**
- Create: `src/workspace/viewer.mjs`

**Interfaces:**
- Consumes: `app.viewer`（Task 5）、`GET /api/workspace/file?projectPath=&path=`（返回 `{ name, path, content, size, modifiedAt }`）、`src/workspace/core/api.mjs` 的 `api`/`toast`、`src/workspace/core/dom.mjs` 的 `$`。
- Produces: `isPreviewableText(extension)`、`openViewer(path)`、`closeViewer()`、`renderViewer()`。

**Step 1: 写模块**

新建 `src/workspace/viewer.mjs`：

```js
import { $ } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';

// 可在工作台内预览的文本/代码扩展名；无扩展名交给后端二进制检测兜底
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.log', '.rst',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf', '.env',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.css', '.scss', '.less', '.html', '.htm',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.kt',
  '.sh', '.bash', '.ps1', '.bat', '.sql', '.gitignore', '.dockerignore', '.editorconfig',
]);

/** 判断扩展名是否属于可预览的文本类型 */
export function isPreviewableText(extension) {
  const ext = String(extension || '').toLowerCase();
  if (!ext) return true;
  return TEXT_EXTENSIONS.has(ext);
}

/** 文件大小展示：KB/MB 保留一位小数 */
function formatSize(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 读取并展示文件内容；失败时保持面板关闭并提示后端错误原文 */
export async function openViewer(filePath) {
  if (!app.projectPath) return;
  app.viewer = { path: filePath, name: '', size: 0, modifiedAt: '', content: '', loading: true };
  renderViewer();
  const url = `/api/workspace/file?projectPath=${encodeURIComponent(app.projectPath)}&path=${encodeURIComponent(filePath)}`;
  try {
    const file = await api(url);
    // 期间用户可能已切换到别的文件，旧结果直接丢弃
    if (app.viewer.path !== filePath) return;
    app.viewer = { path: filePath, name: file.name || '', size: file.size || 0, modifiedAt: file.modifiedAt || '', content: file.content || '', loading: false };
    renderViewer();
  } catch (error) {
    app.viewer = { path: '', name: '', size: 0, modifiedAt: '', content: '', loading: false };
    renderViewer();
    toast(error.message);
  }
}

/** 关闭查看器并把焦点还给终端 */
export function closeViewer() {
  const wasOpen = Boolean(app.viewer.path);
  app.viewer = { path: '', name: '', size: 0, modifiedAt: '', content: '', loading: false };
  renderViewer();
  if (wasOpen) app.terminal?.focus();
}

/** 按当前状态渲染面板；path 为空时隐藏面板 */
export function renderViewer() {
  const panel = $('#fileViewer');
  if (!panel) return;
  const active = Boolean(app.viewer.path);
  panel.hidden = !active;
  if (!active) return;
  $('#fileViewerName').textContent = app.viewer.name || '正在读取文件…';
  $('#fileViewerPath').textContent = app.viewer.path;
  $('#fileViewerSize').textContent = app.viewer.loading ? '' : formatSize(app.viewer.size);
  $('#fileViewerContent').textContent = app.viewer.loading ? '正在读取文件…' : app.viewer.content;
}
```

**Step 2: 验证构建**

Run: `npm run build`
Expected: 构建成功（模块已导入前可能未被引用，允许 Tree-shaking 剔除）。

**Step 3: 提交**

```powershell
git add src/workspace/viewer.mjs
git commit -m "feat: 新增内置文件查看器模块"
```

---

### Task 7: 双击分流到内置查看

<!-- comet-task-ref:43c5687e-3e4a-4d48-b944-59f519ca0543 -->

**Files:**
- Modify: `src/workspace/files.mjs:1-5`（import）、`files.mjs:234-272`（wireTree）、`files.mjs:293-299`（新增 activateTreeFile）

**Interfaces:**
- Consumes: `isPreviewableText`、`openViewer`（Task 6）、`openProjectFile`（既有）。
- Produces: `activateTreeFile(filePath)`，双击与 Enter 的统一入口。

**Step 1: 增加导入**

在 `src/workspace/files.mjs` 的导入区加入：

```js
import { isPreviewableText, openViewer } from './viewer.mjs';
```

**Step 2: 新增分流函数**

在 `openProjectFile` 之前加入：

```js
/** 取路径中的小写扩展名，无扩展名时返回空串 */
export function fileExtension(filePath) {
  const name = String(filePath || '').split(/[\\/]/).pop() || '';
  const index = name.lastIndexOf('.');
  // 只有点号出现在开头之后才算扩展名，避免把 .gitignore 误判为隐藏前缀
  return index > 0 ? name.slice(index).toLowerCase() : '';
}

/** 双击/回车统一入口：文本走内置查看器，其余保持系统应用打开 */
export async function activateTreeFile(filePath) {
  if (isPreviewableText(fileExtension(filePath))) {
    await openViewer(filePath);
    return;
  }
  await openProjectFile(filePath);
}
```

**Step 3: 改双击与回车**

`wireTree()` 的 `ondblclick` 中把 `openProjectFile(itemPath)` 改成 `activateTreeFile(itemPath)`；`onkeydown` 中把 `openProjectFile(button.dataset.treePath)` 改成 `activateTreeFile(button.dataset.treePath)`。

**Step 4: 验证构建**

Run: `npm run build`
Expected: 构建成功，浏览器中双击 `README.md` 打开查看器。

**Step 5: 提交**

```powershell
git add src/workspace/files.mjs
git commit -m "feat: 双击文本文件改为内置查看"
```

---

### Task 8: 右键系统打开入口

<!-- comet-task-ref:78107a19-3dcb-4a4f-bbd2-dfa2ca3195da -->

**Files:**
- Modify: `src/workspace/files.mjs:72-100`（`runFileTreeContextAction`）、`src/workspace/init.mjs:100-103`（事件绑定）

**Interfaces:**
- Consumes: `openProjectFile`、`app.fileTreeContextTarget`。
- Produces: 菜单动作 `'external'`，绑定 `#fileTreeOpenExternal`。

**Step 1: 增加菜单动作**

在 `runFileTreeContextAction` 的 `action === 'add'` 分支之后加入：

```js
  if (action === 'external') {
    await openProjectFile(target.path).catch(error => toast(error.message));
    return;
  }
```

**Step 2: 绑定按钮**

在 `src/workspace/init.mjs` 的 `wireFiles()` 中，`#fileTreeCopyPath` 绑定之后加入：

```js
  $('#fileTreeOpenExternal').addEventListener('click', () => runFileTreeContextAction('external'));
```

**Step 3: 验证构建并手工确认**

Run: `npm run build`
Expected: 构建成功；右键菜单出现「用系统默认应用打开」，点击后由系统应用打开文件且不显示查看器。

**Step 4: 提交**

```powershell
git add src/workspace/files.mjs src/workspace/init.mjs
git commit -m "feat: 文件右键菜单保留系统默认应用打开"
```

---

### Task 9: 查看器关闭与终端恢复

<!-- comet-task-ref:97a69649-eb82-4e73-9469-a10d3c8d0a52 -->

**Files:**
- Modify: `src/workspace/init.mjs:1-25`（import）、`init.mjs:86-112`（wireFiles）

**Interfaces:**
- Consumes: `closeViewer`（Task 6）。

**Step 1: 增加导入**

在 `src/workspace/init.mjs` 的 `files.mjs` 导入行之后加入：

```js
import { closeViewer } from './viewer.mjs';
```

**Step 2: 绑定关闭按钮与 Esc**

在 `wireFiles()` 的 `wireFiles` 末尾（Escape 监听之前）加入：

```js
  $('#closeFileViewer').addEventListener('click', closeViewer);
```

并在已有 Escape 监听中追加：

```js
      closeViewer();
```

**Step 3: 验证构建**

Run: `npm run build`
Expected: 构建成功。

**Step 4: 手工验证**

Run 服务后打开任一文本文件 → 点击「关闭」→ 终端内容仍在、可直接输入；再打开文件按 Esc 同样关闭。

**Step 5: 提交**

```powershell
git add src/workspace/init.mjs
git commit -m "feat: 查看器关闭后恢复终端视图"
```

---

### Task 10: 单元测试总检

<!-- comet-task-ref:fdc30d21-fa17-490d-a831-3d2d7d61a481 -->

**Files:**
- Test: `tests/**/*.test.mjs`

**Step 1: 运行全部单元测试**

Run: `npm test`
Expected: 全部 PASS，包含 `tests/workspace-files.test.mjs` 的 3 个用例。

**Step 2: 记录结果**

如果出现与本次改动无关的既有失败，记录失败用例名与原因，不改动无关代码。

**Step 3: 提交（如有修复）**

仅在本次改动引入失败时修复后提交：

```powershell
git add tests server src
git commit -m "fix: 修正单元测试失败"
```

---

### Task 11: 前端构建总检

<!-- comet-task-ref:e4ad4a08-a0a0-435c-a6af-53c40ca2e56b -->

**Files:**
- Build: `vite build`

**Step 1: 运行构建**

Run: `npm run build`
Expected: 构建成功，无报错。

**Step 2: 提交**

本任务只产出构建证据，无文件变更；若产生构建残留文件，不提交。

---

### Task 12: 浏览器端到端验收

<!-- comet-task-ref:20d849b1-03bd-4af2-ad83-445774e3caaa -->

**Files:**
- Verify: 运行中的工作台页面

**Step 1: 启动服务**

在当前 worktree 启动服务，并显式覆盖端口与前端根目录，避免继承外部会话环境变量：

```powershell
$env:CLAUDE_WORKBENCH_PORT='58321'; $env:CLAUDE_WORKBENCH_WEB_ROOT='E:\work\workspace\huohuo\claude-workbench-desktop\.worktrees\workspace-file-browser'; node server.mjs
```

**Step 2: 验收隐藏条目**

打开 `http://127.0.0.1:58321`，选择本项目文件夹。Expected: 文件栏出现 `.comet`、`.gitignore`、`docs` 等条目；不出现 `.git`、`node_modules`。

**Step 3: 验收查看器**

双击 `README.md`。Expected: 终端区域切换为查看器，显示文件名、相对路径、大小与正文；长行可横向滚动。

**Step 4: 验收关闭与系统打开**

点击「关闭」。Expected: 回到终端视图，可直接输入。右键任一文件 →「用系统默认应用打开」。Expected: 系统应用打开且不出现查看器。

**Step 5: 记录结果**

把实际观察结果写入本次任务完成说明；发现偏差时回到对应任务修复并重跑该任务验证。

---

## 计划自检

- 需求覆盖：文件栏隐藏条目（Task 1-2）、查看器打开与展示（Task 3-7）、不可预览回退（Task 7 分流 + Task 6 错误提示）、关闭回终端（Task 9）、系统打开入口（Task 8）、只读语义（Task 6 仅 `textContent` 渲染，无写操作）、集成验证（Task 10-12）。
- 无占位内容：所有步骤均给出实际代码或可执行命令。
- 类型一致：`isPreviewableText(extension)`、`openViewer(path)`、`closeViewer()`、`renderViewer()`、`activateTreeFile(path)`、`fileExtension(path)` 在任务间签名一致。
