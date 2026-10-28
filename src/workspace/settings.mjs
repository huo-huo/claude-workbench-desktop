import { app } from './state.mjs';
import { toast } from './core/api.mjs';
import { createSettingsManager } from './settings-data.mjs';

/** 把服务端设置应用到全局 app；新字段统一在这里落地 */
function applyWorkspaceSettings(preferences) {
  app.workspaceDark = preferences.theme === 'dark';
  app.terminalFontSize = preferences.terminalFontSize;
  app.projectPath = preferences.projectPath;
  app.view = preferences.view;
  app.projectsExpanded = preferences.projectsExpanded;
  app.navCollapsed = preferences.navCollapsed;
  app.composerVisible = preferences.composerVisible;
  app.sessionsCollapsed = preferences.sessionsCollapsed;
  app.filesCollapsed = preferences.filesCollapsed;
  app.statuslineVisible = preferences.statuslineVisible;
  app.toolbarVisible = preferences.toolbarVisible;
  app.collapsedProjects = preferences.collapsedProjects;
  // 让已初始化的模块（如状态栏字号）在设置加载后重新应用
  window.dispatchEvent(new CustomEvent('workspace-settings-applied', { detail: preferences }));
}

const manager = createSettingsManager({
  fetchImpl: (...args) => fetch(...args),
  storage: localStorage,
  onApply: applyWorkspaceSettings,
  onError: message => toast(message),
});

// 关闭窗口或刷新前把待写入的设置尽量送达，减少随机端口带来的丢失
window.addEventListener('pagehide', () => { void manager.flush(); });

/** 启动时加载服务端设置；失败时自动降级本地缓存 */
export function loadWorkspaceSettings() {
  return manager.load();
}

/** 修改设置：立即写本地缓存，并合并为一次服务端写入 */
export function saveWorkspaceSettings(patch) {
  return manager.save(patch);
}

/** 读取当前设置快照 */
export function getWorkspaceSettings() {
  return manager.get();
}
