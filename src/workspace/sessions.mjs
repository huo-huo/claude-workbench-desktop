import { $, escapeHtml } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';
import { projectName, sessionGroupKey, formatSessionTime, readCollapsedProjects, writeCollapsedProjects, updateTerminalEmptyState } from './preferences.mjs';
import { connectTerminal } from './terminal.mjs';
import { syncSessionActivityMonitors, sessionRowMarkup } from './activity.mjs';
import { refreshProjects, activateProject } from './projects.mjs';

export function groupSessionsByProject(sessions) {
  const groups = new Map();
  for (const session of sessions) {
    const key = sessionGroupKey(session.projectPath);
    if (!groups.has(key)) groups.set(key, { key, path: session.projectPath || '', sessions: [] });
    groups.get(key).sessions.push(session);
  }
  // 组内最新使用时间（毫秒），无法解析时按 0 处理
  const latestTime = group => group.sessions.reduce(
    (latest, item) => Math.max(latest, Date.parse(item.lastUsedAt || item.createdAt) || 0), 0,
  );
  return [...groups.values()].sort((a, b) => latestTime(b) - latestTime(a));
}

// 分组标题 + 组内会话行；折叠状态由 is-collapsed 类与 aria-expanded 同步表达
export function sessionGroupMarkup(group, collapsedKeys) {
  const collapsed = collapsedKeys.includes(group.key);
  return `<section class="session-group${collapsed ? ' is-collapsed' : ''}" data-session-group="${escapeHtml(group.key)}"><button class="session-group-head" type="button" aria-expanded="${String(!collapsed)}" title="${escapeHtml(group.path)}"><span class="session-group-caret" aria-hidden="true">▾</span><span class="session-group-name">${escapeHtml(projectName(group.path))}</span><span class="session-group-path">${escapeHtml(group.path)}</span><span class="session-group-count">${group.sessions.length}</span></button><div class="session-group-body">${group.sessions.map(sessionRowMarkup).join('')}</div></section>`;
}

// 切换分组折叠状态并持久化到 localStorage
export function toggleSessionGroup(groupElement) {
  if (!groupElement) return;
  const key = groupElement.dataset.sessionGroup || '';
  const collapsed = groupElement.classList.toggle('is-collapsed');
  groupElement.querySelector('.session-group-head')?.setAttribute('aria-expanded', String(!collapsed));
  const keys = readCollapsedProjects().filter(item => item !== key);
  if (collapsed) keys.push(key);
  writeCollapsedProjects(keys);
}


/** 按关键字过滤会话:匹配显示名/名称/项目名/项目路径;空关键字返回全量 */
function filterSessions(sessions, keyword) {
  const key = String(keyword || '').trim().toLowerCase();
  if (!key) return sessions;
  return sessions.filter(item => [item.displayName, item.name, projectName(item.projectPath), item.projectPath]
    .some(field => String(field || '').toLowerCase().includes(key)));
}

/** 绑定行级事件:打开/移除/重命名/置顶/归档/分组折叠(innerHTML 全量重建后调用) */
function bindSessionRows(sessions) {
  document.querySelectorAll('[data-session-id]').forEach(button => button.onclick = () => openSavedSession(sessions.find(x => x.id === button.dataset.sessionId)));
  document.querySelectorAll('[data-remove-session]').forEach(button => button.onclick = event => { event.stopPropagation(); removeSession(button.dataset.removeSession).catch(error => toast(error.message)); });
  // 行内操作:重命名/置顶/归档;stopPropagation 防止冒泡触发会话行打开(模式同上方移除绑定)
  document.querySelectorAll('[data-rename-session]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    const session = sessions.find(x => x.id === button.dataset.renameSession);
    if (session) renameSessionInline(button, session.displayName || session.name);
  });
  document.querySelectorAll('[data-pin-session]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    const session = sessions.find(x => x.id === button.dataset.pinSession);
    if (session) togglePinSession(session.id, session.pinned === true).catch(error => toast(error.message));
  });
  document.querySelectorAll('[data-archive-session]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    archiveSession(button.dataset.archiveSession).catch(error => toast(error.message));
  });
  document.querySelectorAll('.session-group-head').forEach(head => head.onclick = () => toggleSessionGroup(head.closest('.session-group')));
  // 批量模式复选框:勾选写入 app.bulkSelected,重绘后由行标记恢复(轮询只替换状态节点,不清勾选)
  document.querySelectorAll('[data-bulk-id]').forEach(box => box.onchange = () => {
    if (box.checked) app.bulkSelected.add(box.dataset.bulkId);
    else app.bulkSelected.delete(box.dataset.bulkId);
    updateBulkBar();
  });
}

/** 按搜索关键字过滤缓存数据并渲染主列表(搜索输入只重渲染,不发请求) */
function renderSessions() {
  const sessions = filterSessions(app.cachedSessions, app.sessionSearch);
  // 按项目目录分组渲染;折叠状态与分组 key 共用 sessionGroupKey 结果
  const groups = groupSessionsByProject(sessions);
  const collapsedKeys = readCollapsedProjects();
  $('#sessionList').innerHTML = groups.length ? groups.map(group => sessionGroupMarkup(group, collapsedKeys)).join('') : `<div class="empty">${String(app.sessionSearch || '').trim() ? '没有匹配的对话' : '还没有对话。选择项目文件夹后新建一个。'}</div>`;
  bindSessionRows(sessions);
}

/** 归档面板行:名称 + 最后活动时间(后端不记录归档时间,取最后活动时间)+ 恢复/彻底移除;复用 .session-list 行样式 */
function archiveRowMarkup(item) {
  return `<div class="session-item"><span class="session-row archive-row"><span class="session-row-title"><strong>${escapeHtml(item.displayName || item.name)}</strong></span><small><span class="session-row-detail">${escapeHtml(formatSessionTime(item.lastUsedAt || item.createdAt))}</span></small></span><span class="session-ops"><button class="session-op" data-restore-session="${escapeHtml(item.id)}" title="恢复到对话列表" aria-label="恢复归档对话">↩</button></span><button class="session-remove" data-remove-session="${escapeHtml(item.id)}" title="彻底移除；Claude 对话记录保留" aria-label="彻底移除归档对话">×</button></div>`;
}

/** 拉取归档条目并渲染面板;恢复/移除按钮在此绑定(面板行不在主列表缓存内) */
async function renderArchivePanel() {
  const result = await api('/api/workspace/sessions?archived=1');
  const sessions = result.sessions || [];
  $('#archivePanel').innerHTML = sessions.length ? sessions.map(archiveRowMarkup).join('') : '<div class="empty">没有归档的对话</div>';
  document.querySelectorAll('[data-restore-session]').forEach(button => button.onclick = event => {
    event.stopPropagation();
    restoreSession(button.dataset.restoreSession).catch(error => toast(error.message));
  });
  document.querySelectorAll('#archivePanel [data-remove-session]').forEach(button => button.onclick = event => { event.stopPropagation(); removeSession(button.dataset.removeSession).catch(error => toast(error.message)); });
}

/** 关闭归档面板,还原主列表与搜索框 */
function closeArchivePanel() {
  $('#archivePanel').hidden = true;
  $('#sessionList').hidden = false;
  $('#sessionSearch').hidden = false;
}

/** 切换归档面板:打开时隐藏主列表与搜索框并拉取归档列表,关闭时还原 */
function toggleArchivePanel() {
  const panel = $('#archivePanel');
  if (!panel.hidden) return closeArchivePanel();
  // 与批量模式双向互斥:面板上下文下批量栏可删除不可见的勾选项,先退出批量
  if (app.bulkMode) exitBulkMode();
  panel.hidden = false;
  $('#sessionList').hidden = true;
  $('#sessionSearch').hidden = true;
  renderArchivePanel().catch(error => { closeArchivePanel(); toast(error.message); });
}

/** 恢复归档对话到主列表:成功后同时重拉主列表与归档面板 */
async function restoreSession(id) {
  await api('/api/workspace/session/archive', { method: 'POST', body: { id, archived: false } });
  await Promise.all([refreshSessions(), renderArchivePanel()]);
  toast('已恢复到对话列表');
}

/** 刷新批量操作栏的已选计数 */
function updateBulkBar() {
  $('#bulkCount').textContent = `已选 ${app.bulkSelected.size} 条`;
}

/** 进入批量模式:归档面板与批量互斥先关面板;显示操作栏并重渲染出复选框 */
function enterBulkMode() {
  if (!$('#archivePanel').hidden) closeArchivePanel();
  app.bulkMode = true;
  app.bulkSelected = new Set();
  $('#bulkBar').hidden = false;
  updateBulkBar();
  renderSessions();
}

/** 退出批量模式:隐藏操作栏、清空勾选并重渲染去掉复选框 */
function exitBulkMode() {
  app.bulkMode = false;
  app.bulkSelected = new Set();
  $('#bulkBar').hidden = true;
  renderSessions();
}

/** 全选/取消全选当前过滤结果(跟随搜索框);以过滤结果为操作面,过滤外的勾选保持不动 */
function toggleBulkSelectAll() {
  const ids = filterSessions(app.cachedSessions, app.sessionSearch).map(item => item.id);
  const allSelected = ids.length > 0 && ids.every(id => app.bulkSelected.has(id));
  if (allSelected) ids.forEach(id => app.bulkSelected.delete(id));
  else ids.forEach(id => app.bulkSelected.add(id));
  updateBulkBar();
  renderSessions();
}

/** 批量删除所选:confirm 确认后请求 remove-batch 并 toast 汇总;请求期间禁用删除按钮防重复提交 */
async function removeBulkSelected() {
  const ids = [...app.bulkSelected];
  if (!ids.length) return toast('先勾选要移除的对话');
  if (!confirm(`确认移除所选 ${ids.length} 条对话?Claude 记录将保留`)) return;
  $('#bulkDelete').disabled = true;
  try {
    const result = await api('/api/workspace/sessions/remove-batch', { method: 'POST', body: { ids } });
    const failed = result.failed || [];
    // 汇总:成功条数 + 失败清单(如有);删除作用于全部勾选项,与当前搜索过滤无关
    toast(failed.length ? `成功移除 ${result.removed} 条，失败 ${failed.length} 条：${failed.map(item => item.id).join('、')}` : `成功移除 ${result.removed} 条`);
    exitBulkMode();
    await refreshSessions();
  } catch (error) {
    toast(error.message);
  } finally {
    $('#bulkDelete').disabled = false;
  }
}

export async function refreshSessions() {
  const result = await api('/api/workspace/sessions');
  const sessions = result.sessions || [];
  syncSessionActivityMonitors(sessions);
  const currentProjectKey = sessionGroupKey(app.projectPath);
  app.projectSessions = sessions.filter(item => sessionGroupKey(item.projectPath) === currentProjectKey);
  updateTerminalEmptyState();
  // 缓存全量列表后统一走 renderSessions,保证搜索过滤与刷新共用单一渲染入口
  app.cachedSessions = sessions;
  renderSessions();
}


export async function startSession(mode, saved = null) {
  if (!app.projectPath) return toast('先选择项目文件夹');
  try {
    const body = { projectPath: app.projectPath, mode, name: mode === 'resume' ? saved?.name : '' };
    if (saved?.id) body.workbenchSessionId = saved.id;
    if (mode === 'resume') body.sessionId = saved?.sessionId;
    const session = await api('/api/workspace/session', { method: 'POST', body });
    connectTerminal(session);
    $('#terminalEmpty').hidden = true;
    Promise.all([refreshProjects(), refreshSessions()]).catch(() => {});
  } catch (error) { toast(error.message); }
}

export async function continueLastConversation() {
  if (!app.projectPath) return toast('先选择项目文件夹');
  const latest = [...app.projectSessions].sort((a, b) => String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt)))[0];
  if (latest?.status === 'running') return connectTerminal(latest);
  if (latest?.sessionId) return startSession('resume', latest);
  return startSession(latest?.mode === 'picker' ? 'picker' : 'continue', latest || null);
}

export async function openSavedSession(session) {
  if (!session) return;
  await activateProject(session.projectPath);
  if (session.status === 'running') return connectTerminal(session);
  if (session.sessionId) return startSession('resume', session);
  return startSession(session.mode === 'picker' ? 'picker' : 'continue', session);
}

export function closeCurrentSession() {
  if (!app.activeSession) return;
  const session = app.activeSession;
  clearTimeout(app.terminalReconnectTimer);
  app.terminalReconnectTimer = null;
  app.terminalReconnectAttempts = 0;
  app.terminalSessionAlive = false;
  app.socket?.close();
  app.socket = null;
  app.activeSession = null;
  app.terminal?.reset();
  $('#terminalEmptyTitle').textContent = '终端视图已收起';
  $('#terminalEmptyDescription').textContent = 'Claude 会话仍在运行并保留在左侧列表。点击那条对话可重新打开；需要打断当前工作时请点“中断”。';
  $('#terminalEmpty').hidden = false;
  $('#terminalState').textContent = '视图已收起 · 会话仍在运行';
  $('#terminalLed').classList.remove('live');
  $('#closeSession').disabled = true;
  $('#stopSession').disabled = true;
  $('#terminalTitle').textContent = projectName(session.projectPath);
  $('#terminalSubtitle').textContent = session.projectPath;
  refreshSessions().catch(() => {});
  toast('终端视图已收起；Claude 会话没有停止');
}

export function interruptCurrentSession() {
  if (!app.activeSession || app.socket?.readyState !== WebSocket.OPEN) {
    toast('当前没有连接中的 Claude 会话');
    return;
  }
  app.socket.send(JSON.stringify({ type: 'input', data: '\u001b' }));
  app.terminal?.focus();
  toast('已发送 Esc，用于停止 Claude 当前回复或工具操作');
}


/** 重命名对话:行内编辑(Tauri WebView2 不支持 window.prompt)。Enter 确认;Escape 取消;失焦且未改动时恢复原显示 */
function renameSessionInline(button, currentName) {
  const nameBox = button.closest('.session-item')?.querySelector('.session-row-title');
  if (!nameBox) return;
  const item = nameBox.closest('.session-item');
  const original = nameBox.innerHTML;
  item.classList.add('is-renaming');
  nameBox.innerHTML = `<input class="session-rename-input" type="text" value="${escapeHtml(currentName)}" aria-label="重命名对话">`;
  const input = nameBox.querySelector('input');
  input.focus();
  input.select();
  // 恢复原行显示并解除编辑态(状态节点随 innerHTML 还原,轮询恢复可见)
  const restore = () => { input.onblur = null; item.classList.remove('is-renaming'); nameBox.innerHTML = original; };
  // 提交:未改动直接恢复不请求;空串仍交后端回退自动名;请求期间保留编辑态,完成或失败后恢复
  const submit = () => {
    input.onblur = null;
    if (input.value === currentName) return restore();
    api('/api/workspace/session/rename', { method: 'POST', body: { id: button.dataset.renameSession, customName: input.value } })
      .then(restore)
      .then(() => refreshSessions())
      .catch(error => { restore(); toast(error.message); });
  };
  input.onkeydown = event => {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
    if (event.key === 'Escape') { event.preventDefault(); restore(); }
  };
  // 阻止点击输入框冒泡到会话行触发打开
  input.onclick = event => event.stopPropagation();
  input.onblur = () => { if (input.value === currentName) restore(); };
}

/** 切换置顶状态并刷新列表(置顶会话由后端排序置前) */
async function togglePinSession(id, pinned) {
  await api('/api/workspace/session/pin', { method: 'POST', body: { id, pinned: !pinned } });
  await refreshSessions();
}

/** 归档对话:在线终端由后端自动终止,成功后从主列表消失 */
async function archiveSession(id) {
  await api('/api/workspace/session/archive', { method: 'POST', body: { id, archived: true } });
  await refreshSessions();
  toast('已归档');
}

export async function removeSession(id) {
  // 删除统一二次确认:单条 × 与归档面板「彻底移除」共用本函数,一处生效;取消不做任何变更(批量删除另有确认)
  if (!confirm('确认从工作台移除该对话?Claude 记录将保留')) return;
  const result = await api('/api/workspace/session/remove', { method: 'POST', body: { id } });
  if (app.activeSession?.id === id) {
    clearTimeout(app.terminalReconnectTimer);
    app.terminalReconnectTimer = null;
    app.terminalReconnectAttempts = 0;
    app.terminalSessionAlive = false;
    app.socket?.close();
    app.socket = null;
    app.activeSession = null;
    app.terminal?.reset();
    $('#terminalEmpty').hidden = false;
    $('#terminalState').textContent = '已从工作台移除；Claude 原始记录保留';
    $('#terminalLed').classList.remove('live');
    $('#closeSession').disabled = true;
    $('#stopSession').disabled = true;
  }
  await refreshSessions();
  // 归档面板打开时同步重拉,面板中被移除的行立即消失
  if (!$('#archivePanel').hidden) await renderArchivePanel();
  toast(result.transcriptPreserved ? '已从工作台移除，Claude 对话记录保留' : '这条对话已不在工作台列表中');
}

/** 收起「⋯」更多菜单 */
function closeMoreMenu() {
  $('#moreMenu').hidden = true;
  $('#moreToggle').classList.remove('is-open');
}

/** 切换「⋯」更多菜单:批量管理与查看归档入口收进菜单,搜索与刷新保持常显 */
function toggleMoreMenu() {
  const menu = $('#moreMenu');
  if (!menu.hidden) return closeMoreMenu();
  menu.hidden = false;
  $('#moreToggle').classList.add('is-open');
}

// 「⋯」更多菜单:点击项执行后收起,点击外部或 Esc 收起(交互模式同文件树右键菜单)
$('#moreToggle').addEventListener('click', toggleMoreMenu);
$('#moreBulk').addEventListener('click', () => { closeMoreMenu(); enterBulkMode(); });
$('#moreArchive').addEventListener('click', () => { closeMoreMenu(); toggleArchivePanel(); });
document.addEventListener('click', event => {
  const menu = $('#moreMenu');
  // moreToggle 不在菜单内,需显式排除,否则展开它的那次点击会立即触发外点收起
  if (!menu.hidden && !menu.contains(event.target) && !$('#moreToggle').contains(event.target)) closeMoreMenu();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMoreMenu(); });

// 搜索框输入即时过滤:数据已在内存缓存,直接重渲染,不发请求(脚本于 body 末尾加载,DOM 已就绪,模式同 state.mjs)
$('#sessionSearch').addEventListener('input', event => {
  app.sessionSearch = event.target.value;
  renderSessions();
});

// 批量管理:入口在「⋯」菜单(#moreBulk),操作栏全选/删除/退出
$('#bulkSelectAll').addEventListener('click', toggleBulkSelectAll);
$('#bulkDelete').addEventListener('click', () => { removeBulkSelected(); });
$('#bulkExit').addEventListener('click', exitBulkMode);

