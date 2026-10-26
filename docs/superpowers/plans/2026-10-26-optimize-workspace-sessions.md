---
change: optimize-workspace-sessions
design-doc: docs/openspec/changes/optimize-workspace-sessions/design.md
base-ref: d66dc2822104a07be6bcb96308452f809c7710f5
---
<!-- comet-task-authority: docs/openspec/changes/optimize-workspace-sessions/tasks.md -->

# 优化项目与会话区域 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. 主会话负责协调与审查;实现代理按任务范围实施。任务完成状态以 `<!-- comet-task-authority -->` 指向的 tasks.md 为准,本计划不维护第二套 checkbox,用 `<!-- comet-task-ref:<id> -->` 关联。

**Goal:** 给对话工作站的项目与会话区域增加搜索过滤、自定义重命名+元信息、置顶、归档恢复、批量删除,并优化分组缩进层级。

**Architecture:** 沿用既有分层——路由(`server/routes/handlers.mjs` 的 ROUTES Map)→ 工作区模块(`server/workspace/state.mjs` 状态、`sessions.mjs` 列表/移除)→ `atomicJson` 原子写 `~/.claude/workbench-workspace.json`;前端沿用 `src/workspace/` ES modules(`sessions.mjs` 渲染、`activity.mjs` 行标记),无框架无新依赖。会话条目新增可选字段 `customName`/`pinned`/`archived`,缺省回退现有行为。

**Tech Stack:** Node.js 原生 ES modules、`node:test`、xterm.js 前端(本 change 不触碰)、CSS(内联于 index.html 的 `<style>`)。

---

## 关键上下文(实现代理必读)

### 现有代码锚点

| 位置 | 内容 |
| --- | --- |
| `server/workspace/state.mjs` | `workspaceSessionName(session)` 自动命名;`workspaceState()` 读取 `WORKSPACE_FILE` 并把占位名(「新对话」「继续最近对话」「」)重写为自动名;`atomicJson(FILE, data)` 原子写回 |
| `server/workspace/sessions.mjs` | `listWorkspaceSessions(root='')`:按 projectPath 过滤 → 加 `status`(running/stopped)→ 按 `lastUsedAt` 倒序;`removeWorkspaceSession(id)`:在线终端先 `proc.write('\u0003')` 再 1.8s 延时 `kill()`,然后从文件删除条目 |
| `server/routes/handlers.mjs:26` `GET_ROUTES` | `['/api/workspace/sessions', url => listWorkspaceSessions(url.searchParams.get('projectPath'))]` |
| `server/routes/handlers.mjs:71-73` `POST_ROUTES` | `/api/workspace/session`、`/api/workspace/session/remove`、`/api/workspace/session/stop`;handler 签名 `(body, url)`,throw 时框架统一返回 400 |
| `src/workspace/sessions.mjs` | `refreshSessions()`:请求 API → `groupSessionsByProject(sessions)` 分组 → `sessionGroupMarkup` 渲染到 `#sessionList` → 逐行绑定 onclick;`removeSession(id)` |
| `src/workspace/activity.mjs:25` `sessionRowMarkup(item)` | 行结构:`.session-item` > `.session-row`(标题当前显示 `projectName(item.projectPath)`——要改为会话名优先)+ `.session-remove` 按钮;`refreshSessionStatuses()` 3 秒轮询只替换 `[data-session-status]` 节点,不重建行 |
| `src/workspace/preferences.mjs` | `formatSessionTime(value)`、`projectName(path)`、`sessionGroupKey(path)` 已有 |
| `index.html:63-67` | 会话区头部:`.session-heading` / `.session-actions`(#newSession、#continueSession)/ `.session-list-head`(含 #refreshSessions)/ `#sessionList`;样式在页内 `<style>` 块 |
| `src/workspace/state.mjs`(前端) | 全局 `app` 对象与 `keys`(localStorage 键) |
| `tests/server-routes.test.mjs` | `startServer(0)` 起真实服务,`before/after` + `fetch` 断言 |

### 测试隔离约定(必须遵守)

`WORKSPACE_FILE`(`server/core/paths.mjs`)指向真实 `~/.claude/workbench-workspace.json`。**任何测试不得读写真实文件**。实现方式:

- `server/workspace/state.mjs` 顶部改为模块级可变引用:

```js
let workspaceFile = WORKSPACE_FILE;
/** 仅供测试重定向工作区数据文件;生产代码不得调用 */
export function setWorkspaceFileForTest(file) { workspaceFile = file; }
```

- `state.mjs` 与 `sessions.mjs` 中所有原 `WORKSPACE_FILE` 读写改用 `workspaceFile`。
- 测试在 `before` 中 `setWorkspaceFileForTest(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-')) + '/workspace.json')`,`after` 还原为原值并清理临时目录。
- `tdd_mode=direct`:不强制逐任务 RED/GREEN,但每个任务**必须先写测试并运行确认失败原因、再实现、再跑绿**(测试是验收命令,不是形式)。

### 提交约定

每个任务完成后提交:信息用中文、格式 `feat(workspace): <内容>`(与仓库现有 conventional 风格一致);任务内多次提交可合并为一次。归档交付由 Comet 流程管理,不在本计划内 push。

---

## 任务 1.1 `<!-- comet-task-ref:06c19a6a-2dba-4829-836f-fb1f9ab87d80 -->` 会话条目新字段与显示名

**Files:**
- Modify: `server/workspace/state.mjs`(workspaceState 的 namedSessions 段)
- Create: `tests/workspace-state.test.mjs`

**要点:**
1. 按上文「测试隔离约定」加 `setWorkspaceFileForTest`。
2. `workspaceState()` 的 `namedSessions` 映射保留可选字段:条目为 `{ ...session, name: 自动名 }` 时,`customName`、`pinned`、`archived` 经展开自然保留;需补的是规范化——`customName` 非 string 时忽略,`pinned`/`archived` 仅在 `=== true` 时视为真。
3. 新增导出 `sessionDisplayName(session)`:`session.customName?.trim() || session.name || workspaceSessionName(session)`。
4. 测试用例(临时文件写入 `sessions` 数组后断言):
   - 有 `customName: "我的调试会话"` 时 `sessionDisplayName` 返回它
   - `customName: "  "`(空白)回退自动名
   - 无任何新字段的旧条目:不报错、`pinned`/`archived` 视为假、显示自动名
   - `workspaceState()` 不丢弃/不改写这些字段(读出再断言)

**验证:** `node --test tests/workspace-state.test.mjs` 全绿;`node --test "tests/**/*.test.mjs"` 无回归。

---

## 任务 1.2 `<!-- comet-task-ref:7b7e1287-1a19-41e9-9d0c-cee1540d3304 -->` 列表排序置顶优先与归档过滤

**Files:**
- Modify: `server/workspace/sessions.mjs`(listWorkspaceSessions)
- Modify: `server/routes/handlers.mjs:28`(GET /api/workspace/sessions)
- Modify: `tests/workspace-state.test.mjs`(追加用例)

**要点:**
1. `listWorkspaceSessions(root = '', options = {})`:
   - 默认过滤 `x.archived === true` 的条目;`options.archived === true` 时**只返回**归档条目
   - 排序:置顶优先 `(Number(b.pinned === true) - Number(a.pinned === true)) || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt))`
   - map 中追加 `displayName: sessionDisplayName(x)`(供前端直接渲染)
2. `GET /api/workspace/sessions` 支持 `?archived=1`:`listWorkspaceSessions(url.searchParams.get('projectPath'), { archived: url.searchParams.get('archived') === '1' })`。
3. 测试:构造同项目 3 条会话(1 条 pinned 且 lastUsedAt 最旧、1 条 archived)——断言默认列表不含 archived、pinned 排最前;`archived:true` 只返回归档条目;`displayName` 为 customName 优先。

**验证:** `node --test tests/workspace-state.test.mjs` 全绿。

---

## 任务 1.3 `<!-- comet-task-ref:8f5f864f-3f88-44f3-84fb-12330863d7f1 -->` 重命名/置顶/归档状态更新

**Files:**
- Modify: `server/workspace/sessions.mjs`
- Modify: `tests/workspace-state.test.mjs`(追加用例)

**要点:**
1. 抽公共辅助(消除与 `removeWorkspaceSession` 的重复):

```js
/** 终止会话的在线终端:先 Ctrl+C,1.8s 后仍未退出则强杀 */
function stopWorkspaceTerminal(session) {
  const terminal = workspaceTerminals.get(session.id);
  if (!terminal) return;
  try { terminal.proc.write('\u0003'); } catch {}
  const timer = setTimeout(() => {
    if (workspaceTerminals.has(session.id)) {
      try { terminal.proc.kill(); } catch {}
      workspaceTerminals.delete(session.id);
    }
  }, 1800);
  timer.unref?.();
}
```

   `removeWorkspaceSession` 改为调用它(行为不变)。
2. 三个更新函数(找不到会话时 `throw new Error('找不到该会话')`,由路由框架转 400;更新后 `atomicJson` 写回并返回 `workspaceState().sessions.find(...)` 的最新条目):

```js
export function renameWorkspaceSession(id, customName)  // customName trim 后为空则删除该字段(回退自动名)
export function pinWorkspaceSession(id, pinned = true)  // 仅当 pinned !== false 时写 true,否则删除字段
export function archiveWorkspaceSession(id, archived = true)
```

3. `archiveWorkspaceSession` 在 `archived === true` 且终端在线时先 `stopWorkspaceTerminal(session)`(设计决策 9:归档在线会话先终止终端;Claude 记录不动)。
4. 测试:写回后重新 `workspaceState()` 断言字段;`renameWorkspaceSession(id, '')` 后条目无 `customName`;archive 在线会话(向 `workspaceTerminals` 塞一个带 `proc.write`/`kill` 桩的对象)断言 Ctrl+C 已发送;未知 id 抛错。

**验证:** `node --test tests/workspace-state.test.mjs` 全绿。

---

## 任务 2.1 `<!-- comet-task-ref:ecec0c42-c2e2-465a-ae99-19b2adf61951 -->` 三条会话状态路由

**Files:**
- Modify: `server/routes/handlers.mjs`(POST_ROUTES + import)
- Modify: `tests/server-routes.test.mjs`(追加用例)

**要点:**
1. `POST_ROUTES` 追加(handler 风格与 `session/remove` 一致,单条目返回 `{ status: 200, body: <结果> }`):

```js
['/api/workspace/session/rename', body => ({ status: 200, body: renameWorkspaceSession(body.id, body.customName) })],
['/api/workspace/session/pin', body => ({ status: 200, body: pinWorkspaceSession(body.id, body.pinned !== false) })],
['/api/workspace/session/archive', body => ({ status: 200, body: archiveWorkspaceSession(body.id, body.archived !== false) })],
```

2. 路由测试的 `before` 中调用 `setWorkspaceFileForTest(临时文件)`,`after` 还原(见隔离约定);用 `POST /api/workspace/session` 建一条会话作为夹具(或直接写临时文件)再操作。
3. 测试用例:rename 200 且返回条目含 customName;pin/archive 200;未知 id 返回 400 与 `{ error }`;`?archived=1` 列表接口返回归档条目。

**验证:** `node --test tests/server-routes.test.mjs` 全绿。

---

## 任务 2.2 `<!-- comet-task-ref:88272c1b-3f55-44e5-ac7a-5f7c140d9396 -->` 批量删除接口

**Files:**
- Modify: `server/workspace/sessions.mjs`
- Modify: `server/routes/handlers.mjs`(POST_ROUTES)
- Modify: `tests/server-routes.test.mjs`(追加用例)

**要点:**
1. `export function removeWorkspaceSessionsBatch(ids)`:`ids` 非数组或为空时 `throw new Error('请选择要移除的会话')`;逐个调用 `removeWorkspaceSession`,汇总:

```js
// 返回结构:部分失败不中断、不回滚
{ removed: <成功条数>, failed: [{ id, error }], transcriptPreserved: true }
```

2. 路由:`['/api/workspace/sessions/remove-batch', body => ({ status: 200, body: removeWorkspaceSessionsBatch(body.ids) })]`。
3. 测试:混合存在/不存在的 id——存在的被删除、不存在的进 `failed`;空 ids 返回 400。

**验证:** `node --test tests/server-routes.test.mjs` 全绿。

---

## 任务 3.1 `<!-- comet-task-ref:f85c978b-3a00-40e4-af67-a17e6b9a8212 -->` 会话行展示与缩进层级

**Files:**
- Modify: `src/workspace/activity.mjs`(sessionRowMarkup)
- Modify: `index.html`(`<style>` 块)

**要点:**
1. 行标题改 `escapeHtml(item.displayName || item.name)`(后端已给 `displayName`);元信息行显示 `formatSessionTime(item.lastUsedAt || item.createdAt)`;`item.pinned` 时行加 `is-pinned` 类并在名称前渲染置顶标记(如 `<span class="pin-mark" title="已置顶">📌</span>`);行根元素加 `data-session-pinned`。
2. 信息主次:会话名 `<strong>` 与状态标记为一级;时间与模式收进 `<small>` 弱化色;`.session-row` 相对 `.session-group-head` 加可见缩进(如 `padding-left: 14px` + 分组体左边框或背景层级),具体值按现有变量体系微调。
3. 纯样式与标记改动,不改 DOM 结构与事件绑定(打开/移除行为保持)。

**验证:** `node server.mjs` 启动后浏览器走查:自定义名/自动名正确、缩进可辨、置顶标记可见;`node --test "tests/**/*.test.mjs"` 无回归。

---

## 任务 3.2 `<!-- comet-task-ref:7d1c99ae-b2c1-4e97-88cf-080f3ac819f4 -->` 重命名/置顶/归档操作接线

**Files:**
- Modify: `src/workspace/activity.mjs`(行内操作按钮)
- Modify: `src/workspace/sessions.mjs`(操作函数 + refreshSessions 绑定)

**要点:**
1. `sessionRowMarkup` 的 `.session-item` 内增加行内按钮(与现有 `.session-remove` 同风格):重命名 `✎`(data-rename-session)、置顶/取消 `📌`(data-pin-session,title 按 pinned 状态切换)、归档 `📦`(data-archive-session)。
2. `src/workspace/sessions.mjs` 新增并接线:

```js
async function renameSessionPrompt(id, currentName) // prompt() 预填当前名,确认后 POST /api/workspace/session/rename {id, customName};取消不动作
async function togglePinSession(id, pinned)          // POST /api/workspace/session/pin
async function archiveSession(id)                    // POST /api/workspace/session/archive {id, archived:true};在线会话由后端终止,前端 toast 提示「已归档,在线终端已停止」
```

   操作成功后 `refreshSessions()`(归档后主列表即消失)。
3. `refreshSessions` 中与新按钮绑定 onclick(`event.stopPropagation()` 防止触发行打开,模式同现有 remove 绑定)。
4. 重命名空串=回退自动名(后端已处理),前端不再拦截空值。

**验证:** 走查:重命名立即生效、清空回退自动名、置顶/取消后行位置与标记变化、归档后从主列表消失(在线会话终端停止);`node --test` 无回归。

---

## 任务 3.3 `<!-- comet-task-ref:a3146234-8978-4a9c-af33-f0a982b2f15e -->` 会话搜索过滤

**Files:**
- Modify: `index.html`(session-list-head 加输入框)
- Modify: `src/workspace/sessions.mjs`(渲染层过滤)
- Modify: `src/workspace/state.mjs`(前端 app 字段)

**要点:**
1. `.session-list-head` 的刷新按钮前加 `<input id="sessionSearch" type="search" placeholder="搜索会话或项目" aria-label="搜索会话">`;绑定 `input` 事件(防抖可省——列表数据在内存,直接重渲染)。
2. `refreshSessions` 拉取后缓存 `app.cachedSessions = sessions`;渲染抽为内部函数 `renderSessions()`:按 `app.sessionSearch` 过滤(关键字 `toLowerCase()` 匹配 `displayName/name/projectName(projectPath)/projectPath`),无匹配渲染 `<div class="empty">没有匹配的对话</div>`,空关键字渲染全量;搜索输入只调 `renderSessions()`,不发请求。
3. 批量模式(任务 3.5)叠加在过滤结果上,渲染逻辑保持单一入口。

**验证:** 走查:输入关键字即时过滤(会话名/项目名/路径)、清空恢复、无匹配空态;轮询期间过滤视图稳定。

---

## 任务 3.4 `<!-- comet-task-ref:205811d3-de1a-4c19-bb33-c51127f48f38 -->` 归档面板

**Files:**
- Modify: `index.html`(归档入口按钮 + 面板容器)
- Modify: `src/workspace/sessions.mjs`(面板渲染与恢复)

**要点:**
1. `.session-list-head` 加「归档」入口按钮(#archiveToggle);`#sessionList` 旁加隐藏面板 `#archivePanel`(hidden 属性,复用 `.session-list` 行样式),打开时隐藏主列表、关闭时还原。
2. 打开面板:`api('/api/workspace/sessions?archived=1')` 渲染归档行(名称 + 归档时间 + 「恢复」按钮 + 「彻底移除」按钮复用 `data-remove-session`)。
3. 恢复:`POST /api/workspace/session/archive {id, archived:false}` → 重新拉取两个列表;项目已隐藏/未登记时后端仍恢复(条目按 projectPath 归组,前端分组按 sessionGroupKey 自然呈现)。
4. 搜索框在归档面板打开时隐藏(或仅作用于主列表——取简:隐藏)。

**验证:** 走查:归档 → 打开面板可见 → 恢复后回到主列表正确分组;彻底移除行为与现有移除一致。

---

## 任务 3.5 `<!-- comet-task-ref:a624f09e-816e-46eb-90f1-e18485dc1ad3 -->` 批量选择与删除

**Files:**
- Modify: `index.html`(批量入口按钮 + 批量操作栏)
- Modify: `src/workspace/sessions.mjs`(批量模式渲染与提交)
- Modify: `src/workspace/state.mjs`(app.bulkMode/bulkSelected)

**要点:**
1. `.session-actions` 加「批量管理」按钮(#bulkToggle):进入时 `app.bulkMode = true; app.bulkSelected = new Set()`;行渲染加复选框 `<input type="checkbox" data-bulk-id>`,勾选事件写 `app.bulkSelected`(add/delete)。
2. `renderSessions()` 全量重建后按 `app.bulkSelected` 恢复各行 checked(解决重绘丢勾选);3 秒轮询 `refreshSessionStatuses` 只替换状态节点、不重建行,天然不清勾选——不改它。
3. 批量操作栏(bulkMode 时显示):已选计数、「全选(当前过滤结果)」、「删除所选」(先 `confirm(`确认移除所选 ${n} 条对话?Claude 记录将保留`)`,再 `POST /api/workspace/sessions/remove-batch { ids: [...app.bulkSelected] }`)、退出。结果 toast:`成功移除 n 条` + 失败清单(如有);完成后清空 `bulkSelected`、`refreshSessions()`。
4. 删除作用于全部勾选项,与当前搜索过滤无关(勾选是显式动作);批量删除期间禁用删除按钮防重复提交。

**验证:** 走查:勾选 → 等 1 个轮询周期(≥3s)勾选保持 → 批量删除含在线会话 → toast 汇总正确、列表刷新、模式退出。

---

## 任务 4.1 `<!-- comet-task-ref:fcce8805-9448-4061-8d09-b7b2d5914bc4 -->` 全量测试

**Files:** 无新改动(纯验证)

**步骤:** 在 worktree 根运行 `npm test`(等价 `node --test "tests/**/*.test.mjs"`),必须全部通过;失败则修复后重跑(修复属对应任务范围,回归修复直接做)。

**验证:** 命令输出 `# pass N` 且 `# fail 0`。

---

## 任务 4.2 `<!-- comet-task-ref:43979bee-ceba-468e-ad9e-17b5b5e31958 -->` 端到端验收走查

**Files:** 无新改动(纯验证)

**步骤:** 启动 worktree 服务(注意项目记忆:必须显式覆盖 `CLAUDE_WORKBENCH_PORT` 与 `CLAUDE_WORKBENCH_WEB_ROOT`,避免继承 Claude 会话注入的端口/旧前端副本),多项目多会话夹具下对照 `specs/session-list-management/spec.md` 与 `specs/session-project-grouping/spec.md` 场景逐条核对:搜索三场景、重命名三场景、元信息、置顶两场景、归档四场景(含在线会话终止)、批量删除三场景、轮询稳定性、分组缩进;记录逐条通过结果。

**验证:** specs 全部场景通过,无偏离项。

---

## 任务 5.1 `<!-- comet-task-ref:425858fe-7041-436d-b6e6-771b844d1c49 -->` 管理操作收进"⋯"更多菜单(用户验收增补)

**Files:**
- Modify: `index.html`(tools 加 #moreToggle 与 #moreMenu 菜单:批量管理 #moreBulk、查看归档 #moreArchive;移除原 #bulkToggle/#archiveToggle)
- Modify: `src/workspace/sessions.mjs`(toggleMoreMenu/closeMoreMenu,菜单项执行后收起,点击外部关闭;清理旧按钮绑定)
- Modify: `src/styles/sessions.css`(.session-more-menu 右对齐浮层,暗色适配)

**要点:** 参考既有 fileTreeContextMenu 交互;搜索框与 ↻ 刷新保持常显;.session-actions 恢复两列。菜单是低频管理入口,收拢解决窄侧栏拥挤。

**验证:** 走查菜单展开/执行/外部收起;npm test 无回归。

---

## 任务 5.2 `<!-- comet-task-ref:cf6b87a2-bbe2-4eb7-a98a-b949172fa498 -->` 删除操作统一二次确认(用户验收增补)

**Files:**
- Modify: `src/workspace/sessions.mjs`(removeSession 入口加 confirm,取消不执行)

**要点:** 单条移除(×)与归档面板彻底移除共用 removeSession,一处生效;文案说明 Claude 记录保留;批量删除既有 confirm 不动。对应 delta spec 新增「删除操作二次确认」requirement。

**验证:** 走查确认/取消两路径;npm test 无回归。

---

## 自检记录

- **Spec 覆盖**:session-list-management 7 个 requirement → 任务 3.3(搜索)、1.1+3.2(重命名)、3.1(元信息)、1.2+3.2(置顶)、1.3+3.4(归档含在线终止场景)、2.2+3.5(批量删除)、3.5(轮询稳定);session-project-grouping 修改项 → 1.2(排序)+3.1(缩进)。无缺口。
- **占位符扫描**:无 TBD/TODO;所有代码步骤给出接口签名或结构;测试隔离约定给出完整代码。
- **类型一致性**:`displayName`(后端 1.2 产出 → 前端 3.1 消费)、`removeWorkspaceSessionsBatch` 返回结构(2.2 定义 → 3.5 消费)、`setWorkspaceFileForTest`(约定节定义 → 1.1 落地 → 2.1/2.2 复用)一致。

## 实施期偏离记录

- 任务 3.1 样式落点:index.html 内联 `<style>` → `src/styles/sessions.css`(该块仅管理页样式,构建 CSS 会覆盖内联;见 rulings style-location)。
- 任务 3.2 重命名:原生 `prompt()` → 行内 input 编辑(Tauri WebView2 不支持 prompt;见 rulings no-window-prompt)。
- 任务 3.4 归档行时间:显示最后活动时间(`lastUsedAt||createdAt`)而非计划所写「归档时间」——规格未要求归档时间,后端无 `archivedAt` 字段;规格优先于计划文字,判定可接受(审查复核确认)。

## 任务 5.3 `<!-- comet-task-ref:77b6f13d-4a7c-4c21-8fc1-f3147edb6485 -->` 会话行操作收进行级"⋯"菜单(用户验收澄清)

**Files:**
- Modify: `index.html`(#sessionRowMenu 共享行菜单容器)、`src/workspace/activity.mjs`(行尾常显 ⋯,移除悬停按钮组与 ×)、`src/workspace/sessions.mjs`(openRowMenu/runRowAction,菜单项复用既有操作函数)、`src/styles/sessions.css`、`src/styles/layout.css`
**要点:** 普通会话菜单=重命名/置顶切换/归档/移除(自带二次确认);归档会话菜单=恢复/彻底移除;深浅主题变量;点击外部与 Esc 收起。
**验证:** 走查菜单展开/各项操作/外点收起;npm test 无回归。
