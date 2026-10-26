import crypto from 'node:crypto';
import path from 'node:path';
import pty from 'node-pty';
import { WebSocket, WebSocketServer } from 'ws';
import { WORKSPACE_FILE } from '../core/paths.mjs';
import { atomicJson } from '../core/storage.mjs';
import { claudeInstallInfo } from '../platform/claude.mjs';
import { recordWorkspaceProject, workspaceSessionName, workspaceState } from '../workspace/state.mjs';

// 终端进程与 WebSocket 单例
export const workspaceTerminals = new Map();

/**
 * 从继承环境中剥离 Claude Code 会话标记：工作台服务端可能运行在某个 Claude Code
 * 会话内部（其环境含 CLAUDE_CODE_CHILD_SESSION 等标记），直接继承会让工作台开的
 * claude 被误判为子会话而关闭 transcript 保存，statusLine 的会话数据也随之失效。
 */
export function sanitizeInheritedEnv(env) {
  const clean = { ...env };
  for (const key of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) {
    delete clean[key];
  }
  return clean;
}
export const workspaceWs = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
export const workspaceHeartbeat = setInterval(() => {
  for (const client of workspaceWs.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    try { client.ping(); } catch { client.terminate(); }
  }
}, 30000);
workspaceHeartbeat.unref?.();

export function createWorkspaceSession(body) {
  const projectPath = recordWorkspaceProject(body.projectPath);
  const mode = ['new', 'continue', 'resume', 'picker'].includes(body.mode) ? body.mode : 'new';
  const saved = workspaceState();
  const existingId = String(body.workbenchSessionId || '');
  const existing = existingId ? saved.sessions.find(x => x.id === existingId) : null;
  if (existingId && !existing) throw new Error('这条对话已不在工作台列表中');
  if (existing && path.resolve(existing.projectPath).toLowerCase() !== projectPath.toLowerCase()) throw new Error('对话所属项目与当前项目不一致');
  if (existing && workspaceTerminals.has(existing.id)) {
    return { ...existing, status: 'running', terminalUrl: `/api/workspace/terminal?session=${encodeURIComponent(existing.id)}` };
  }
  const info = claudeInstallInfo();
  if (!info.executable) throw new Error('没有找到 Claude Code CLI，请先安装 Claude Code');
  const appSessionId = existing?.id || crypto.randomUUID();
  const sessionId = mode === 'new' ? crypto.randomUUID() : mode === 'resume' ? String(body.sessionId || existing?.sessionId || '') : '';
  if (mode === 'resume' && !/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('会话 ID 无效');
  const args = mode === 'new' ? ['--session-id', sessionId] : mode === 'continue' ? ['--continue'] : mode === 'picker' ? ['--resume'] : ['--resume', sessionId];
  const proc = pty.spawn(info.executable, args, {
    name: 'xterm-256color', cols: 112, rows: 32, cwd: projectPath,
    env: sanitizeInheritedEnv({ ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' }),
  });
  const now = new Date().toISOString();
  const record = existing ? {
    ...existing, id: appSessionId, sessionId, projectPath, lastUsedAt: now, status: 'running', exitCode: undefined,
  } : {
    id: appSessionId, sessionId, mode, projectPath,
    name: String(body.name && !['新对话', '继续最近对话'].includes(String(body.name).trim())
      ? body.name
      : workspaceSessionName({ projectPath, createdAt: now })).trim().slice(0, 100),
    createdAt: now, lastUsedAt: now, status: 'running',
  };
  saved.sessions = [record, ...saved.sessions.filter(x => x.id !== record.id)].slice(0, 300);
  atomicJson(WORKSPACE_FILE, saved);
  const terminal = { ...record, proc, clients: new Set(), outputTail: '' };
  workspaceTerminals.set(appSessionId, terminal);
  proc.onData(data => {
    terminal.outputTail = (terminal.outputTail + data).slice(-24000);
    for (const client of terminal.clients) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'data', data }));
  });
  proc.onExit(({ exitCode }) => {
    terminal.status = 'exited';
    const current = workspaceState();
    const entry = current.sessions.find(x => x.id === appSessionId);
    if (entry) { entry.status = 'exited'; entry.exitCode = exitCode; entry.lastUsedAt = new Date().toISOString(); atomicJson(WORKSPACE_FILE, current); }
    for (const client of terminal.clients) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'exit', exitCode }));
    workspaceTerminals.delete(appSessionId);
  });
  return { ...record, terminalUrl: `/api/workspace/terminal?session=${encodeURIComponent(appSessionId)}` };
}

/** 处理 /api/workspace/terminal 的 WebSocket 升级；终端不存在时销毁连接 */
export function handleTerminalUpgrade(req, socket, head, url) {
  const terminal = workspaceTerminals.get(url.searchParams.get('session') || '');
  if (!terminal) return socket.destroy();
  workspaceWs.handleUpgrade(req, socket, head, ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    terminal.clients.add(ws);
    ws.send(JSON.stringify({ type: 'ready', data: terminal.outputTail, status: terminal.status }));
    ws.on('message', payload => {
      try {
        const message = JSON.parse(payload.toString());
        if (message.type === 'input' && typeof message.data === 'string') terminal.proc.write(message.data);
        else if (message.type === 'resize') {
          const cols = Math.max(20, Math.min(300, Number(message.cols) || 112));
          const rows = Math.max(5, Math.min(120, Number(message.rows) || 32));
          terminal.proc.resize(cols, rows);
        }
      } catch {}
    });
    ws.on('close', () => terminal.clients.delete(ws));
    ws.on('error', () => terminal.clients.delete(ws));
  });
}
