import { $ } from './core/dom.mjs';
import { toast } from './core/api.mjs';
import { app, keys } from './state.mjs';
import { fitTerminal } from './terminal.mjs';
import { setTerminalFontSize, updateProjectLabels } from './preferences.mjs';
import { refreshProjects, selectProject, hideProjectFromList, closeProjectContextMenu, renderProjects } from './projects.mjs';
import {
  refreshSessions, startSession, continueLastConversation,
  closeCurrentSession, interruptCurrentSession,
} from './sessions.mjs';
import { closeSessionActivityMonitors, refreshSessionStatuses } from './activity.mjs';
import { refreshTree, runFileTreeContextAction, closeFileTreeContextMenu } from './files.mjs';
import {
  sendComposerToTerminal, toggleComposer, renderComposerAttachments, addComposerImageFiles,
  pasteIntoComposer, handleComposerDrop,
} from './composer.mjs';
import {
  openPromptManager, closePromptManager, setPromptManagerTab, analyzePromptDraft, savePromptDraft,
  resetPromptDraft,
} from './prompts.mjs';
import { applyWorkspaceTheme } from './theme.mjs';
import { refreshStatusline, openStatuslineSettings } from './statusline.mjs';

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
  localStorage.setItem(keys.view, view);
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
    localStorage.setItem(keys.projectsExpanded, app.projectsExpanded ? '1' : '0');
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
  $('#continueSession').addEventListener('click', continueLastConversation);
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
}

/** 输入区、图片附件与拖放绑定 */
function wireComposer() {
  $('#toggleComposer').addEventListener('click', toggleComposer);
  $('#clearComposer').addEventListener('click', () => {
    $('#composerInput').value = '';
    app.composerAttachments = [];
    renderComposerAttachments();
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
  composerInput.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); sendComposerToTerminal(); } });
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
    localStorage.setItem('claude-workbench-nav-collapsed', collapsed ? '1' : '0');
    $('#railToggle').title = collapsed ? '展开侧栏' : '收起侧栏';
    $('#railToggle').textContent = collapsed ? '›' : '‹';
    requestAnimationFrame(() => fitTerminal());
  });
  $('#collapseSessions').addEventListener('click', () => { app.workspace.classList.toggle('sessions-collapsed'); requestAnimationFrame(() => fitTerminal()); });
  const toggleFiles = () => { app.workspace.classList.toggle('files-collapsed'); requestAnimationFrame(() => fitTerminal()); };
  $('#collapseFiles').addEventListener('click', toggleFiles);
  $('#toggleFiles').addEventListener('click', toggleFiles);
  $('#toggleWorkspaceTheme').addEventListener('click', () => {
    app.workspaceDark = !app.workspaceDark;
    // 持久化失败时静默：主题仍在当前会话生效
    try { localStorage.setItem(keys.theme, app.workspaceDark ? 'dark' : 'light'); } catch { /* 忽略写入异常 */ }
    applyWorkspaceTheme();
  });
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
  const navCollapsed = localStorage.getItem('claude-workbench-nav-collapsed') === '1';
  document.querySelector('.shell').classList.toggle('nav-collapsed', navCollapsed);
  if (navCollapsed) { $('#railToggle').textContent = '›'; $('#railToggle').title = '展开侧栏'; }
  updateProjectLabels();
  setView(localStorage.getItem(keys.view) === 'workspace' ? 'workspace' : 'management');
}
