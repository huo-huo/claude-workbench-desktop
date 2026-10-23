import { $, escapeHtml } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';
import { quoteWindowsPath } from './terminal.mjs';
import { insertComposerText, toggleComposer } from './composer.mjs';

export function showFileTreeContextMenu(event, button) {
  event.preventDefault();
  event.stopPropagation();
  selectTreeRow(button);
  app.fileTreeContextTarget = { path: button.dataset.treePath, type: button.dataset.treeType, projectPath: app.projectPath };
  const menu = $('#fileTreeContextMenu');
  $('#fileTreeRevealPath').textContent = '在文件夹中显示';
  $('#fileTreeRecycle').disabled = !app.fileTreeContextTarget.path || app.fileTreeContextTarget.path === '.';
  const menuWidth = 190;
  menu.hidden = false;
  const menuHeight = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))}px`;
}

export function closeFileTreeContextMenu() {
  $('#fileTreeContextMenu').hidden = true;
  app.fileTreeContextTarget = { path: '', type: '' };
}

export function absoluteWorkspacePath(relativePath) {
  const root = app.projectPath.replace(/[\\/]+$/, '');
  const relative = String(relativePath || '.').replace(/[\\/]/g, '\\');
  if (!relative || relative === '.') return root;
  if (/^[A-Za-z]:\\|^\\\\/.test(relative)) return relative;
  return `${root}\\${relative.replace(/^\\+/, '')}`;
}

export async function copyWorkspacePath(relativePath) {
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

export function addWorkspacePathToConversation(relativePath) {
  const value = quoteWindowsPath(absoluteWorkspacePath(relativePath));
  if (app.composerVisible) {
    insertComposerText(value);
    toast('文件路径已添加到输入框；点击“发送到 Claude”发送');
    return;
  }
  if (app.activeSession && app.socket?.readyState === WebSocket.OPEN && app.terminal) {
    app.terminal.paste(value);
    app.terminal.focus();
    toast('文件路径已放入 CLI 输入框；按 Enter 发送');
    return;
  }
  toggleComposer();
  insertComposerText(value);
  toast('文件路径已放入输入框；打开对话后可发送');
}

export async function runFileTreeContextAction(action) {
  const target = app.fileTreeContextTarget;
  closeFileTreeContextMenu();
  if (!target.path) return;
  if (action === 'reveal') {
    await revealTreeItem(target).catch(error => toast(error.message));
    return;
  }
  if (action === 'recycle') {
    try {
      await api('/api/workspace/recycle', { method: 'POST', body: { projectPath: target.projectPath, path: target.path } });
      if (app.projectPath === target.projectPath) {
        if (app.selectedFile === target.path) app.selectedFile = '';
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

export function findTreeRow(itemPath, type) {
  const normalize = value => String(value || '.').replace(/[\\/]+/g, '/').replace(/^\.\//, '').replace(/\/$/, '') || '.';
  const normalizedPath = normalize(itemPath);
  return [...document.querySelectorAll('[data-tree-path]')].find(row =>
    row.dataset.treeType === type && normalize(row.dataset.treePath) === normalizedPath,
  );
}

export async function openTreeFolder(button) {
  const children = button?.parentElement.querySelector(':scope > .tree-children');
  if (!button || !children || !await loadTreeFolder(button, children)) return false;
  children.classList.remove('closed');
  button.querySelector('.tree-caret').textContent = '⌄';
  return true;
}

export function selectTreeRow(button) {
  app.selectedFile = button.dataset.treePath;
  document.querySelectorAll('.tree-row.selected').forEach(row => row.classList.remove('selected'));
  button.classList.add('selected');
  button.scrollIntoView({ block: 'nearest' });
}

export async function revealTreeItem(target) {
  await api('/api/workspace/reveal-file', { method: 'POST', body: { projectPath: target.projectPath || app.projectPath, path: target.path } });
  toast('已打开所在文件夹，并选中对应项目');
}


export function queryPath(path) {
  return `/api/workspace/files?projectPath=${encodeURIComponent(app.projectPath)}&path=${encodeURIComponent(path || '.')}`;
}

export function treeMarkup(item, root = false) {
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
  return `<div class="tree-node" data-tree-node="${escapeHtml(path)}"><button class="tree-row ${app.selectedFile === path ? 'selected' : ''}" data-tree-path="${escapeHtml(path)}" data-tree-type="${item.type}" data-tree-loaded="${children ? '1' : '0'}" data-tree-verified="${childrenVerified ? '1' : '0'}"${isFolder ? '' : ' draggable="true"'}><span class="tree-caret" aria-hidden="true">${isFolder ? (root ? '⌄' : '▸') : ''}</span>${leadingIcon}<span class="tree-name">${escapeHtml(item.name)}</span></button>${folderContents}</div>`;
}

export function iconFor(extension = '') {
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

export async function refreshTree({ force = false } = {}) {
  if (!app.projectPath) return;
  const root = app.projectPath;
  if (!force && app.fileTreeRefreshJob?.project === root) return app.fileTreeRefreshJob.promise;
  const job = { project: root, promise: null };
  app.fileTreeRefreshJob = job;
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
      if (app.fileTreeRefreshJob !== job || app.projectPath !== root) return;
      const folder = nodes.get(itemPath);
      if (folder?.type === 'folder' && !Array.isArray(folder.children)) {
        folder.children = (await api(url(itemPath))).children || [];
        index(folder);
      }
    }
    if (app.fileTreeRefreshJob !== job || app.projectPath !== root) return;
    // A user opening/collapsing a branch while fetching takes precedence.
    if (JSON.stringify(expandedPaths()) !== JSON.stringify(expanded)) return;
    const signature = root + '\n' + JSON.stringify(tree);
    if (hadTree && signature === app.fileTreeSignature) return;
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
    app.fileTreeSignature = signature;
  })().finally(() => {
    if (app.fileTreeRefreshJob === job) {
      app.fileTreeRefreshJob = null;
      $('#refreshFiles').disabled = false;
    }
  });
  return job.promise;
}

export async function toggleTreeFolder(button) {
  const children = button.parentElement.querySelector(':scope > .tree-children');
  if (!children) return;
  if (children.classList.contains('closed')) await openTreeFolder(button);
  else {
    children.classList.add('closed');
    button.querySelector('.tree-caret').textContent = '▸';
  }
}

export function wireTree() {
  document.querySelectorAll('[data-tree-path]').forEach(button => {
    button.ondragstart = event => {
      if (button.dataset.treeType === 'folder' || !event.dataTransfer) { event.preventDefault(); return; }
      app.fileTreeDragging = true;
      const relative = button.dataset.treePath.replace(/[\\/]/g, '\\');
      const root = app.projectPath.replace(/[\\/]+$/, '');
      const absolute = `${root}\\${relative}`;
      const quoted = /\s/.test(absolute) ? `"${absolute.replaceAll('"', '\\"')}"` : absolute;
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('text/plain', quoted);
      try { event.dataTransfer.setData('application/x-claude-workbench-file', absolute); } catch {}
    };
    button.ondragend = () => { app.fileTreeDragging = false; };
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

export async function loadTreeFolder(button, children) {
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

export async function openProjectFile(filePath) {
  const now = Date.now();
  const key = app.projectPath + '\n' + filePath;
  if (app.lastFileOpen.path === key && now - app.lastFileOpen.at < 800) return;
  app.lastFileOpen = { path: key, at: now };
  await api('/api/workspace/open-file', { method: 'POST', body: { projectPath: app.projectPath, path: filePath } });
}
