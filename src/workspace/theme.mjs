import { $ } from './core/dom.mjs';
import { app } from './state.mjs';
import { fitTerminal } from './terminal.mjs';

// 终端配色：深色沿用原有配色，浅色使用浅底深字，跟随全局主题
export const terminalThemes = {
  // 两套主题都补齐 ANSI 16 色，避免 xterm 回退到默认白色在浅底上不可见
  dark: {
    background: '#000000', foreground: '#d4d4d4', cursor: '#f2f2f2', selectionBackground: '#5a5a5a88',
    black: '#000000', red: '#f44747', green: '#6a9955', yellow: '#d7ba7d', blue: '#569cd6', magenta: '#c678dd', cyan: '#56b6c2', white: '#d4d4d4',
    brightBlack: '#767676', brightRed: '#f48771', brightGreen: '#89d185', brightYellow: '#e5c07b', brightBlue: '#9cdcfe', brightMagenta: '#d7a0ee', brightCyan: '#7fd6e0', brightWhite: '#ffffff',
  },
  light: {
    background: '#fbfaf6', foreground: '#20211e', cursor: '#20211e', selectionBackground: '#d8ed83',
    black: '#20211e', red: '#ad4937', green: '#2d7251', yellow: '#7a5a12', blue: '#2f5f9e', magenta: '#8b3a83', cyan: '#1f6f74', white: '#6e7067',
    brightBlack: '#777970', brightRed: '#c05a48', brightGreen: '#3f8b63', brightYellow: '#946d18', brightBlue: '#3d78bd', brightMagenta: '#a34d97', brightCyan: '#2b8890', brightWhite: '#4f5149',
  },
};

/** 应用全局主题：管理页与工作站共用，同时同步终端配色 */
export function applyWorkspaceTheme() {
  const shell = document.querySelector('.shell');
  app.workspace.classList.toggle('theme-dark', app.workspaceDark);
  // 管理页与工作站共用主题：整个 body 一起切换
  document.body.classList.toggle('theme-dark', app.workspaceDark);
  shell.classList.toggle('workspace-dark', app.workspaceDark && !app.workspace.hidden);
  const button = $('#toggleWorkspaceTheme');
  if (button) {
    button.textContent = app.workspaceDark ? '☀ 浅色' : '◐ 深色';
    button.title = app.workspaceDark ? '切换到浅色模式' : '切换到深色模式';
    button.setAttribute('aria-pressed', String(app.workspaceDark));
  }
  // 终端可能尚未创建；存在时同步配色并重新适配尺寸
  if (app.terminal) {
    app.terminal.options.theme = terminalThemes[app.workspaceDark ? 'dark' : 'light'];
    requestAnimationFrame(() => fitTerminal());
  }
}
