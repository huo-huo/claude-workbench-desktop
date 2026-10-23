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

