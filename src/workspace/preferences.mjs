import { $ } from './core/dom.mjs';
import { app } from './state.mjs';
import { getWorkspaceSettings, saveWorkspaceSettings } from './settings.mjs';

/** 从项目路径提取显示名称 */
export function projectName(path) {
  return String(path || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) || '未命名项目';
}

/** 格式化会话时间 */
export function formatSessionTime(value) {
  return new Date(value || Date.now()).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/** 会话分组 key：统一斜杠、去掉尾部斜杠、转小写；空路径返回空字符串 */
export function sessionGroupKey(path) {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** 读取折叠的项目 key；统一设置尚未加载时回退空数组 */
export function readCollapsedProjects() {
  const value = getWorkspaceSettings().collapsedProjects;
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

/** 写入折叠的项目 key（去重，保持顺序）；持久化失败由设置管理器提示 */
export function writeCollapsedProjects(nextKeys) {
  saveWorkspaceSettings({ collapsedProjects: [...new Set(nextKeys)] });
}

/** 同步项目标签与空状态文案 */
export function updateProjectLabels() {
  const label = app.projectPath || '选择 Claude Code 项目文件夹';
  $('#projectPath').textContent = label;
  $('#workspaceProjectIndicator').textContent = app.projectPath ? app.projectPath.split(/[\\/]/).filter(Boolean).at(-1) : '未选择项目';
  $('#workspaceProjectIndicator').title = app.projectPath;
  updateTerminalEmptyState();
}

/** 根据是否已选择项目切换空状态提示 */
export function updateTerminalEmptyState() {
  const hasProject = Boolean(app.projectPath);
  const projectName = app.projectPath.split(/[\\/]/).filter(Boolean).at(-1) || '';
  $('#terminalEmptyTitle').textContent = hasProject ? `已打开：${projectName}` : '在项目里开始工作';
  $('#terminalEmptyDescription').textContent = hasProject
    ? '这个项目已加入工作区。新建会话会在此文件夹中启动；点左侧记录可继续编辑。'
    : '先添加一个项目文件夹，再新建对话。对话会记录所属文件夹和创建时间。';
  $('#chooseProjectEmpty').textContent = hasProject ? '添加另一个项目' : '＋ 添加项目文件夹';
  $('#newSessionEmpty').hidden = !hasProject;
}

/** 设置终端字号并持久化；范围限制为 10-24px */
export function setTerminalFontSize(value, fitTerminal) {
  app.terminalFontSize = Math.max(10, Math.min(24, Math.round(Number(value) || 12)));
  saveWorkspaceSettings({ terminalFontSize: app.terminalFontSize });
  $('#terminalZoomLevel').textContent = `${app.terminalFontSize}px`;
  $('#terminalZoomOut').disabled = app.terminalFontSize <= 10;
  $('#terminalZoomIn').disabled = app.terminalFontSize >= 24;
  if (app.terminal) {
    app.terminal.options.fontSize = app.terminalFontSize;
    requestAnimationFrame(() => fitTerminal());
  }
}
