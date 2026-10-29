import { $, escapeHtml } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';
import { projectName, updateProjectLabels } from './preferences.mjs';
import { saveWorkspaceSettings } from './settings.mjs';
import { refreshSessions } from './sessions.mjs';
import { refreshTree, resetFileTree } from './files.mjs';
import { closeViewer } from './viewer.mjs';

export async function refreshProjects() {
  const result = await api('/api/workspace/projects');
  app.projects = result.projects || [];
  if (!app.projectPath && app.projects.length) {
    app.projectPath = app.projects[0].path;
    saveWorkspaceSettings({ projectPath: app.projectPath });
  }
  renderProjects();
  updateProjectLabels();
}

export function renderProjects() {
  const list = $('#projectList');
  const toggle = $('#toggleMoreProjects');
  const selected = app.projects.find(item => item.path.toLowerCase() === app.projectPath.toLowerCase());
  let visible = app.projectsExpanded || app.projects.length <= 4 ? app.projects : app.projects.slice(0, 4);
  if (!app.projectsExpanded && app.projects.length > 4 && selected && !visible.some(item => item.path.toLowerCase() === selected.path.toLowerCase())) {
    visible = [...app.projects.slice(0, 3), selected];
  }
  list.classList.toggle('expanded', app.projectsExpanded);
  list.innerHTML = visible.length ? visible.map(item => `<button class="project-item ${item.path.toLowerCase() === app.projectPath.toLowerCase() ? 'active' : ''}" data-project-path="${escapeHtml(item.path)}" title="左键切换项目，右键可从列表隐藏"><span class="project-item-icon">▰</span><span>${escapeHtml(item.name)}</span></button>`).join('') : '<div class="empty">添加项目文件夹后显示在这里</div>';
  toggle.hidden = app.projects.length <= 4;
  if (!toggle.hidden) toggle.textContent = app.projectsExpanded ? '收起项目' : `显示更多项目（${app.projects.length - visible.length}）`;
  document.querySelectorAll('[data-project-path]').forEach(button => {
    button.onclick = () => activateProject(button.dataset.projectPath);
    button.oncontextmenu = event => showProjectContextMenu(event, button.dataset.projectPath);
  });
}

export function showProjectContextMenu(event, path) {
  event.preventDefault();
  app.contextProjectPath = path;
  const menu = $('#projectContextMenu');
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 178))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - 48))}px`;
}

export function closeProjectContextMenu() {
  $('#projectContextMenu').hidden = true;
  app.contextProjectPath = '';
}


export async function hideProjectFromList() {
  const path = app.contextProjectPath;
  closeProjectContextMenu();
  if (!path) return;
  const result = await api('/api/workspace/project/hide', { method: 'POST', body: { path } });
  if (!result.hidden) return toast('这个项目已经不在列表里了');
  if (app.projectPath.toLowerCase() === path.toLowerCase()) {
    const next = app.projects.find(item => item.path.toLowerCase() !== path.toLowerCase());
    app.projectPath = next?.path || '';
    saveWorkspaceSettings({ projectPath: app.projectPath });
    app.selectedFile = '';
  }
  await refreshProjects();
  await refreshSessions();
  if (app.projectPath) await refreshTree();
  else $('#fileTree').innerHTML = '<div class="empty">选择项目文件夹后显示文件</div>';
  toast('已从项目列表隐藏；文件和对话历史都保留');
}

export async function activateProject(path) {
  app.projectPath = path;
  closeViewer();
  // 立即清空文件栏：旧目录的树若残留，双击会用旧路径拼新项目根导致打开失败
  resetFileTree();
  saveWorkspaceSettings({ projectPath: app.projectPath });
  app.selectedFile = '';
  await refreshProjects();
  updateProjectLabels();
  await Promise.all([refreshTree(), refreshSessions()]);
  if (!app.activeSession) {
    $('#terminalTitle').textContent = projectName(app.projectPath);
    $('#terminalSubtitle').textContent = app.projectPath;
  }
}


export async function selectProject() {
  const button = $('#chooseProject');
  button.disabled = true;
  try {
    const result = await api('/api/workspace/select-folder', { method: 'POST', body: {} });
    if (!result.projectPath) return;
    app.projectPath = result.projectPath;
    closeViewer();
    resetFileTree();
    saveWorkspaceSettings({ projectPath: app.projectPath });
    app.selectedFile = '';
    updateProjectLabels();
    await Promise.all([refreshProjects(), refreshSessions(), refreshTree()]);
    $('#terminalTitle').textContent = app.projectPath.split(/[\\/]/).filter(Boolean).at(-1);
    $('#terminalSubtitle').textContent = app.projectPath;
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

