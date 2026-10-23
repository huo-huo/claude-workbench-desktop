import path from 'node:path';
import { WORKSPACE_FILE } from '../core/paths.mjs';
import { atomicJson } from '../core/storage.mjs';
import { workspaceTerminals } from '../terminal/sessions.mjs';
import { safeWorkspaceRoot, workspaceState } from './state.mjs';

export function listWorkspaceSessions(root = '') {
  const project = root ? safeWorkspaceRoot(root) : '';
  return workspaceState().sessions
    .filter(x => !project || path.resolve(x.projectPath).toLowerCase() === project.toLowerCase())
    .map(x => ({ ...x, status: workspaceTerminals.has(x.id) ? 'running' : 'stopped' }))
    .sort((a, b) => String(b.lastUsedAt).localeCompare(String(a.lastUsedAt)));
}

export function removeWorkspaceSession(id) {
  const saved = workspaceState();
  const session = saved.sessions.find(x => x.id === String(id || ''));
  if (!session) return { removed: false, transcriptPreserved: true };
  const terminal = workspaceTerminals.get(session.id);
  if (terminal) {
    try { terminal.proc.write('\u0003'); } catch {}
    const timer = setTimeout(() => {
      if (workspaceTerminals.has(session.id)) {
        try { terminal.proc.kill(); } catch {}
        workspaceTerminals.delete(session.id);
      }
    }, 1800);
    timer.unref?.();
  }
  atomicJson(WORKSPACE_FILE, { ...saved, sessions: saved.sessions.filter(x => x.id !== session.id) });
  return { removed: true, transcriptPreserved: true };
}
