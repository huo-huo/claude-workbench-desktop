import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { $ } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app, keys } from './state.mjs';
import { projectName, updateProjectLabels } from './preferences.mjs';
import { terminalThemes } from './theme.mjs';
import { refreshProjects } from './projects.mjs';
import { refreshTree } from './files.mjs';
import { refreshSessions } from './sessions.mjs';
import { refreshStatusline } from './statusline.mjs';

export function ensureTerminal() {
  if (app.terminal) return;
  app.terminal = new Terminal({
    cursorBlink: false,
    cursorStyle: 'bar',
    cursorInactiveStyle: 'none',
    fontSize: app.terminalFontSize,
    lineHeight: 1.2,
    fontFamily: 'Cascadia Code, Cascadia Mono, Consolas, "Courier New", monospace',
    scrollback: 5000,
    // ConPTY emits VT line feeds that intentionally preserve the cursor column.
    // Adding a carriage return moves redraw fragments left and leaves stale cells.
    convertEol: false,
    theme: terminalThemes[app.workspaceDark ? 'dark' : 'light'],
  });
  app.fitAddon = new FitAddon();
  app.terminal.loadAddon(app.fitAddon);
  app.terminal.open(app.terminalHost);
  app.terminal.onData(data => { if (app.socket?.readyState === WebSocket.OPEN) app.socket.send(JSON.stringify({ type: 'input', data })); });
  let lastWheelAt = 0;
  let lastWheelDirection = 0;
  app.terminalHost.addEventListener('wheel', event => {
    if (event.ctrlKey || !event.deltaY || app.socket?.readyState !== WebSocket.OPEN
      || !app.terminalSessionAlive || app.terminal.modes.mouseTrackingMode === 'none') return;
    // Claude's fullscreen conversation owns its history; xterm's scrollback can
    // be empty. Use its supported paging input rather than scrolling that empty
    // buffer or relying on mouse reports through Windows ConPTY.
    event.preventDefault();
    event.stopImmediatePropagation();
    const direction = Math.sign(event.deltaY);
    const now = performance.now();
    if (direction === lastWheelDirection && now - lastWheelAt < 90) return;
    lastWheelAt = now;
    lastWheelDirection = direction;
    app.terminal.input(direction < 0 ? '\u001b[5~' : '\u001b[6~');
  }, { capture: true, passive: false });
  app.terminal.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown' || !/Windows/i.test(navigator.userAgent)) return true;
    const key = event.key.toLowerCase();
    const ctrlV = event.ctrlKey && !event.altKey && !event.shiftKey && key === 'v';
    const altV = event.altKey && !event.ctrlKey && !event.shiftKey && key === 'v';
    if (!ctrlV && !altV) return true;
    event.preventDefault();
    pasteClipboardToTerminal(altV ? 'alt' : 'ctrl').catch(error => {
      const controlV = altV ? '\u001bv' : '\u0016';
      if (app.socket?.readyState === WebSocket.OPEN) app.socket.send(JSON.stringify({ type: 'input', data: controlV }));
      toast(`${error.message}；已把按键交给 Claude Code`);
    });
    return false;
  });
  const allowTerminalDrop = event => {
    // WebView2 can report custom MIME types differently from Chromium and will
    // keep the pointer in its forbidden state unless dragenter is also accepted.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  app.terminalHost.addEventListener('dragenter', allowTerminalDrop, true);
  app.terminalHost.addEventListener('dragover', allowTerminalDrop, true);
  app.terminalHost.addEventListener('drop', event => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const absolute = transfer.getData('application/x-claude-workbench-file');
    const filePaths = absolute ? [] : [...(transfer.files || [])].map(file => file.path).filter(Boolean);
    const value = absolute ? quoteWindowsPath(absolute) : (filePaths.length ? filePaths.map(quoteWindowsPath).join(' ') : transfer.getData('text/plain'));
    event.preventDefault();
    event.stopPropagation();
    if (!value || !app.terminal) {
      toast('没有读到文件路径；请从右侧文件列表中的文件行拖入终端');
      return;
    }
    app.terminal.paste(value);
    app.terminal.focus();
    toast('文件路径已放入 CLI 输入框，按 Enter 发送');
  }, true);
  const observer = new ResizeObserver(() => fitTerminal());
  observer.observe(app.terminalHost);
  window.addEventListener('resize', () => fitTerminal());
  window.addEventListener('focus', () => requestAnimationFrame(() => fitTerminal()));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestAnimationFrame(() => fitTerminal());
  });
  fitTerminal();
}

export function suppressCursorVisibility(data) {
  const hideCursor = '\u001b[?25l';
  const combined = app.terminalCursorVisibilityPending + String(data || '');
  app.terminalCursorVisibilityPending = '';

  const sequenceStart = combined.lastIndexOf('\u001b[?');
  if (sequenceStart >= 0) {
    const trailingSequence = combined.slice(sequenceStart);
    if (trailingSequence.length <= 32 && /^\u001b\[\?[0-9;]*$/.test(trailingSequence)) {
      app.terminalCursorVisibilityPending = trailingSequence;
      return combined.slice(0, sequenceStart);
    }
  }

  return combined.replace(/\u001b\[\?([0-9;]*)h/g, (sequence, parameters) => {
    const modes = parameters.split(';');
    if (!modes.includes('25')) return sequence;
    const remainingModes = modes.filter(mode => mode !== '25');
    const otherModes = remainingModes.length ? '\u001b[?' + remainingModes.join(';') + 'h' : '';
    return otherModes + hideCursor;
  });
}

export function quoteWindowsPath(value) {
  const path = String(value || '').replace(/[\r\n]/g, '');
  return /\s/.test(path) ? `"${path.replaceAll('"', '\\"')}"` : path;
}

export async function pasteClipboardToTerminal(shortcut) {
  if (!app.activeSession || app.socket?.readyState !== WebSocket.OPEN || !app.terminal) throw new Error('请先打开一段对话');
  const targetSocket = app.socket;
  const targetSessionId = app.activeSession.id;
  const payload = await api('/api/workspace/clipboard', { method: 'POST', body: {} });
  if (app.socket !== targetSocket || app.activeSession?.id !== targetSessionId) return;
  if (payload.image) {
    if (payload.imagePath) {
      // WebView2 terminals cannot pass bitmap clipboard data through xterm as an image object.
      app.terminal.paste(`@${payload.imagePath}`);
      toast('图片已作为文件引用放入提示词；按 Enter 提交后 Claude 会读取图片');
    }
    else {
      const data = shortcut === 'alt' ? '\u001bv' : '\u0016';
      targetSocket.send(JSON.stringify({ type: 'input', data }));
    }
    app.terminal.focus();
    return;
  }
  if (shortcut === 'alt') {
    targetSocket.send(JSON.stringify({ type: 'input', data: '\u001bv' }));
    app.terminal.focus();
    return;
  }
  const files = Array.isArray(payload.files) ? payload.files.map(quoteWindowsPath).filter(Boolean) : [];
  const text = files.length ? files.join(' ') : String(payload.text || '');
  if (text) app.terminal.paste(text);
  app.terminal.focus();
}

export function fitTerminal() {
  if (!app.fitAddon || app.workspace.hidden) return;
  try {
    app.fitAddon.fit();
    const size = `${app.terminal.cols}x${app.terminal.rows}`;
    if (app.socket?.readyState === WebSocket.OPEN && size !== app.lastTerminalPtySize) {
      app.socket.send(JSON.stringify({ type: 'resize', cols: app.terminal.cols, rows: app.terminal.rows }));
      app.lastTerminalPtySize = size;
    }
  } catch {}
}

export function scheduleTerminalReconnect(session) {
  if (app.terminalReconnectTimer || !app.terminalSessionAlive || app.activeSession?.id !== session.id) return;
  app.terminalReconnectAttempts += 1;
  const delay = Math.min(1000 * (2 ** Math.min(app.terminalReconnectAttempts - 1, 4)), 15000);
  $('#terminalState').textContent = `连接断开，${Math.ceil(delay / 1000)} 秒后重试`;
  $('#terminalLed').classList.remove('live');
  app.terminalReconnectTimer = setTimeout(() => {
    app.terminalReconnectTimer = null;
    if (app.terminalSessionAlive && app.activeSession?.id === session.id) connectTerminal(session, { reconnecting: true });
  }, delay);
}

export function connectTerminal(session, { reconnecting = false } = {}) {
  clearTimeout(app.terminalReconnectTimer);
  app.terminalReconnectTimer = null;
  if (!reconnecting) app.terminalReconnectAttempts = 0;
  ensureTerminal();
  app.activeSession = session;
  app.terminalSessionAlive = true;
  const generation = ++app.terminalConnectionGeneration;
  app.lastTerminalPtySize = '';
  if (!reconnecting) {
    app.projectPath = session.projectPath;
    localStorage.setItem(keys.projectPath, app.projectPath);
    updateProjectLabels();
    refreshProjects().catch(() => {});
    refreshTree().catch(error => toast(error.message));
    refreshStatusline().catch(() => {});
  }
  app.terminal.reset();
  app.terminalCursorVisibilityPending = '';
  app.terminal.write('\u001b[?25l');
  $('#terminalEmpty').hidden = true;
  $('#terminalTitle').textContent = projectName(session.projectPath);
  $('#terminalSubtitle').textContent = session.projectPath;
  $('#terminalState').textContent = reconnecting ? '正在重新连接…' : '连接中…';
  $('#terminalLed').classList.remove('live');
  $('#closeSession').disabled = false;
  $('#stopSession').disabled = false;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const endpoint = `${protocol}//${location.host}/api/workspace/terminal?session=${encodeURIComponent(session.id)}`;
  app.socket?.close();
  const connection = new WebSocket(endpoint);
  app.socket = connection;
  connection.onopen = () => {
    if (generation !== app.terminalConnectionGeneration || app.socket !== connection) return;
    fitTerminal();
    app.terminal.focus();
  };
  connection.onmessage = event => {
    if (generation !== app.terminalConnectionGeneration || app.socket !== connection || app.activeSession?.id !== session.id) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'ready') {
      app.terminal.write(suppressCursorVisibility(message.data), () => {
        if (generation !== app.terminalConnectionGeneration || app.socket !== connection
          || connection.readyState !== WebSocket.OPEN || message.status !== 'running') return;
        // The server replays a bounded raw ANSI tail, which may begin mid-frame.
        // Ctrl+L asks Claude to redraw the complete screen, preserving the draft.
        if (app.terminal.modes.mouseTrackingMode !== 'none') app.terminal.input('\u000c');
      });
      app.terminalSessionAlive = message.status === 'running';
      if (app.terminalSessionAlive) {
        app.terminalReconnectAttempts = 0;
        $('#terminalState').textContent = '运行中';
        $('#terminalLed').classList.add('live');
      } else {
        $('#terminalState').textContent = 'Claude 会话已结束';
        $('#terminalLed').classList.remove('live');
        $('#stopSession').disabled = true;
      }
    } else if (message.type === 'data') app.terminal.write(suppressCursorVisibility(message.data));
    else if (message.type === 'exit') {
      app.terminalSessionAlive = false;
      clearTimeout(app.terminalReconnectTimer);
      app.terminalReconnectTimer = null;
      $('#terminalState').textContent = `已结束（${message.exitCode ?? '—'}）`;
      $('#terminalLed').classList.remove('live');
      $('#stopSession').disabled = true;
      refreshSessions().catch(() => {});
    }
  };
  connection.onerror = () => {
    if (generation === app.terminalConnectionGeneration && app.socket === connection && app.activeSession?.id === session.id) {
      $('#terminalState').textContent = '终端连接异常，正在恢复…';
    }
  };
  connection.onclose = () => {
    if (generation !== app.terminalConnectionGeneration || app.socket !== connection || app.activeSession?.id !== session.id) return;
    if (app.terminalSessionAlive) scheduleTerminalReconnect(session);
    else $('#terminalState').textContent = 'Claude 会话已结束';
  };
  refreshSessions().catch(() => {});
}

