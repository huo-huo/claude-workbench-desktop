import path from 'node:path';
import { atomicJson } from '../core/storage.mjs';
import { workspaceTerminals } from '../terminal/sessions.mjs';
import { safeWorkspaceRoot, sessionDisplayName, workspaceFile, workspaceState } from './state.mjs';

export function listWorkspaceSessions(root = '', options = {}) {
  const project = root ? safeWorkspaceRoot(root) : '';
  return workspaceState().sessions
    .filter(x => !project || path.resolve(x.projectPath).toLowerCase() === project.toLowerCase())
    // 默认只返回未归档条目;archived: true 时只返回归档条目
    .filter(x => options.archived === true ? x.archived === true : x.archived !== true)
    .map(x => ({ ...x, status: workspaceTerminals.has(x.id) ? 'running' : 'stopped', displayName: sessionDisplayName(x) }))
    .sort((a, b) => (Number(b.pinned === true) - Number(a.pinned === true)) || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt)));
}

/** 终止会话的在线终端:先发 Ctrl+C,1.8s 后仍未退出则强杀 */
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

export function removeWorkspaceSession(id) {
  const saved = workspaceState();
  const session = saved.sessions.find(x => x.id === String(id || ''));
  if (!session) return { removed: false, transcriptPreserved: true };
  stopWorkspaceTerminal(session);
  atomicJson(workspaceFile, { ...saved, sessions: saved.sessions.filter(x => x.id !== session.id) });
  return { removed: true, transcriptPreserved: true };
}

/** 按查找会话,找不到抛错(路由层统一转 400) */
function findWorkspaceSession(id) {
  const session = workspaceState().sessions.find(x => x.id === String(id || ''));
  if (!session) throw new Error('找不到该会话');
  return session;
}

/** 更新单个会话的持久化字段并原子写回,返回从文件读回的最新条目 */
function updateWorkspaceSession(id, patch) {
  const saved = workspaceState();
  const session = saved.sessions.find(x => x.id === String(id || ''));
  if (!session) throw new Error('找不到该会话');
  const sessions = saved.sessions.map(x => {
    if (x.id !== session.id) return x;
    const next = { ...x, ...patch };
    // patch 值为 undefined 表示删除该可选字段(如清空自定义名回退自动名)
    for (const key of Object.keys(patch)) if (next[key] === undefined) delete next[key];
    return next;
  });
  atomicJson(workspaceFile, { ...saved, sessions });
  return workspaceState().sessions.find(x => x.id === session.id);
}

/** 重命名会话:customName 去空白后为空则删除字段,回退自动命名 */
export function renameWorkspaceSession(id, customName) {
  const name = String(customName ?? '').trim();
  return updateWorkspaceSession(id, { customName: name || undefined });
}

/** 置顶/取消置顶 */
export function pinWorkspaceSession(id, pinned = true) {
  return updateWorkspaceSession(id, { pinned: pinned !== false ? true : undefined });
}

/** 归档/恢复;归档在线会话时先终止其终端(条目保留,可恢复) */
export function archiveWorkspaceSession(id, archived = true) {
  if (archived !== false) stopWorkspaceTerminal(findWorkspaceSession(id));
  return updateWorkspaceSession(id, { archived: archived !== false ? true : undefined });
}
