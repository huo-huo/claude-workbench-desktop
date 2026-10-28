import { $ } from './core/dom.mjs';
import { toast } from './core/api.mjs';
import { app } from './state.mjs';
import { fitTerminal } from './terminal.mjs';
import { setTerminalFontSize, updateProjectLabels } from './preferences.mjs';
import { refreshProjects, selectProject, hideProjectFromList, closeProjectContextMenu, renderProjects } from './projects.mjs';
import {
  refreshSessions, startSession,
  closeCurrentSession, interruptCurrentSession,
} from './sessions.mjs';
import { closeSessionActivityMonitors, refreshSessionStatuses } from './activity.mjs';
import { refreshTree, runFileTreeContextAction, closeFileTreeContextMenu } from './files.mjs';
import {
  sendComposerToTerminal, toggleComposer, renderComposerAttachments, addComposerImageFiles,
  pasteIntoComposer, handleComposerDrop, autoSizeComposer,
} from './composer.mjs';
import { setupToolbarOverflow } from './toolbar.mjs';
import { matchComposerShortcut } from './shortcuts.mjs';
import {
  openPromptManager, closePromptManager, setPromptManagerTab, analyzePromptDraft, savePromptDraft,
  resetPromptDraft,
} from './prompts.mjs';
import { applyWorkspaceTheme } from './theme.mjs';
import { refreshStatusline, openStatuslineSettings } from './statusline.mjs';
import { saveWorkspaceSettings } from './settings.mjs';

// 启动时先同步 body 主题，避免管理页首屏闪回浅色
document.body.classList.toggle('theme-dark', app.workspaceDark);

/** 切换管理页 / 工作区视图 */
export function setView(view) {
  const isWorkspace = view === 'workspace';
  if (isWorkspace && !app.workspace.hidden) return;
  if (!isWorkspace) closeSessionActivityMonitors();
  if (isWorkspace) app.lastManagementCrumb = $('#crumb').textContent;
  document.body.classList.toggle('view-workspace', isWorkspace);
  document.body.classList.toggle('view-management', !isWorkspace);
  app.workspace.hidden = !isWorkspace;
  $('#page').hidden = isWorkspace;
  applyWorkspaceTheme();
  $('#crumb').textContent = isWorkspace ? '对话工作站' : app.lastManagementCrumb;
  $('#refresh').hidden = isWorkspace;
  $('#scanTime').hidden = isWorkspace;
  $('#workspaceProjectIndicator').style.display = isWorkspace ? 'inline-block' : 'none';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  // 启动时恢复已有视图不重复写入，避免每次启动都发一次无意义的保存
  const viewChanged = app.view !== view;
  app.view = view;
  if (viewChanged) saveWorkspaceSettings({ view });
  if (isWorkspace) {
    updateProjectLabels();
    refreshProjects().then(refreshSessions).then(() => app.projectPath ? refreshTree() : null).catch(error => toast(error.message));
    refreshStatusline().catch(() => {});
    requestAnimationFrame(() => fitTerminal());
  }
}

/** 项目列表与项目菜单绑定 */
function wireProjects() {
  $('#chooseProject').addEventListener('click', selectProject);
  $('#chooseProjectEmpty').addEventListener('click', selectProject);
  $('#toggleMoreProjects').addEventListener('click', () => {
    app.projectsExpanded = !app.projectsExpanded;
    saveWorkspaceSettings({ projectsExpanded: app.projectsExpanded });
    renderProjects();
  });
  $('#hideProjectFromList').addEventListener('click', () => hideProjectFromList().catch(error => toast(error.message)));
}

/** 会话列表、新建与停止绑定 */
function wireSessions() {
  setInterval(() => {
    if (!app.workspace.hidden) {
      refreshSessionStatuses().catch(() => {});
      refreshStatusline().catch(() => {});
    }
  }, 3000);
  $('#openStatuslineSettings').addEventListener('click', () => openStatuslineSettings());
  $('#newSession').addEventListener('click', () => startSession('new'));
  $('#newSessionEmpty').addEventListener('click', () => startSession('new'));
  $('#refreshSessions').addEventListener('click', () => refreshSessions().catch(error => toast(error.message)));
  $('#closeSession').addEventListener('click', closeCurrentSession);
  $('#stopSession').addEventListener('click', interruptCurrentSession);
}

/** 文件树刷新、右键菜单与自动刷新绑定 */
function wireFiles() {
  const refreshVisibleFiles = () => {
    if (document.hidden || app.workspace.hidden || app.workspace.classList.contains('files-collapsed')
      || !app.projectPath || app.fileTreeRefreshJob || app.fileTreeDragging || !$('#fileTreeContextMenu').hidden
      || Date.now() - app.fileTreeInteractionAt < 1500) return;
    refreshTree().catch(() => {});
  };
  setInterval(refreshVisibleFiles, 5000);
  window.addEventListener('focus', refreshVisibleFiles);
  $('#fileTree').addEventListener('pointerdown', () => { app.fileTreeInteractionAt = Date.now(); });
  $('#refreshFiles').addEventListener('click', () => {
    refreshTree().then(() => toast('文件列表已刷新')).catch(error => toast(error.message));
  });
  $('#fileTreeRevealPath').addEventListener('click', () => runFileTreeContextAction('reveal'));
  $('#fileTreeAddToConversation').addEventListener('click', () => runFileTreeContextAction('add'));
  $('#fileTreeCopyPath').addEventListener('click', () => runFileTreeContextAction('copy').catch(error => toast(error.message)));
  $('#fileTreeRecycle').addEventListener('click', () => runFileTreeContextAction('recycle'));
  document.addEventListener('click', event => { if (!$('#projectContextMenu').contains(event.target)) closeProjectContextMenu(); });
  document.addEventListener('click', event => { if (!$('#fileTreeContextMenu').contains(event.target)) closeFileTreeContextMenu(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeProjectContextMenu();
      closeFileTreeContextMenu();
    }
  });
}

/** 终端重绘、中断与字号绑定 */
function wireTerminal() {
  $('#clearTerminal').addEventListener('click', () => {
    if (!app.activeSession || app.socket?.readyState !== WebSocket.OPEN) return toast('当前没有连接中的 Claude 会话');
    app.socket.send(JSON.stringify({ type: 'input', data: '\u000c' }));
    app.terminal?.focus();
    toast('已请求 Claude Code 重绘终端；输入和对话内容会保留');
  });
  $('#terminalZoomOut').addEventListener('click', () => setTerminalFontSize(app.terminalFontSize - 1, fitTerminal));
  $('#terminalZoomIn').addEventListener('click', () => setTerminalFontSize(app.terminalFontSize + 1, fitTerminal));
  $('#terminalZoomLevel').addEventListener('click', () => setTerminalFontSize(12, fitTerminal));
  setTerminalFontSize(app.terminalFontSize, fitTerminal);
  setupToolbarOverflow();
}

/** 输入区、图片附件与拖放绑定 */
function wireComposer() {
  $('#toggleComposer').addEventListener('click', toggleComposer);
  $('#clearComposer').addEventListener('click', () => {
    $('#composerInput').value = '';
    app.composerAttachments = [];
    renderComposerAttachments();
    autoSizeComposer();
    $('#composerInput').focus();
  });
  $('#sendComposer').addEventListener('click', sendComposerToTerminal);
  const composerInput = $('#composerInput');
  const composer = $('#terminalComposer');
  const composerImagePicker = $('#composerImagePicker');
  $('#addComposerImage').addEventListener('click', () => composerImagePicker.click());
  composerImagePicker.addEventListener('change', () => {
    addComposerImageFiles(composerImagePicker.files).catch(error => toast(error.message));
    composerImagePicker.value = '';
  });
  composerInput.addEventListener('paste', event => { pasteIntoComposer(event).catch(error => toast(error.message)); });
  composerInput.addEventListener('input', autoSizeComposer);
  composerInput.addEventListener('keydown', event => {
    const shortcut = matchComposerShortcut(event);
    if (shortcut === 'send') {
      event.preventDefault();
      sendComposerToTerminal();
    } else if (shortcut === 'focus-terminal') {
      event.preventDefault();
      // 终端尚未初始化时（无活动会话）至少让输入区失焦
      if (app.terminal) app.terminal.focus();
      else composerInput.blur();
    }
  });
  // 文档级 Ctrl+`：焦点在终端内时交给 xterm，避免抢占终端按键
  document.addEventListener('keydown', event => {
    if (!$('#promptManagerBackdrop').hidden) return;
    const inTerminal = $('#terminalHost').contains(document.activeElement);
    if (matchComposerShortcut(event, { inTerminal }) !== 'toggle-composer') return;
    event.preventDefault();
    toggleComposer();
  });
  composer.addEventListener('dragenter', event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    composer.classList.add('is-dragging');
  });
  composer.addEventListener('dragover', event => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    composer.classList.add('is-dragging');
  });
  composer.addEventListener('dragleave', event => {
    if (!composer.contains(event.relatedTarget)) composer.classList.remove('is-dragging');
  });
  composer.addEventListener('drop', handleComposerDrop);
}

/** 提示词库面板绑定 */
function wirePrompts() {
  $('#openPromptManager').addEventListener('click', openPromptManager);
  $('#closePromptManager').addEventListener('click', closePromptManager);
  $('#promptManagerBackdrop').addEventListener('click', event => {
    if (event.target === $('#promptManagerBackdrop')) closePromptManager();
  });
  document.querySelectorAll('[data-prompt-tab]').forEach(button => button.addEventListener('click', () => setPromptManagerTab(button.dataset.promptTab)));
  $('#promptUseTerminalSelection').addEventListener('click', () => {
    const selected = app.terminal?.getSelection()?.trim() || '';
    if (!selected) return toast('先用鼠标在 CLI 里选中一段文字');
    $('#promptSourceContent').value = selected;
    $('#promptSourceContent').focus();
    toast('已取用终端选中的文字');
  });
  $('#promptTemplateSelect').addEventListener('change', () => {
    const item = app.promptLibraryItems.find(prompt => prompt.id === $('#promptTemplateSelect').value);
    if (item) $('#promptSourceInstruction').value = item.prompt;
  });
  $('#analyzePrompt').addEventListener('click', analyzePromptDraft);
  $('#savePromptDraft').addEventListener('click', savePromptDraft);
  $('#resetPromptDraft').addEventListener('click', resetPromptDraft);
  $('#newPromptDraft').addEventListener('click', () => {
    resetPromptDraft();
    setPromptManagerTab('refine');
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#promptManagerBackdrop').hidden) closePromptManager();
  });
}

/** 视图切换、侧栏折叠与主题绑定 */
function wirePreferences() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => setView('management')));
  $('#railToggle').addEventListener('click', () => {
    const collapsed = document.querySelector('.shell').classList.toggle('nav-collapsed');
    app.navCollapsed = collapsed;
    saveWorkspaceSettings({ navCollapsed: collapsed });
    $('#railToggle').title = collapsed ? '展开侧栏' : '收起侧栏';
    $('#railToggle').textContent = collapsed ? '›' : '‹';
    requestAnimationFrame(() => fitTerminal());
  });
  $('#collapseSessions').addEventListener('click', () => {
    app.sessionsCollapsed = !app.sessionsCollapsed;
    app.workspace.classList.toggle('sessions-collapsed', app.sessionsCollapsed);
    saveWorkspaceSettings({ sessionsCollapsed: app.sessionsCollapsed });
    requestAnimationFrame(() => fitTerminal());
  });
  const toggleFiles = () => {
    app.filesCollapsed = !app.filesCollapsed;
    app.workspace.classList.toggle('files-collapsed', app.filesCollapsed);
    saveWorkspaceSettings({ filesCollapsed: app.filesCollapsed });
    requestAnimationFrame(() => fitTerminal());
  };
  $('#collapseFiles').addEventListener('click', toggleFiles);
  $('#toggleFiles').addEventListener('click', toggleFiles);
  $('#toggleWorkspaceTheme').addEventListener('click', () => {
    app.workspaceDark = !app.workspaceDark;
    // 本地缓存与服务端写入由设置管理器统一处理，失败时界面仍生效
    saveWorkspaceSettings({ theme: app.workspaceDark ? 'dark' : 'light' });
    applyWorkspaceTheme();
  });
  // 工具栏与状态栏同时隐藏时，仍可通过快捷键打开配置面板恢复
  document.addEventListener('keydown', event => {
    // Shift+, 在多数布局下 key 是 '<'，必须用 code 判定
    const isComma = event.code === 'Comma' || event.key === ',';
    if (!event.ctrlKey || !event.shiftKey || event.altKey || !isComma) return;
    if (!$('#statuslineSettingsBackdrop').hidden) return;
    event.preventDefault();
    openStatuslineSettings();
  });
}

/** 按设置恢复加载时就存在的界面状态（视图、折叠、显隐、输入区） */
function applyInitialWorkspaceState() {
  const shell = document.querySelector('.shell');
  shell.classList.toggle('nav-collapsed', app.navCollapsed);
  if (app.navCollapsed) { $('#railToggle').textContent = '›'; $('#railToggle').title = '展开侧栏'; }
  app.workspace.classList.toggle('sessions-collapsed', app.sessionsCollapsed);
  app.workspace.classList.toggle('files-collapsed', app.filesCollapsed);
  $('#terminalComposer').hidden = !app.composerVisible;
  $('#toggleComposer').setAttribute('aria-expanded', String(app.composerVisible));
  applyRegionVisibility();
  // 显隐开关在状态栏面板内切换，布局由本模块负责刷新
  window.addEventListener('workspace-region-visibility', applyRegionVisibility);
}

/** 应用状态栏与工具栏显隐；隐藏后由 CSS 调整终端网格并重新适配尺寸 */
export function applyRegionVisibility() {
  const column = $('.terminal-column');
  $('.terminal-toolbar').hidden = !app.toolbarVisible;
  $('.terminal-footer').hidden = !app.statuslineVisible;
  column.classList.toggle('toolbar-hidden', !app.toolbarVisible);
  column.classList.toggle('statusline-hidden', !app.statuslineVisible);
  requestAnimationFrame(() => fitTerminal());
}

/** 工作区初始化：按原有顺序完成事件绑定与首屏渲染 */
export function setupWorkspace() {
  wireSessions();
  wireFiles();
  wireTerminal();
  wireComposer();
  wirePrompts();
  wireProjects();
  wirePreferences();
  applyInitialWorkspaceState();
  updateProjectLabels();
  setView(app.view);
}
