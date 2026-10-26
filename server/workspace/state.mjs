import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE_FILE } from '../core/paths.mjs';
import { atomicJson, safeReadJson } from '../core/storage.mjs';

// 模块级可变引用:测试可重定向到临时文件,生产仍指向真实工作区数据文件;
// ESM 导出为活动绑定,依赖方(如 sessions.mjs)读到的始终是最新值
export let workspaceFile = WORKSPACE_FILE;

/** 仅供测试重定向工作区数据文件;生产代码不得调用 */
export function setWorkspaceFileForTest(file) { workspaceFile = file; }

export function workspaceSessionName(session) {
  const folderName = path.basename(String(session.projectPath || '').replace(/[\\/]+$/, '')) || '未命名项目';
  const date = new Date(session.createdAt || Date.now());
  const stamp = Number.isNaN(date.getTime()) ? new Date().toLocaleString('zh-CN', { hour12: false }) : date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  return `${folderName} · ${stamp}`;
}

/** 规范化会话条目可选字段:customName 仅保留 string,pinned/archived 仅在为 true 时保留,旧数据零迁移 */
function normalizeSessionFields(session) {
  const { customName, pinned, archived, ...rest } = session;
  return {
    ...rest,
    ...(typeof customName === 'string' ? { customName } : {}),
    ...(pinned === true ? { pinned: true } : {}),
    ...(archived === true ? { archived: true } : {}),
  };
}

/** 会话显示名:自定义名(非空)优先,其次持久化名,最后实时推导自动名 */
export function sessionDisplayName(session) {
  return session.customName?.trim() || session.name || workspaceSessionName(session);
}

export function workspaceState() {
  const saved = safeReadJson(workspaceFile, {});
  const sessions = Array.isArray(saved.sessions) ? saved.sessions : [];
  const projects = Array.isArray(saved.projects) ? saved.projects : [];
  const hiddenProjects = [...new Set((Array.isArray(saved.hiddenProjects) ? saved.hiddenProjects : []).filter(x => typeof x === 'string' && path.isAbsolute(x)))];
  const hiddenKeys = new Set(hiddenProjects.map(x => path.resolve(x).toLowerCase()));
  let changed = false;
  const namedSessions = sessions.map(session => {
    let next = session;
    if (['新对话', '继续最近对话', ''].includes(String(session.name || '').trim())) {
      changed = true;
      next = { ...session, name: workspaceSessionName(session) };
    }
    return normalizeSessionFields(next);
  });
  const knownProjects = new Map(projects.filter(x => x?.path).map(x => [path.resolve(x.path).toLowerCase(), x]));
  for (const session of namedSessions) {
    if (!session.projectPath) continue;
    const key = path.resolve(session.projectPath).toLowerCase();
    if (!knownProjects.has(key) && !hiddenKeys.has(key)) {
      knownProjects.set(key, { path: session.projectPath, addedAt: session.createdAt || new Date().toISOString(), lastUsedAt: session.lastUsedAt || session.createdAt || new Date().toISOString() });
      changed = true;
    }
  }
  const allProjects = [...knownProjects.values()];
  const savedProjects = allProjects.filter(x => !hiddenKeys.has(path.resolve(x.path).toLowerCase()));
  if (changed || !Array.isArray(saved.projects) || !Array.isArray(saved.hiddenProjects)) atomicJson(workspaceFile, { ...saved, projects: allProjects, hiddenProjects, sessions: namedSessions });
  return { projects: savedProjects, hiddenProjects, sessions: namedSessions };
}

export function safeWorkspaceRoot(value) {
  const candidate = String(value || '').trim();
  if (!candidate || !path.isAbsolute(candidate)) throw new Error('请选择有效的项目文件夹');
  let real;
  try { real = fs.realpathSync(candidate); } catch { throw new Error('项目文件夹不存在或无法读取'); }
  if (!fs.statSync(real).isDirectory()) throw new Error('所选路径不是文件夹');
  return real;
}

export function recordWorkspaceProject(value, at = new Date().toISOString()) {
  const projectPath = safeWorkspaceRoot(value);
  const saved = workspaceState();
  const key = projectPath.toLowerCase();
  const existing = saved.projects.find(x => path.resolve(x.path).toLowerCase() === key);
  const projects = existing
    ? saved.projects.map(x => path.resolve(x.path).toLowerCase() === key ? { ...x, lastUsedAt: at } : x)
    : [{ path: projectPath, addedAt: at, lastUsedAt: at }, ...saved.projects];
  const hiddenProjects = saved.hiddenProjects.filter(x => path.resolve(x).toLowerCase() !== key);
  atomicJson(workspaceFile, { projects, hiddenProjects, sessions: saved.sessions });
  return projectPath;
}

export function hideWorkspaceProject(value) {
  const candidate = String(value || '').trim();
  if (!candidate || !path.isAbsolute(candidate)) throw new Error('项目文件夹路径无效');
  const key = path.resolve(candidate).toLowerCase();
  const saved = workspaceState();
  const known = saved.projects.find(x => path.resolve(x.path).toLowerCase() === key)
    || saved.sessions.find(x => path.resolve(x.projectPath).toLowerCase() === key);
  if (!known) return { hidden: false };
  const projectPath = known.path || known.projectPath;
  const projects = saved.projects.filter(x => path.resolve(x.path).toLowerCase() !== key);
  const hiddenProjects = [...new Map([...saved.hiddenProjects, projectPath].map(x => [path.resolve(x).toLowerCase(), x])).values()];
  atomicJson(workspaceFile, { projects, hiddenProjects, sessions: saved.sessions });
  return { hidden: true };
}

export function listWorkspaceProjects() {
  const saved = workspaceState();
  return saved.projects.map(project => {
    const sessions = saved.sessions.filter(x => path.resolve(x.projectPath).toLowerCase() === path.resolve(project.path).toLowerCase());
    const lastUsedAt = sessions.reduce((latest, session) => String(session.lastUsedAt || session.createdAt) > String(latest) ? (session.lastUsedAt || session.createdAt) : latest, project.lastUsedAt || project.addedAt || '');
    return { path: project.path, name: path.basename(project.path), lastUsedAt, sessionCount: sessions.length };
  }).sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)));
}
