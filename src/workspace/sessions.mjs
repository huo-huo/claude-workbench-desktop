import { $, escapeHtml } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';
import { projectName, sessionGroupKey, readCollapsedProjects, writeCollapsedProjects, updateTerminalEmptyState } from './preferences.mjs';
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


export async function refreshSessions() {
  const result = await api('/api/workspace/sessions');
  const sessions = result.sessions || [];
  syncSessionActivityMonitors(sessions);
  const currentProjectKey = sessionGroupKey(app.projectPath);
  app.projectSessions = sessions.filter(item => sessionGroupKey(item.projectPath) === currentProjectKey);
  updateTerminalEmptyState();
  // 按项目目录分组渲染；折叠状态与分组 key 共用 sessionGroupKey 结果
  const groups = groupSessionsByProject(sessions);
  const collapsedKeys = readCollapsedProjects();
  $('#sessionList').innerHTML = groups.length ? groups.map(group => sessionGroupMarkup(group, collapsedKeys)).join('') : '<div class="empty">还没有对话。选择项目文件夹后新建一个。</div>';
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
  toast(result.transcriptPreserved ? '已从工作台移除，Claude 对话记录保留' : '这条对话已不在工作台列表中');
}

