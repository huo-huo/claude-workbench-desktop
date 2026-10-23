import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './workstation.css';

const $ = selector => document.querySelector(selector);
const workspace = $('#workspace');
const terminalHost = $('#terminalHost');
const projectKey = 'claude-workbench-project-path';
const viewKey = 'claude-workbench-view';
const themeKey = 'claude-workbench-workspace-theme';
const terminalFontSizeKey = 'claude-workbench-terminal-font-size';
const projectsExpandedKey = 'claude-workbench-projects-expanded';
// 会话分组折叠状态：存规范化路径 key 的数组
const collapsedProjectsKey = 'claude-workbench-collapsed-projects';
const maxSessionActivityMonitors = 20;
let projectPath = localStorage.getItem(projectKey) || '';
let workspaceDark = localStorage.getItem(themeKey) === 'dark';
// 启动时先同步 body 主题，避免管理页首屏闪回浅色
document.body.classList.toggle('theme-dark', workspaceDark);
let projectsExpanded = localStorage.getItem(projectsExpandedKey) === '1';
let activeSession = null;
let socket = null;
let terminalReconnectTimer = null;
let terminalReconnectAttempts = 0;
let terminalConnectionGeneration = 0;
let terminalSessionAlive = false;
let terminal = null;
let fitAddon = null;
let lastTerminalPtySize = '';
let terminalCursorVisibilityPending = '';
let composerVisible = false;
let composerAttachments = [];
let promptLibraryItems = [];
let promptEditingId = '';
let terminalFontSize = Number(localStorage.getItem(terminalFontSizeKey)) || 12;
let selectedFile = '';
let lastManagementCrumb = '运行概览';
let projectSessions = [];
let projects = [];
let lastFileOpen = { path: '', at: 0 };
let fileTreeRefreshJob = null;
let fileTreeSignature = '';
let fileTreeInteractionAt = 0;
let fileTreeDragging = false;
let contextProjectPath = '';
let fileTreeContextTarget = { path: '', type: '' };
const sessionActivityMonitors = new Map();
const sessionActivityStates = new Map();

// 终端配色：深色沿用原有配色，浅色使用浅底深字，跟随全局主题
const terminalThemes = {
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : options.body,
  });
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(value?.error || `请求失败（${response.status}）`);
  return value;
}

function toast(message) {
  if (window.workbenchToast) window.workbenchToast(message);
  else alert(message);
}

function setView(view) {
  const isWorkspace = view === 'workspace';
  if (isWorkspace && !workspace.hidden) return;
  if (!isWorkspace) closeSessionActivityMonitors();
  if (isWorkspace) lastManagementCrumb = $('#crumb').textContent;
  document.body.classList.toggle('view-workspace', isWorkspace);
  document.body.classList.toggle('view-management', !isWorkspace);
  workspace.hidden = !isWorkspace;
  $('#page').hidden = isWorkspace;
  applyWorkspaceTheme();
  $('#crumb').textContent = isWorkspace ? '对话工作站' : lastManagementCrumb;
  $('#refresh').hidden = isWorkspace;
  $('#scanTime').hidden = isWorkspace;
  $('#workspaceProjectIndicator').style.display = isWorkspace ? 'inline-block' : 'none';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  localStorage.setItem(viewKey, view);
  if (isWorkspace) {
    updateProjectLabels();
    refreshProjects().then(refreshSessions).then(() => projectPath ? refreshTree() : null).catch(error => toast(error.message));
    requestAnimationFrame(() => fitTerminal());
  }
}

function applyWorkspaceTheme() {
  const shell = document.querySelector('.shell');
  workspace.classList.toggle('theme-dark', workspaceDark);
  // 管理页与工作站共用主题：整个 body 一起切换
  document.body.classList.toggle('theme-dark', workspaceDark);
  shell.classList.toggle('workspace-dark', workspaceDark && !workspace.hidden);
  const button = $('#toggleWorkspaceTheme');
  if (button) {
    button.textContent = workspaceDark ? '☀ 浅色' : '◐ 深色';
    button.title = workspaceDark ? '切换到浅色模式' : '切换到深色模式';
    button.setAttribute('aria-pressed', String(workspaceDark));
  }
  // 终端可能尚未创建；存在时同步配色并重新适配尺寸
  if (terminal) {
    terminal.options.theme = terminalThemes[workspaceDark ? 'dark' : 'light'];
    requestAnimationFrame(() => fitTerminal());
  }
}

function setTerminalFontSize(value) {
  terminalFontSize = Math.max(10, Math.min(24, Math.round(Number(value) || 12)));
  localStorage.setItem(terminalFontSizeKey, String(terminalFontSize));
  $('#terminalZoomLevel').textContent = `${terminalFontSize}px`;
  $('#terminalZoomOut').disabled = terminalFontSize <= 10;
  $('#terminalZoomIn').disabled = terminalFontSize >= 24;
  if (terminal) {
    terminal.options.fontSize = terminalFontSize;
    requestAnimationFrame(() => fitTerminal());
  }
}

function updateProjectLabels() {
  const label = projectPath || '选择 Claude Code 项目文件夹';
  $('#projectPath').textContent = label;
  $('#workspaceProjectIndicator').textContent = projectPath ? projectPath.split(/[\\/]/).filter(Boolean).at(-1) : '未选择项目';
  $('#workspaceProjectIndicator').title = projectPath;
  updateTerminalEmptyState();
}

function updateTerminalEmptyState() {
  const hasProject = Boolean(projectPath);
  const projectName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) || '';
  $('#terminalEmptyTitle').textContent = hasProject ? `已打开：${projectName}` : '在项目里开始工作';
  $('#terminalEmptyDescription').textContent = hasProject
    ? '这个项目已加入工作区。新建会话会在此文件夹中启动；点左侧记录可继续编辑。'
    : '先添加一个项目文件夹，再新建对话。对话会记录所属文件夹和创建时间。';
  $('#chooseProjectEmpty').textContent = hasProject ? '添加另一个项目' : '＋ 添加项目文件夹';
  $('#newSessionEmpty').hidden = !hasProject;
  $('#continueSession').disabled = !hasProject;
}

function projectName(path) {
  return String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) || '未命名项目';
}

// 会话分组 key：统一斜杠、去掉尾部斜杠、转小写；空路径返回空字符串
function sessionGroupKey(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

// 读取折叠的项目 key；内容非法（非 JSON 或非数组）时按空数组处理
function readCollapsedProjects() {
  try {
    const value = JSON.parse(localStorage.getItem(collapsedProjectsKey) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch { return []; }
}

// 写入折叠的项目 key（去重，保持顺序）；localStorage 写入失败时静默失败，不抛到点击处理器
function writeCollapsedProjects(keys) {
  try {
    localStorage.setItem(collapsedProjectsKey, JSON.stringify([...new Set(keys)]));
  } catch { /* 持久化失败不影响本次折叠交互 */ }
}

// 按项目路径聚合会话，组间按组内最近使用时间倒序；组内保持接口返回顺序
function groupSessionsByProject(sessions) {
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
function sessionGroupMarkup(group, collapsedKeys) {
  const collapsed = collapsedKeys.includes(group.key);
  return `<section class="session-group${collapsed ? ' is-collapsed' : ''}" data-session-group="${escapeHtml(group.key)}"><button class="session-group-head" type="button" aria-expanded="${String(!collapsed)}" title="${escapeHtml(group.path)}"><span class="session-group-caret" aria-hidden="true">▾</span><span class="session-group-name">${escapeHtml(projectName(group.path))}</span><span class="session-group-path">${escapeHtml(group.path)}</span><span class="session-group-count">${group.sessions.length}</span></button><div class="session-group-body">${group.sessions.map(sessionRowMarkup).join('')}</div></section>`;
}

// 切换分组折叠状态并持久化到 localStorage
function toggleSessionGroup(groupElement) {
  if (!groupElement) return;
  const key = groupElement.dataset.sessionGroup || '';
  const collapsed = groupElement.classList.toggle('is-collapsed');
  groupElement.querySelector('.session-group-head')?.setAttribute('aria-expanded', String(!collapsed));
  const keys = readCollapsedProjects().filter(item => item !== key);
  if (collapsed) keys.push(key);
  writeCollapsedProjects(keys);
}

function formatSessionTime(value) {
  return new Date(value || Date.now()).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

async function refreshProjects() {
  const result = await api('/api/workspace/projects');
  projects = result.projects || [];
  if (!projectPath && projects.length) {
    projectPath = projects[0].path;
    localStorage.setItem(projectKey, projectPath);
  }
  renderProjects();
  updateProjectLabels();
}

function renderProjects() {
  const list = $('#projectList');
  const toggle = $('#toggleMoreProjects');
  const selected = projects.find(item => item.path.toLowerCase() === projectPath.toLowerCase());
  let visible = projectsExpanded || projects.length <= 4 ? projects : projects.slice(0, 4);
  if (!projectsExpanded && projects.length > 4 && selected && !visible.some(item => item.path.toLowerCase() === selected.path.toLowerCase())) {
    visible = [...projects.slice(0, 3), selected];
  }
  list.classList.toggle('expanded', projectsExpanded);
  list.innerHTML = visible.length ? visible.map(item => `<button class="project-item ${item.path.toLowerCase() === projectPath.toLowerCase() ? 'active' : ''}" data-project-path="${escapeHtml(item.path)}" title="左键切换项目，右键可从列表隐藏"><span class="project-item-icon">▰</span><span>${escapeHtml(item.name)}</span></button>`).join('') : '<div class="empty">添加项目文件夹后显示在这里</div>';
  toggle.hidden = projects.length <= 4;
  if (!toggle.hidden) toggle.textContent = projectsExpanded ? '收起项目' : `显示更多项目（${projects.length - visible.length}）`;
  document.querySelectorAll('[data-project-path]').forEach(button => {
    button.onclick = () => activateProject(button.dataset.projectPath);
    button.oncontextmenu = event => showProjectContextMenu(event, button.dataset.projectPath);
  });
}

function showProjectContextMenu(event, path) {
  event.preventDefault();
  contextProjectPath = path;
  const menu = $('#projectContextMenu');
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 178))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - 48))}px`;
}

function closeProjectContextMenu() {
  $('#projectContextMenu').hidden = true;
  contextProjectPath = '';
}

function showFileTreeContextMenu(event, button) {
  event.preventDefault();
  event.stopPropagation();
  selectTreeRow(button);
  fileTreeContextTarget = { path: button.dataset.treePath, type: button.dataset.treeType, projectPath };
  const menu = $('#fileTreeContextMenu');
  $('#fileTreeRevealPath').textContent = '在文件夹中显示';
  $('#fileTreeRecycle').disabled = !fileTreeContextTarget.path || fileTreeContextTarget.path === '.';
  const menuWidth = 190;
  menu.hidden = false;
  const menuHeight = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))}px`;
}

function closeFileTreeContextMenu() {
  $('#fileTreeContextMenu').hidden = true;
  fileTreeContextTarget = { path: '', type: '' };
}

function absoluteWorkspacePath(relativePath) {
  const root = projectPath.replace(/[\\/]+$/, '');
  const relative = String(relativePath || '.').replace(/[\\/]/g, '\\');
  if (!relative || relative === '.') return root;
  if (/^[A-Za-z]:\\|^\\\\/.test(relative)) return relative;
  return `${root}\\${relative.replace(/^\\+/, '')}`;
}

async function copyWorkspacePath(relativePath) {
  const value = absoluteWorkspacePath(relativePath);
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const field = document.createElement('textarea');
    field.value = value;
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error('复制路径失败');
  }
  toast('路径已复制');
}

function addWorkspacePathToConversation(relativePath) {
  const value = quoteWindowsPath(absoluteWorkspacePath(relativePath));
  if (composerVisible) {
    insertComposerText(value);
    toast('文件路径已添加到输入框；点击“发送到 Claude”发送');
    return;
  }
  if (activeSession && socket?.readyState === WebSocket.OPEN && terminal) {
    terminal.paste(value);
    terminal.focus();
    toast('文件路径已放入 CLI 输入框；按 Enter 发送');
    return;
  }
  toggleComposer();
  insertComposerText(value);
  toast('文件路径已放入输入框；打开对话后可发送');
}

async function runFileTreeContextAction(action) {
  const target = fileTreeContextTarget;
  closeFileTreeContextMenu();
  if (!target.path) return;
  if (action === 'reveal') {
    await revealTreeItem(target).catch(error => toast(error.message));
    return;
  }
  if (action === 'recycle') {
    try {
      await api('/api/workspace/recycle', { method: 'POST', body: { projectPath: target.projectPath, path: target.path } });
      if (projectPath === target.projectPath) {
        if (selectedFile === target.path) selectedFile = '';
        await refreshTree({ force: true });
      }
      toast('已移到系统回收站，可在回收站中还原');
    } catch (error) { toast(error.message); }
    return;
  }
  if (action === 'copy') {
    try { await copyWorkspacePath(target.path); }
    catch (error) { toast(error.message); }
    return;
  }
  if (action === 'add') {
    addWorkspacePathToConversation(target.path);
    return;
  }
}

function findTreeRow(itemPath, type) {
  const normalize = value => String(value || '.').replace(/[\\/]+/g, '/').replace(/^\.\//, '').replace(/\/$/, '') || '.';
  const normalizedPath = normalize(itemPath);
  return [...document.querySelectorAll('[data-tree-path]')].find(row =>
    row.dataset.treeType === type && normalize(row.dataset.treePath) === normalizedPath,
  );
}

async function openTreeFolder(button) {
  const children = button?.parentElement.querySelector(':scope > .tree-children');
  if (!button || !children || !await loadTreeFolder(button, children)) return false;
  children.classList.remove('closed');
  button.querySelector('.tree-caret').textContent = '⌄';
  return true;
}

function selectTreeRow(button) {
  selectedFile = button.dataset.treePath;
  document.querySelectorAll('.tree-row.selected').forEach(row => row.classList.remove('selected'));
  button.classList.add('selected');
  button.scrollIntoView({ block: 'nearest' });
}

async function revealTreeItem(target) {
  await api('/api/workspace/reveal-file', { method: 'POST', body: { projectPath: target.projectPath || projectPath, path: target.path } });
  toast('已打开所在文件夹，并选中对应项目');
}

async function hideProjectFromList() {
  const path = contextProjectPath;
  closeProjectContextMenu();
  if (!path) return;
  const result = await api('/api/workspace/project/hide', { method: 'POST', body: { path } });
  if (!result.hidden) return toast('这个项目已经不在列表里了');
  if (projectPath.toLowerCase() === path.toLowerCase()) {
    const next = projects.find(item => item.path.toLowerCase() !== path.toLowerCase());
    projectPath = next?.path || '';
    if (projectPath) localStorage.setItem(projectKey, projectPath);
    else localStorage.removeItem(projectKey);
    selectedFile = '';
  }
  await refreshProjects();
  await refreshSessions();
  if (projectPath) await refreshTree();
  else $('#fileTree').innerHTML = '<div class="empty">选择项目文件夹后显示文件</div>';
  toast('已从项目列表隐藏；文件和对话历史都保留');
}

async function activateProject(path) {
  projectPath = path;
  localStorage.setItem(projectKey, projectPath);
  selectedFile = '';
  await refreshProjects();
  updateProjectLabels();
  await Promise.all([refreshTree(), refreshSessions()]);
  if (!activeSession) {
    $('#terminalTitle').textContent = projectName(projectPath);
    $('#terminalSubtitle').textContent = projectPath;
  }
}

function queryPath(path) {
  return `/api/workspace/files?projectPath=${encodeURIComponent(projectPath)}&path=${encodeURIComponent(path || '.')}`;
}

function treeMarkup(item, root = false) {
  if (item.type === 'file' && String(item.name || '').startsWith('~$')) return '';
  const isFolder = item.type === 'folder';
  const children = Array.isArray(item.children) ? item.children : null;
  const path = item.path || '.';
  const icon = isFolder ? '' : iconFor(item.extension);
  const leadingIcon = isFolder
    ? `<span class="tree-folder-icon" title="文件夹" aria-label="文件夹"><svg viewBox="0 0 20 16" aria-hidden="true"><path d="M1.5 3A1.5 1.5 0 0 1 3 1.5h4l1.7 2H17A1.5 1.5 0 0 1 18.5 5v8A1.5 1.5 0 0 1 17 14.5H3A1.5 1.5 0 0 1 1.5 13z"/><path class="folder-flap" d="M1.5 5.5h17L16.8 13H2.7z"/></svg></span>`
    : `<span class="tree-icon tree-icon-file tree-icon-${icon.kind}" title="${escapeHtml(icon.title)}" aria-label="${escapeHtml(icon.title)}">${escapeHtml(icon.label)}</span>`;
  const childrenVerified = Boolean(children?.length);
  const folderContents = isFolder ? `<div class="tree-children ${root ? '' : 'closed'}" data-tree-children="${escapeHtml(path)}">${(children || []).map(child => treeMarkup(child)).join('')}</div>` : '';
  return `<div class="tree-node" data-tree-node="${escapeHtml(path)}"><button class="tree-row ${selectedFile === path ? 'selected' : ''}" data-tree-path="${escapeHtml(path)}" data-tree-type="${item.type}" data-tree-loaded="${children ? '1' : '0'}" data-tree-verified="${childrenVerified ? '1' : '0'}"${isFolder ? '' : ' draggable="true"'}><span class="tree-caret" aria-hidden="true">${isFolder ? (root ? '⌄' : '▸') : ''}</span>${leadingIcon}<span class="tree-name">${escapeHtml(item.name)}</span></button>${folderContents}</div>`;
}

function iconFor(extension = '') {
  const ext = String(extension || '').toLowerCase();
  if (['.doc', '.docx', '.docm', '.dot', '.dotx', '.rtf'].includes(ext)) return { kind: 'word', label: 'W', title: 'Word 文档' };
  if (['.xls', '.xlsx', '.xlsm', '.xlt', '.xltx', '.csv'].includes(ext)) return { kind: 'excel', label: 'X', title: ext === '.csv' ? 'CSV 表格' : 'Excel 表格' };
  if (['.ppt', '.pptx', '.pptm', '.potx', '.ppsx'].includes(ext)) return { kind: 'powerpoint', label: 'P', title: 'PowerPoint 演示文稿' };
  if (ext === '.pdf') return { kind: 'pdf', label: 'PDF', title: 'PDF 文档' };
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.tif', '.tiff', '.ico'].includes(ext)) return { kind: 'image', label: 'IMG', title: '图片' };
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return { kind: 'video', label: '▶', title: '视频文件' };
  if (['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg'].includes(ext)) return { kind: 'audio', label: '♪', title: '音频文件' };
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return { kind: 'archive', label: 'ZIP', title: '压缩文件' };
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.css', '.scss', '.html', '.vue', '.sh', '.ps1', '.sql'].includes(ext)) return { kind: 'code', label: '</>', title: '代码文件' };
  if (['.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.env'].includes(ext)) return { kind: 'data', label: '{ }', title: '配置 / 数据文件' };
  if (['.md', '.txt', '.log', '.rst'].includes(ext)) return { kind: 'text', label: 'TXT', title: '文本文件' };
  return { kind: 'generic', label: 'FILE', title: ext ? `${ext.slice(1).toUpperCase()} 文件` : '文件' };
}

async function refreshTree({ force = false } = {}) {
  if (!projectPath) return;
  const root = projectPath;
  if (!force && fileTreeRefreshJob?.project === root) return fileTreeRefreshJob.promise;
  const job = { project: root, promise: null };
  fileTreeRefreshJob = job;
  $('#refreshFiles').disabled = true;
  job.promise = (async () => {
    const panel = $('#fileTree');
    const expandedPaths = () => [...panel.querySelectorAll('[data-tree-children]:not(.closed)')].map(e => e.dataset.treeChildren).sort();
    const expanded = expandedPaths();
    const hadTree = Boolean(panel.querySelector('[data-tree-path]'));
    const url = itemPath => `/api/workspace/files?projectPath=${encodeURIComponent(root)}&path=${encodeURIComponent(itemPath)}`;
    const tree = await api(url('.'));
    const nodes = new Map();
    const index = node => {
      nodes.set(node.path || '.', node);
      for (const child of node.children || []) index(child);
    };
    index(tree);
    // Refresh expanded lazy branches as well as the initial root snapshot.
    for (const itemPath of [...expanded].sort((a, b) => a.split(/[\\/]/).length - b.split(/[\\/]/).length)) {
      if (fileTreeRefreshJob !== job || projectPath !== root) return;
      const folder = nodes.get(itemPath);
      if (folder?.type === 'folder' && !Array.isArray(folder.children)) {
        folder.children = (await api(url(itemPath))).children || [];
        index(folder);
      }
    }
    if (fileTreeRefreshJob !== job || projectPath !== root) return;
    // A user opening/collapsing a branch while fetching takes precedence.
    if (JSON.stringify(expandedPaths()) !== JSON.stringify(expanded)) return;
    const signature = root + '\n' + JSON.stringify(tree);
    if (hadTree && signature === fileTreeSignature) return;
    const scrollTop = panel.scrollTop;
    const focused = panel.contains(document.activeElement) ? document.activeElement.closest('[data-tree-path]') : null;
    const focusedPath = focused?.dataset.treePath;
    const focusedType = focused?.dataset.treeType;
    panel.innerHTML = treeMarkup(tree, true);
    if (hadTree) {
      for (const children of panel.querySelectorAll('[data-tree-children]')) {
        const opened = expanded.includes(children.dataset.treeChildren);
        children.classList.toggle('closed', !opened);
        children.parentElement.querySelector('.tree-caret').textContent = opened ? '⌄' : '▸';
      }
    }
    wireTree();
    if (focusedPath) findTreeRow(focusedPath, focusedType)?.focus({ preventScroll: true });
    panel.scrollTop = scrollTop;
    fileTreeSignature = signature;
  })().finally(() => {
    if (fileTreeRefreshJob === job) {
      fileTreeRefreshJob = null;
      $('#refreshFiles').disabled = false;
    }
  });
  return job.promise;
}

async function toggleTreeFolder(button) {
  const children = button.parentElement.querySelector(':scope > .tree-children');
  if (!children) return;
  if (children.classList.contains('closed')) await openTreeFolder(button);
  else {
    children.classList.add('closed');
    button.querySelector('.tree-caret').textContent = '▸';
  }
}

function wireTree() {
  document.querySelectorAll('[data-tree-path]').forEach(button => {
    button.ondragstart = event => {
      if (button.dataset.treeType === 'folder' || !event.dataTransfer) { event.preventDefault(); return; }
      fileTreeDragging = true;
      const relative = button.dataset.treePath.replace(/[\\/]/g, '\\');
      const root = projectPath.replace(/[\\/]+$/, '');
      const absolute = `${root}\\${relative}`;
      const quoted = /\s/.test(absolute) ? `"${absolute.replaceAll('"', '\\"')}"` : absolute;
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', quoted);
      try { event.dataTransfer.setData('application/x-claude-workbench-file', absolute); } catch {}
    };
    button.ondragend = () => { fileTreeDragging = false; };
    button.onclick = event => {
      selectTreeRow(button);
      if (button.dataset.treeType === 'folder' && event.target.closest('.tree-caret')) {
        toggleTreeFolder(button).catch(error => toast(error.message));
      }
    };
    button.oncontextmenu = event => showFileTreeContextMenu(event, button);
    button.ondblclick = async event => {
      const itemPath = button.dataset.treePath;
      event.preventDefault();
      if (button.dataset.treeType === 'folder') {
        if (!event.target.closest('.tree-caret')) await toggleTreeFolder(button);
        return;
      }
      openProjectFile(itemPath).catch(error => toast(error.message));
    };
    button.onkeydown = event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      selectTreeRow(button);
      const action = button.dataset.treeType === 'folder' ? toggleTreeFolder(button) : openProjectFile(button.dataset.treePath);
      action.catch(error => toast(error.message));
    };
  });
}

async function loadTreeFolder(button, children) {
  if (button.dataset.treeVerified === '1') return true;
  button.disabled = true;
  try {
    const result = await api(queryPath(button.dataset.treePath));
    const entries = Array.isArray(result.children) ? result.children : [];
    children.innerHTML = entries.map(child => treeMarkup(child)).join('');
    button.dataset.treeLoaded = '1';
    button.dataset.treeVerified = '1';
    wireTree();
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  } finally {
    button.disabled = false;
  }
}

async function openProjectFile(filePath) {
  const now = Date.now();
  const key = projectPath + '\n' + filePath;
  if (lastFileOpen.path === key && now - lastFileOpen.at < 800) return;
  lastFileOpen = { path: key, at: now };
  await api('/api/workspace/open-file', { method: 'POST', body: { projectPath, path: filePath } });
}

function sendComposerToTerminal() {
  const text = $('#composerInput').value;
  const images = composerAttachments.map(item => `@${quoteWindowsPath(item.path)}`);
  const message = [text.trim(), images.length ? `${images.length === 1 ? '请分析这张图片：' : '请分析这些图片：'}\n${images.join('\n')}` : ''].filter(Boolean).join('\n\n');
  if (!message) return;
  if (!activeSession || socket?.readyState !== WebSocket.OPEN || !terminal) {
    toast('先新建或继续一段对话，再发送输入内容');
    return;
  }
  terminal.paste(message);
  socket.send(JSON.stringify({ type: 'input', data: '\r' }));
  $('#composerInput').value = '';
  composerAttachments = [];
  renderComposerAttachments();
  terminal.focus();
  toast('已发送到 Claude Code');
}

function insertComposerText(value) {
  const input = $('#composerInput');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.setRangeText(String(value || ''), start, end, 'end');
  input.focus();
}

function renderComposerAttachments() {
  const list = $('#composerAttachments');
  list.replaceChildren();
  list.hidden = composerAttachments.length === 0;
  composerAttachments.forEach((item, index) => {
    const chip = document.createElement('span');
    chip.className = 'composer-attachment';
    const name = document.createElement('span');
    name.textContent = `▧ ${item.name}`;
    name.title = item.path;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除图片 ${item.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      composerAttachments.splice(index, 1);
      renderComposerAttachments();
    });
    chip.append(name, remove);
    list.append(chip);
  });
}

function addComposerImagePath(imagePath, name = '') {
  const path = String(imagePath || '').trim();
  if (!path) return;
  if (composerAttachments.some(item => item.path.toLowerCase() === path.toLowerCase())) return;
  const fallbackName = path.split(/[\\/]/).pop() || '图片';
  composerAttachments.push({ path, name: name || fallbackName });
  renderComposerAttachments();
}

async function uploadComposerImage(file) {
  const mime = String(file?.type || '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) {
    throw new Error('图片请使用 PNG、JPG、GIF 或 WebP 格式');
  }
  const response = await fetch('/api/workspace/image-upload', {
    method: 'POST',
    headers: { 'Content-Type': mime },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `图片添加失败（${response.status}）`);
  addComposerImagePath(result.imagePath, file.name || result.name);
}

async function addComposerImageFiles(files) {
  const imageFiles = [...(files || [])].filter(file => String(file.type || '').startsWith('image/'));
  if (!imageFiles.length) return toast('请选择或拖入图片文件');
  for (const file of imageFiles) {
    try { await uploadComposerImage(file); }
    catch (error) { toast(error.message); }
  }
  if (imageFiles.length) $('#composerInput').focus();
}

async function pasteIntoComposer(event) {
  event.preventDefault();
  const transfer = event.clipboardData;
  const imageFile = [...(transfer?.items || [])]
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .find(Boolean);
  if (imageFile) {
    try { await uploadComposerImage(imageFile); toast('图片已添加；点击“发送到 Claude”发送'); }
    catch (error) { toast(error.message); }
    return;
  }
  const text = transfer?.getData('text/plain') || '';
  if (text) {
    insertComposerText(text);
    return;
  }
  try {
    const payload = await api('/api/workspace/clipboard', { method: 'POST', body: {} });
    if (payload.imagePath) addComposerImagePath(payload.imagePath, '剪贴板图片');
    if (payload.text) insertComposerText(payload.text);
    if (payload.files?.length) insertComposerText(payload.files.map(quoteWindowsPath).join(' '));
    if (!payload.imagePath && !payload.text && !payload.files?.length) toast('剪贴板里没有可粘贴的文字或图片');
    else if (payload.imagePath) toast('图片已添加；点击“发送到 Claude”发送');
  } catch (error) { toast(error.message); }
}

function handleComposerDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  $('#terminalComposer').classList.remove('is-dragging');
  const transfer = event.dataTransfer;
  if (!transfer) return;
  const internalPath = transfer.getData('application/x-claude-workbench-file');
  if (internalPath) {
    if (/\.(png|jpe?g|gif|webp)$/i.test(internalPath)) addComposerImagePath(internalPath);
    else {
      insertComposerText(quoteWindowsPath(internalPath));
      toast('文件路径已放入输入框；点击“发送到 Claude”发送');
    }
    return;
  }
  const files = [...(transfer.files || [])];
  if (files.length) {
    addComposerImageFiles(files);
    return;
  }
  const uriList = transfer.getData('text/uri-list').split(/\r?\n/).find(value => value && !value.startsWith('#')) || '';
  const plain = transfer.getData('text/plain') || uriList;
  if (/\.(png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(plain)) addComposerImagePath(plain.replace(/^file:\/*/i, '').replaceAll('/', '\\'));
  else if (plain) insertComposerText(plain);
}

function setPromptManagerTab(tab) {
  const showLibrary = tab === 'library';
  $('#promptRefinePanel').hidden = showLibrary;
  $('#promptLibraryPanel').hidden = !showLibrary;
  document.querySelectorAll('[data-prompt-tab]').forEach(button => button.classList.toggle('active', button.dataset.promptTab === tab));
}

function renderPromptLibrary() {
  const count = $('#promptLibraryCount');
  const list = $('#promptLibraryList');
  const select = $('#promptTemplateSelect');
  count.textContent = String(promptLibraryItems.length);
  const selectedId = select.value;
  select.replaceChildren(new Option('选择库里的提示词，或直接在下面填写', ''));
  for (const item of promptLibraryItems) {
    const option = new Option(item.name, item.id);
    select.append(option);
  }
  if (promptLibraryItems.some(item => item.id === selectedId)) select.value = selectedId;
  list.replaceChildren();
  if (!promptLibraryItems.length) {
    const empty = document.createElement('div');
    empty.className = 'prompt-library-empty';
    empty.textContent = '提示词库还是空的。整理并保存后，可以在这里一键插入输入框。';
    list.append(empty);
    return;
  }
  for (const item of promptLibraryItems) {
    const card = document.createElement('article');
    card.className = 'prompt-library-card';
    const details = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = item.name;
    const summary = document.createElement('p');
    summary.textContent = item.summary || item.prompt.slice(0, 170);
    const updated = document.createElement('small');
    updated.textContent = `更新于 ${item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间'}`;
    details.append(title, summary, updated);
    const actions = document.createElement('div');
    actions.className = 'prompt-library-card-actions';
    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'btn insert';
    insert.textContent = '插入输入框';
    insert.title = '把提示词放入 CLI 输入框；检查后再发送';
    insert.addEventListener('click', () => insertPromptIntoComposer(item));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => editPromptLibraryItem(item));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn';
    remove.textContent = '删除';
    remove.addEventListener('click', () => deletePromptLibraryItem(item));
    actions.append(insert, edit, remove);
    card.append(details, actions);
    list.append(card);
  }
}

async function loadPromptLibrary() {
  const result = await api('/api/prompt-library');
  promptLibraryItems = Array.isArray(result.prompts) ? result.prompts : [];
  renderPromptLibrary();
}

function openPromptManager() {
  $('#promptManagerBackdrop').hidden = false;
  setPromptManagerTab('refine');
  const selection = terminal?.getSelection()?.trim() || '';
  if (selection && !$('#promptSourceContent').value.trim()) $('#promptSourceContent').value = selection;
  loadPromptLibrary().catch(error => toast(error.message));
  requestAnimationFrame(() => $('#promptSourceContent').focus());
}

function closePromptManager() {
  $('#promptManagerBackdrop').hidden = true;
}

function editPromptLibraryItem(item) {
  promptEditingId = item.id;
  $('#promptDraftName').value = item.name || '';
  $('#promptDraftSummary').value = item.summary || '';
  $('#promptDraftText').value = item.prompt || '';
  $('#promptEditingState').textContent = `正在编辑：${item.name}`;
  setPromptManagerTab('refine');
  requestAnimationFrame(() => $('#promptDraftName').focus());
}

function insertPromptIntoComposer(item) {
  if (!composerVisible) toggleComposer();
  const current = $('#composerInput').value;
  insertComposerText(`${current.trim() ? '\n\n' : ''}${item.prompt}`);
  closePromptManager();
  toast('提示词已插入输入框；检查后点击“发送到 Claude”');
}

async function analyzePromptDraft() {
  const content = $('#promptSourceContent').value.trim();
  const instruction = $('#promptSourceInstruction').value.trim();
  if (!content) return toast('先粘贴内容，或从终端取用选中的文字');
  if (!instruction) return toast('先选择一个已有提示词，或填写对应的原始提示词');
  const button = $('#analyzePrompt');
  button.disabled = true;
  button.textContent = '梳理中…';
  $('#promptAnalyzeState').textContent = '正在调用当前渠道的主模型…';
  try {
    const result = await api('/api/prompt-library/refine', {
      method: 'POST',
      body: { content, instruction, name: $('#promptDraftName').value.trim() },
    });
    $('#promptDraftName').value = result.draft?.name || '新提示词';
    $('#promptDraftSummary').value = result.draft?.summary || '';
    $('#promptDraftText').value = result.draft?.prompt || '';
    promptEditingId = '';
    $('#promptEditingState').textContent = '请检查并修改上方结果，确认后再保存';
    $('#promptAnalyzeState').textContent = '梳理完成；结果尚未保存';
    toast('提示词已梳理，请检查后保存');
  } catch (error) {
    $('#promptAnalyzeState').textContent = '梳理失败';
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'AI 梳理';
  }
}

async function savePromptDraft() {
  const button = $('#savePromptDraft');
  button.disabled = true;
  try {
    const result = await api('/api/prompt-library/save', {
      method: 'POST',
      body: {
        id: promptEditingId,
        name: $('#promptDraftName').value,
        summary: $('#promptDraftSummary').value,
        prompt: $('#promptDraftText').value,
      },
    });
    promptLibraryItems = result.prompts || [];
    const saved = result.item;
    promptEditingId = saved.id;
    renderPromptLibrary();
    setPromptManagerTab('library');
    $('#promptAnalyzeState').textContent = '已保存到本机提示词库';
    toast('提示词已保存；可从列表插入当前对话');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

function resetPromptDraft() {
  promptEditingId = '';
  $('#promptSourceContent').value = '';
  $('#promptSourceInstruction').value = '';
  $('#promptTemplateSelect').value = '';
  $('#promptDraftName').value = '';
  $('#promptDraftSummary').value = '';
  $('#promptDraftText').value = '';
  $('#promptEditingState').textContent = '';
  $('#promptAnalyzeState').textContent = '使用当前渠道的主模型';
}

async function deletePromptLibraryItem(item) {
  if (!confirm(`确定从本机提示词库删除“${item.name}”吗？`)) return;
  try {
    const result = await api('/api/prompt-library/delete', { method: 'POST', body: { id: item.id } });
    promptLibraryItems = result.prompts || [];
    renderPromptLibrary();
    if (promptEditingId === item.id) resetPromptDraft();
    toast('提示词已从本机库中删除');
  } catch (error) { toast(error.message); }
}

async function selectProject() {
  const button = $('#chooseProject');
  button.disabled = true;
  try {
    const result = await api('/api/workspace/select-folder', { method: 'POST', body: {} });
    if (!result.projectPath) return;
    projectPath = result.projectPath;
    localStorage.setItem(projectKey, projectPath);
    selectedFile = '';
    updateProjectLabels();
    await Promise.all([refreshProjects(), refreshSessions(), refreshTree()]);
    $('#terminalTitle').textContent = projectPath.split(/[\\/]/).filter(Boolean).at(-1);
    $('#terminalSubtitle').textContent = projectPath;
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

async function refreshSessions() {
  const result = await api('/api/workspace/sessions');
  const sessions = result.sessions || [];
  syncSessionActivityMonitors(sessions);
  const currentProjectKey = sessionGroupKey(projectPath);
  projectSessions = sessions.filter(item => sessionGroupKey(item.projectPath) === currentProjectKey);
  updateTerminalEmptyState();
  // 按项目目录分组渲染；折叠状态与分组 key 共用 sessionGroupKey 结果
  const groups = groupSessionsByProject(sessions);
  const collapsedKeys = readCollapsedProjects();
  $('#sessionList').innerHTML = groups.length ? groups.map(group => sessionGroupMarkup(group, collapsedKeys)).join('') : '<div class="empty">还没有对话。选择项目文件夹后新建一个。</div>';
  document.querySelectorAll('[data-session-id]').forEach(button => button.onclick = () => openSavedSession(sessions.find(x => x.id === button.dataset.sessionId)));
  document.querySelectorAll('[data-remove-session]').forEach(button => button.onclick = event => { event.stopPropagation(); removeSession(button.dataset.removeSession).catch(error => toast(error.message)); });
  document.querySelectorAll('.session-group-head').forEach(head => head.onclick = () => toggleSessionGroup(head.closest('.session-group')));
}

function sessionActivityFor(session) {
  if (session.status !== 'running') return 'stopped';
  return sessionActivityStates.get(session.id) || 'online';
}

function sessionStatusMarkup(session, activity = sessionActivityFor(session)) {
  if (activity === 'working') {
    return '<span class="session-state is-working" data-session-status="running" data-session-activity="working" title="Claude 当前正在处理任务"><i class="session-spinner" aria-hidden="true"></i><span>工作中</span></span>';
  }
  if (activity === 'online') {
    return '<span class="session-state is-online" data-session-status="running" data-session-activity="online" title="CLI 会话在线，当前没有执行任务"><i class="session-online-dot" aria-hidden="true"></i><span>会话在线</span></span>';
  }
  return '<span class="session-state is-stopped" data-session-status="stopped" data-session-activity="stopped" title="CLI 会话已结束"><span>已结束</span></span>';
}

function sessionRowMarkup(item) {
  const mode = item.mode === 'continue' ? '继续' : item.mode === 'picker' ? '选择已有' : '新建';
  return `<div class="session-item"><button class="session-row ${activeSession?.id === item.id ? 'active' : ''}" data-session-id="${escapeHtml(item.id)}" title="${escapeHtml(item.name)}"><strong>${escapeHtml(projectName(item.projectPath))}</strong><small><span class="session-row-detail">${escapeHtml(formatSessionTime(item.createdAt || item.lastUsedAt))} · ${mode}</span>${sessionStatusMarkup(item)}</small></button><button class="session-remove" data-remove-session="${escapeHtml(item.id)}" title="从工作台移除；Claude 对话记录保留" aria-label="从工作台移除">×</button></div>`;
}

async function refreshSessionStatuses() {
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

function updateSessionActivity(sessionId, activity) {
  sessionActivityStates.set(sessionId, activity);
  const row = [...document.querySelectorAll('[data-session-id]')].find(button => button.dataset.sessionId === sessionId);
  const current = row?.querySelector('[data-session-status]');
  if (current && current.dataset.sessionActivity !== activity) {
    current.outerHTML = sessionStatusMarkup({ id: sessionId, status: activity === 'stopped' ? 'exited' : 'running' }, activity);
  }
}

function activityFromTerminal(screen) {
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

function closeSessionActivityMonitors() {
  for (const [sessionId, monitor] of sessionActivityMonitors) {
    sessionActivityMonitors.delete(sessionId);
    monitor.connection.onclose = null;
    monitor.connection.close();
    monitor.screen.dispose();
  }
}

function syncSessionActivityMonitors(sessions) {
  if (workspace.hidden) {
    closeSessionActivityMonitors();
    return;
  }
  const runningSessions = (sessions || []).filter(session => session.status === 'running').slice(0, maxSessionActivityMonitors);
  const runningIds = new Set(runningSessions.map(session => session.id));
  for (const [sessionId, monitor] of sessionActivityMonitors) {
    if (runningIds.has(sessionId)) continue;
    sessionActivityMonitors.delete(sessionId);
    sessionActivityStates.delete(sessionId);
    monitor.connection.onclose = null;
    monitor.connection.close();
    monitor.screen.dispose();
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const session of runningSessions) {
    if (sessionActivityMonitors.has(session.id)) continue;
    const connection = new WebSocket(`${protocol}//${location.host}/api/workspace/terminal?session=${encodeURIComponent(session.id)}`);
    // A parser-only terminal needs no DOM and never resizes the real PTY.
    // Use the server's maximum dimensions so cursor-addressed frames fit.
    const screen = new Terminal({ cols: 300, rows: 120, scrollback: 0, convertEol: false });
    const monitor = { connection, screen, exited: false };
    sessionActivityMonitors.set(session.id, monitor);
    connection.onmessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'ready' || message.type === 'data') {
        if (message.type === 'ready') monitor.exited = message.status !== 'running';
        screen.write(String(message.data || ''), () => {
          if (sessionActivityMonitors.get(session.id) !== monitor) return;
          updateSessionActivity(session.id, monitor.exited ? 'stopped' : activityFromTerminal(screen));
        });
      } else if (message.type === 'exit') {
        monitor.exited = true;
        updateSessionActivity(session.id, 'stopped');
      }
    };
    connection.onclose = () => {
      if (sessionActivityMonitors.get(session.id) !== monitor) return;
      sessionActivityMonitors.delete(session.id);
      screen.dispose();
    };
    connection.onerror = () => connection.close();
  }
}

function ensureTerminal() {
  if (terminal) return;
  terminal = new Terminal({
    cursorBlink: false,
    cursorStyle: 'bar',
    cursorInactiveStyle: 'none',
    fontSize: terminalFontSize,
    lineHeight: 1.2,
    fontFamily: 'Cascadia Code, Cascadia Mono, Consolas, "Courier New", monospace',
    scrollback: 5000,
    // ConPTY emits VT line feeds that intentionally preserve the cursor column.
    // Adding a carriage return moves redraw fragments left and leaves stale cells.
    convertEol: false,
    theme: terminalThemes[workspaceDark ? 'dark' : 'light'],
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost);
  terminal.onData(data => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data })); });
  let lastWheelAt = 0;
  let lastWheelDirection = 0;
  terminalHost.addEventListener('wheel', event => {
    if (event.ctrlKey || !event.deltaY || socket?.readyState !== WebSocket.OPEN
      || !terminalSessionAlive || terminal.modes.mouseTrackingMode === 'none') return;
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
    terminal.input(direction < 0 ? '\u001b[5~' : '\u001b[6~');
  }, { capture: true, passive: false });
  terminal.attachCustomKeyEventHandler(event => {
    if (event.type !== 'keydown' || !/Windows/i.test(navigator.userAgent)) return true;
    const key = event.key.toLowerCase();
    const ctrlV = event.ctrlKey && !event.altKey && !event.shiftKey && key === 'v';
    const altV = event.altKey && !event.ctrlKey && !event.shiftKey && key === 'v';
    if (!ctrlV && !altV) return true;
    event.preventDefault();
    pasteClipboardToTerminal(altV ? 'alt' : 'ctrl').catch(error => {
      const controlV = altV ? '\u001bv' : '\u0016';
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data: controlV }));
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
  terminalHost.addEventListener('dragenter', allowTerminalDrop, true);
  terminalHost.addEventListener('dragover', allowTerminalDrop, true);
  terminalHost.addEventListener('drop', event => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const absolute = transfer.getData('application/x-claude-workbench-file');
    const filePaths = absolute ? [] : [...(transfer.files || [])].map(file => file.path).filter(Boolean);
    const value = absolute ? quoteWindowsPath(absolute) : (filePaths.length ? filePaths.map(quoteWindowsPath).join(' ') : transfer.getData('text/plain'));
    event.preventDefault();
    event.stopPropagation();
    if (!value || !terminal) {
      toast('没有读到文件路径；请从右侧文件列表中的文件行拖入终端');
      return;
    }
    terminal.paste(value);
    terminal.focus();
    toast('文件路径已放入 CLI 输入框，按 Enter 发送');
  }, true);
  const observer = new ResizeObserver(() => fitTerminal());
  observer.observe(terminalHost);
  window.addEventListener('resize', () => fitTerminal());
  window.addEventListener('focus', () => requestAnimationFrame(() => fitTerminal()));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestAnimationFrame(() => fitTerminal());
  });
  fitTerminal();
}

function suppressCursorVisibility(data) {
  const hideCursor = '\u001b[?25l';
  const combined = terminalCursorVisibilityPending + String(data || '');
  terminalCursorVisibilityPending = '';

  const sequenceStart = combined.lastIndexOf('\u001b[?');
  if (sequenceStart >= 0) {
    const trailingSequence = combined.slice(sequenceStart);
    if (trailingSequence.length <= 32 && /^\u001b\[\?[0-9;]*$/.test(trailingSequence)) {
      terminalCursorVisibilityPending = trailingSequence;
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

function quoteWindowsPath(value) {
  const path = String(value || '').replace(/[\r\n]/g, '');
  return /\s/.test(path) ? `"${path.replaceAll('"', '\\"')}"` : path;
}

async function pasteClipboardToTerminal(shortcut) {
  if (!activeSession || socket?.readyState !== WebSocket.OPEN || !terminal) throw new Error('请先打开一段对话');
  const targetSocket = socket;
  const targetSessionId = activeSession.id;
  const payload = await api('/api/workspace/clipboard', { method: 'POST', body: {} });
  if (socket !== targetSocket || activeSession?.id !== targetSessionId) return;
  if (payload.image) {
    if (payload.imagePath) {
      // WebView2 terminals cannot pass bitmap clipboard data through xterm as an image object.
      terminal.paste(`@${payload.imagePath}`);
      toast('图片已作为文件引用放入提示词；按 Enter 提交后 Claude 会读取图片');
    }
    else {
      const data = shortcut === 'alt' ? '\u001bv' : '\u0016';
      targetSocket.send(JSON.stringify({ type: 'input', data }));
    }
    terminal.focus();
    return;
  }
  if (shortcut === 'alt') {
    targetSocket.send(JSON.stringify({ type: 'input', data: '\u001bv' }));
    terminal.focus();
    return;
  }
  const files = Array.isArray(payload.files) ? payload.files.map(quoteWindowsPath).filter(Boolean) : [];
  const text = files.length ? files.join(' ') : String(payload.text || '');
  if (text) terminal.paste(text);
  terminal.focus();
}

function fitTerminal() {
  if (!fitAddon || workspace.hidden) return;
  try {
    fitAddon.fit();
    const size = `${terminal.cols}x${terminal.rows}`;
    if (socket?.readyState === WebSocket.OPEN && size !== lastTerminalPtySize) {
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      lastTerminalPtySize = size;
    }
  } catch {}
}

function scheduleTerminalReconnect(session) {
  if (terminalReconnectTimer || !terminalSessionAlive || activeSession?.id !== session.id) return;
  terminalReconnectAttempts += 1;
  const delay = Math.min(1000 * (2 ** Math.min(terminalReconnectAttempts - 1, 4)), 15000);
  $('#terminalState').textContent = `连接断开，${Math.ceil(delay / 1000)} 秒后重试`;
  $('#terminalLed').classList.remove('live');
  terminalReconnectTimer = setTimeout(() => {
    terminalReconnectTimer = null;
    if (terminalSessionAlive && activeSession?.id === session.id) connectTerminal(session, { reconnecting: true });
  }, delay);
}

function connectTerminal(session, { reconnecting = false } = {}) {
  clearTimeout(terminalReconnectTimer);
  terminalReconnectTimer = null;
  if (!reconnecting) terminalReconnectAttempts = 0;
  ensureTerminal();
  activeSession = session;
  terminalSessionAlive = true;
  const generation = ++terminalConnectionGeneration;
  lastTerminalPtySize = '';
  if (!reconnecting) {
    projectPath = session.projectPath;
    localStorage.setItem(projectKey, projectPath);
    updateProjectLabels();
    refreshProjects().catch(() => {});
    refreshTree().catch(error => toast(error.message));
  }
  terminal.reset();
  terminalCursorVisibilityPending = '';
  terminal.write('\u001b[?25l');
  $('#terminalEmpty').hidden = true;
  $('#terminalTitle').textContent = projectName(session.projectPath);
  $('#terminalSubtitle').textContent = session.projectPath;
  $('#terminalState').textContent = reconnecting ? '正在重新连接…' : '连接中…';
  $('#terminalLed').classList.remove('live');
  $('#closeSession').disabled = false;
  $('#stopSession').disabled = false;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const endpoint = `${protocol}//${location.host}/api/workspace/terminal?session=${encodeURIComponent(session.id)}`;
  socket?.close();
  const connection = new WebSocket(endpoint);
  socket = connection;
  connection.onopen = () => {
    if (generation !== terminalConnectionGeneration || socket !== connection) return;
    fitTerminal();
    terminal.focus();
  };
  connection.onmessage = event => {
    if (generation !== terminalConnectionGeneration || socket !== connection || activeSession?.id !== session.id) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'ready') {
      terminal.write(suppressCursorVisibility(message.data), () => {
        if (generation !== terminalConnectionGeneration || socket !== connection
          || connection.readyState !== WebSocket.OPEN || message.status !== 'running') return;
        // The server replays a bounded raw ANSI tail, which may begin mid-frame.
        // Ctrl+L asks Claude to redraw the complete screen, preserving the draft.
        if (terminal.modes.mouseTrackingMode !== 'none') terminal.input('\u000c');
      });
      terminalSessionAlive = message.status === 'running';
      if (terminalSessionAlive) {
        terminalReconnectAttempts = 0;
        $('#terminalState').textContent = '运行中';
        $('#terminalLed').classList.add('live');
      } else {
        $('#terminalState').textContent = 'Claude 会话已结束';
        $('#terminalLed').classList.remove('live');
        $('#stopSession').disabled = true;
      }
    } else if (message.type === 'data') terminal.write(suppressCursorVisibility(message.data));
    else if (message.type === 'exit') {
      terminalSessionAlive = false;
      clearTimeout(terminalReconnectTimer);
      terminalReconnectTimer = null;
      $('#terminalState').textContent = `已结束（${message.exitCode ?? '—'}）`;
      $('#terminalLed').classList.remove('live');
      $('#stopSession').disabled = true;
      refreshSessions().catch(() => {});
    }
  };
  connection.onerror = () => {
    if (generation === terminalConnectionGeneration && socket === connection && activeSession?.id === session.id) {
      $('#terminalState').textContent = '终端连接异常，正在恢复…';
    }
  };
  connection.onclose = () => {
    if (generation !== terminalConnectionGeneration || socket !== connection || activeSession?.id !== session.id) return;
    if (terminalSessionAlive) scheduleTerminalReconnect(session);
    else $('#terminalState').textContent = 'Claude 会话已结束';
  };
  refreshSessions().catch(() => {});
}

async function startSession(mode, saved = null) {
  if (!projectPath) return toast('先选择项目文件夹');
  try {
    const body = { projectPath, mode, name: mode === 'resume' ? saved?.name : '' };
    if (saved?.id) body.workbenchSessionId = saved.id;
    if (mode === 'resume') body.sessionId = saved?.sessionId;
    const session = await api('/api/workspace/session', { method: 'POST', body });
    connectTerminal(session);
    $('#terminalEmpty').hidden = true;
    Promise.all([refreshProjects(), refreshSessions()]).catch(() => {});
  } catch (error) { toast(error.message); }
}

async function continueLastConversation() {
  if (!projectPath) return toast('先选择项目文件夹');
  const latest = [...projectSessions].sort((a, b) => String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt)))[0];
  if (latest?.status === 'running') return connectTerminal(latest);
  if (latest?.sessionId) return startSession('resume', latest);
  return startSession(latest?.mode === 'picker' ? 'picker' : 'continue', latest || null);
}

async function openSavedSession(session) {
  if (!session) return;
  await activateProject(session.projectPath);
  if (session.status === 'running') return connectTerminal(session);
  if (session.sessionId) return startSession('resume', session);
  return startSession(session.mode === 'picker' ? 'picker' : 'continue', session);
}

function closeCurrentSession() {
  if (!activeSession) return;
  const session = activeSession;
  clearTimeout(terminalReconnectTimer);
  terminalReconnectTimer = null;
  terminalReconnectAttempts = 0;
  terminalSessionAlive = false;
  socket?.close();
  socket = null;
  activeSession = null;
  terminal?.reset();
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

function interruptCurrentSession() {
  if (!activeSession || socket?.readyState !== WebSocket.OPEN) {
    toast('当前没有连接中的 Claude 会话');
    return;
  }
  socket.send(JSON.stringify({ type: 'input', data: '\u001b' }));
  terminal?.focus();
  toast('已发送 Esc，用于停止 Claude 当前回复或工具操作');
}

function toggleComposer() {
  composerVisible = !composerVisible;
  $('#terminalComposer').hidden = !composerVisible;
  $('#toggleComposer').setAttribute('aria-expanded', String(composerVisible));
  if (composerVisible) requestAnimationFrame(() => { $('#composerInput').focus(); fitTerminal(); });
  else requestAnimationFrame(() => fitTerminal());
}

async function removeSession(id) {
  const result = await api('/api/workspace/session/remove', { method: 'POST', body: { id } });
  if (activeSession?.id === id) {
    clearTimeout(terminalReconnectTimer);
    terminalReconnectTimer = null;
    terminalReconnectAttempts = 0;
    terminalSessionAlive = false;
    socket?.close();
    socket = null;
    activeSession = null;
    terminal?.reset();
    $('#terminalEmpty').hidden = false;
    $('#terminalState').textContent = '已从工作台移除；Claude 原始记录保留';
    $('#terminalLed').classList.remove('live');
    $('#closeSession').disabled = true;
    $('#stopSession').disabled = true;
  }
  await refreshSessions();
  toast(result.transcriptPreserved ? '已从工作台移除，Claude 对话记录保留' : '这条对话已不在工作台列表中');
}

function setupWorkspace() {
  setInterval(() => {
    if (!workspace.hidden) refreshSessionStatuses().catch(() => {});
  }, 3000);
  const refreshVisibleFiles = () => {
    if (document.hidden || workspace.hidden || workspace.classList.contains('files-collapsed')
      || !projectPath || fileTreeRefreshJob || fileTreeDragging || !$('#fileTreeContextMenu').hidden
      || Date.now() - fileTreeInteractionAt < 1500) return;
    refreshTree().catch(() => {});
  };
  setInterval(refreshVisibleFiles, 5000);
  window.addEventListener('focus', refreshVisibleFiles);
  $('#fileTree').addEventListener('pointerdown', () => { fileTreeInteractionAt = Date.now(); });
  $('#refreshFiles').addEventListener('click', () => {
    refreshTree().then(() => toast('文件列表已刷新')).catch(error => toast(error.message));
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('.nav-btn').forEach(button => button.addEventListener('click', () => setView('management')));
  $('#railToggle').addEventListener('click', () => {
    const collapsed = document.querySelector('.shell').classList.toggle('nav-collapsed');
    localStorage.setItem('claude-workbench-nav-collapsed', collapsed ? '1' : '0');
    $('#railToggle').title = collapsed ? '展开侧栏' : '收起侧栏';
    $('#railToggle').textContent = collapsed ? '›' : '‹';
    requestAnimationFrame(() => fitTerminal());
  });
  $('#collapseSessions').addEventListener('click', () => { workspace.classList.toggle('sessions-collapsed'); requestAnimationFrame(() => fitTerminal()); });
  const toggleFiles = () => { workspace.classList.toggle('files-collapsed'); requestAnimationFrame(() => fitTerminal()); };
  $('#collapseFiles').addEventListener('click', toggleFiles);
  $('#toggleFiles').addEventListener('click', toggleFiles);
  $('#chooseProject').addEventListener('click', selectProject);
  $('#chooseProjectEmpty').addEventListener('click', selectProject);
  $('#toggleMoreProjects').addEventListener('click', () => {
    projectsExpanded = !projectsExpanded;
    localStorage.setItem(projectsExpandedKey, projectsExpanded ? '1' : '0');
    renderProjects();
  });
  $('#hideProjectFromList').addEventListener('click', () => hideProjectFromList().catch(error => toast(error.message)));
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
  $('#newSession').addEventListener('click', () => startSession('new'));
  $('#newSessionEmpty').addEventListener('click', () => startSession('new'));
  $('#continueSession').addEventListener('click', continueLastConversation);
  $('#refreshSessions').addEventListener('click', () => refreshSessions().catch(error => toast(error.message)));
  $('#clearTerminal').addEventListener('click', () => {
    if (!activeSession || socket?.readyState !== WebSocket.OPEN) return toast('当前没有连接中的 Claude 会话');
    socket.send(JSON.stringify({ type: 'input', data: '\u000c' }));
    terminal?.focus();
    toast('已请求 Claude Code 重绘终端；输入和对话内容会保留');
  });
  $('#toggleComposer').addEventListener('click', toggleComposer);
  $('#clearComposer').addEventListener('click', () => {
    $('#composerInput').value = '';
    composerAttachments = [];
    renderComposerAttachments();
    $('#composerInput').focus();
  });
  $('#sendComposer').addEventListener('click', sendComposerToTerminal);
  $('#openPromptManager').addEventListener('click', openPromptManager);
  $('#closePromptManager').addEventListener('click', closePromptManager);
  $('#promptManagerBackdrop').addEventListener('click', event => {
    if (event.target === $('#promptManagerBackdrop')) closePromptManager();
  });
  document.querySelectorAll('[data-prompt-tab]').forEach(button => button.addEventListener('click', () => setPromptManagerTab(button.dataset.promptTab)));
  $('#promptUseTerminalSelection').addEventListener('click', () => {
    const selected = terminal?.getSelection()?.trim() || '';
    if (!selected) return toast('先用鼠标在 CLI 里选中一段文字');
    $('#promptSourceContent').value = selected;
    $('#promptSourceContent').focus();
    toast('已取用终端选中的文字');
  });
  $('#promptTemplateSelect').addEventListener('change', () => {
    const item = promptLibraryItems.find(prompt => prompt.id === $('#promptTemplateSelect').value);
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
  $('#closeSession').addEventListener('click', closeCurrentSession);
  $('#toggleWorkspaceTheme').addEventListener('click', () => {
    workspaceDark = !workspaceDark;
    // 持久化失败时静默：主题仍在当前会话生效
    try { localStorage.setItem(themeKey, workspaceDark ? 'dark' : 'light'); } catch { /* 忽略写入异常 */ }
    applyWorkspaceTheme();
  });
  $('#terminalZoomOut').addEventListener('click', () => setTerminalFontSize(terminalFontSize - 1));
  $('#terminalZoomIn').addEventListener('click', () => setTerminalFontSize(terminalFontSize + 1));
  $('#terminalZoomLevel').addEventListener('click', () => setTerminalFontSize(12));
  setTerminalFontSize(terminalFontSize);
  $('#stopSession').addEventListener('click', interruptCurrentSession);
  const navCollapsed = localStorage.getItem('claude-workbench-nav-collapsed') === '1';
  document.querySelector('.shell').classList.toggle('nav-collapsed', navCollapsed);
  if (navCollapsed) { $('#railToggle').textContent = '›'; $('#railToggle').title = '展开侧栏'; }
  updateProjectLabels();
  setView(localStorage.getItem(viewKey) === 'workspace' ? 'workspace' : 'management');
}

setupWorkspace();
