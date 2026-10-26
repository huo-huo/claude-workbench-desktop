import { Terminal } from '@xterm/xterm';
import { escapeHtml } from './core/dom.mjs';
import { api } from './core/api.mjs';
import { app } from './state.mjs';
import { formatSessionTime } from './preferences.mjs';

// 同时监控的会话活动上限
const maxSessionActivityMonitors = 20;

export function sessionActivityFor(session) {
  if (session.status !== 'running') return 'stopped';
  return app.sessionActivityStates.get(session.id) || 'online';
}

export function sessionStatusMarkup(session, activity = sessionActivityFor(session)) {
  if (activity === 'working') {
    return '<span class="session-state is-working" data-session-status="running" data-session-activity="working" title="Claude 当前正在处理任务"><i class="session-spinner" aria-hidden="true"></i><span>工作中</span></span>';
  }
  if (activity === 'online') {
    return '<span class="session-state is-online" data-session-status="running" data-session-activity="online" title="CLI 会话在线，当前没有执行任务"><i class="session-online-dot" aria-hidden="true"></i><span>会话在线</span></span>';
  }
  return '<span class="session-state is-stopped" data-session-status="stopped" data-session-activity="stopped" title="CLI 会话已结束"><span>已结束</span></span>';
}

export function sessionRowMarkup(item) {
  const mode = item.mode === 'continue' ? '继续' : item.mode === 'picker' ? '选择已有' : '新建';
  const pinned = item.pinned === true;
  // 标题用显示名(自定义名优先,回退自动名);时间取最后活动时间;置顶行加 is-pinned 类与标记
  // 行内操作:重命名 ✎ / 置顶 📌(title 随状态切换)/ 归档 📦,与移除按钮一样由 refreshSessions 绑定
  return `<div class="session-item${pinned ? ' is-pinned' : ''}" data-session-pinned="${pinned}"><button class="session-row ${app.activeSession?.id === item.id ? 'active' : ''}" data-session-id="${escapeHtml(item.id)}" title="${escapeHtml(item.displayName || item.name)}"><span class="session-row-title">${pinned ? '<span class="pin-mark" title="已置顶">📌</span>' : ''}<strong>${escapeHtml(item.displayName || item.name)}</strong>${sessionStatusMarkup(item)}</span><small><span class="session-row-detail">${escapeHtml(formatSessionTime(item.lastUsedAt || item.createdAt))} · ${mode}</span></small></button><span class="session-ops"><button class="session-op" data-rename-session="${escapeHtml(item.id)}" title="重命名" aria-label="重命名对话">✎</button><button class="session-op" data-pin-session="${escapeHtml(item.id)}" title="${pinned ? '取消置顶' : '置顶'}" aria-label="${pinned ? '取消置顶对话' : '置顶对话'}">📌</button><button class="session-op" data-archive-session="${escapeHtml(item.id)}" title="归档" aria-label="归档对话">📦</button></span><button class="session-remove" data-remove-session="${escapeHtml(item.id)}" title="从工作台移除；Claude 对话记录保留" aria-label="从工作台移除">×</button></div>`;
}

export async function refreshSessionStatuses() {
  const result = await api('/api/workspace/sessions');
  const sessions = result.sessions || [];
  syncSessionActivityMonitors(sessions);
  const sessionById = new Map(sessions.map(item => [item.id, item]));
  document.querySelectorAll('[data-session-id]').forEach(button => {
    const session = sessionById.get(button.dataset.sessionId);
    const current = button.querySelector('[data-session-status]');
    if (!session || !current) return;
    const activity = sessionActivityFor(session);
    if (current.dataset.sessionActivity === activity) return;
    current.outerHTML = sessionStatusMarkup(session, activity);
  });
}

export function updateSessionActivity(sessionId, activity) {
  app.sessionActivityStates.set(sessionId, activity);
  const row = [...document.querySelectorAll('[data-session-id]')].find(button => button.dataset.sessionId === sessionId);
  const current = row?.querySelector('[data-session-status]');
  if (current && current.dataset.sessionActivity !== activity) {
    current.outerHTML = sessionStatusMarkup({ id: sessionId, status: activity === 'stopped' ? 'exited' : 'running' }, activity);
  }
}

export function activityFromTerminal(screen) {
  const buffer = screen.buffer.active;
  for (let row = 0; row < screen.rows; row += 1) {
    const text = buffer.getLine(buffer.baseY + row)?.translateToString(true) || '';
    // Read the current VT screen, not raw chunks containing old frames or
    // cursor-only updates. Claude keeps its task spinner visible while busy.
    if (/^\s*[✢✳✶✻✽✸✹✺✷✼✦✧*·]\s*[A-Za-z][A-Za-z -]{0,64}(?:…|\.{3})\s*\(/.test(text)
      || /\besc to interrupt\b/i.test(text)) return 'working';
  }
  return 'online';
}

export function closeSessionActivityMonitors() {
  for (const [sessionId, monitor] of app.sessionActivityMonitors) {
    app.sessionActivityMonitors.delete(sessionId);
    monitor.connection.onclose = null;
    monitor.connection.close();
    monitor.screen.dispose();
  }
}

export function syncSessionActivityMonitors(sessions) {
  if (app.workspace.hidden) {
    closeSessionActivityMonitors();
    return;
  }
  const runningSessions = (sessions || []).filter(session => session.status === 'running').slice(0, maxSessionActivityMonitors);
  const runningIds = new Set(runningSessions.map(session => session.id));
  for (const [sessionId, monitor] of app.sessionActivityMonitors) {
    if (runningIds.has(sessionId)) continue;
    app.sessionActivityMonitors.delete(sessionId);
    app.sessionActivityStates.delete(sessionId);
    monitor.connection.onclose = null;
    monitor.connection.close();
    monitor.screen.dispose();
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const session of runningSessions) {
    if (app.sessionActivityMonitors.has(session.id)) continue;
    const connection = new WebSocket(`${protocol}//${location.host}/api/workspace/terminal?session=${encodeURIComponent(session.id)}`);
    // A parser-only app.terminal needs no DOM and never resizes the real PTY.
    // Use the server's maximum dimensions so cursor-addressed frames fit.
    const screen = new Terminal({ cols: 300, rows: 120, scrollback: 0, convertEol: false });
    const monitor = { connection, screen, exited: false };
    app.sessionActivityMonitors.set(session.id, monitor);
    connection.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'ready' || message.type === 'data') {
        if (message.type === 'ready') monitor.exited = message.status !== 'running';
        screen.write(String(message.data || ''), () => {
          if (app.sessionActivityMonitors.get(session.id) !== monitor) return;
          updateSessionActivity(session.id, monitor.exited ? 'stopped' : activityFromTerminal(screen));
        });
      } else if (message.type === 'exit') {
        monitor.exited = true;
        updateSessionActivity(session.id, 'stopped');
      }
    };
    connection.onclose = () => {
      if (app.sessionActivityMonitors.get(session.id) !== monitor) return;
      app.sessionActivityMonitors.delete(session.id);
      screen.dispose();
    };
    connection.onerror = () => connection.close();
  }
}
