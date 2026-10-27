// 工作区共享状态；字段名与拆分前的模块级变量保持一致，便于逐函数对照迁移
export const app = {
  workspace: document.querySelector('#workspace'),
  terminalHost: document.querySelector('#terminalHost'),
  projectPath: localStorage.getItem('claude-workbench-project-path') || '',
  workspaceDark: localStorage.getItem('claude-workbench-workspace-theme') === 'dark',
  projectsExpanded: localStorage.getItem('claude-workbench-projects-expanded') === '1',
  activeSession: null,
  socket: null,
  terminalReconnectTimer: null,
  terminalReconnectAttempts: 0,
  terminalConnectionGeneration: 0,
  terminalSessionAlive: false,
  terminal: null,
  fitAddon: null,
  lastTerminalPtySize: '',
  terminalCursorVisibilityPending: '',
  composerVisible: false,
  composerAttachments: [],
  promptLibraryItems: [],
  promptEditingId: '',
  terminalFontSize: Number(localStorage.getItem('claude-workbench-terminal-font-size')) || 12,
  selectedFile: '',
  lastManagementCrumb: '运行概览',
  cachedSessions: [], // 主列表全量缓存;搜索过滤只重渲染这份数据,不发请求
  sessionSearch: '', // 搜索关键字;批量全选基于当前过滤结果
  bulkMode: false, // 批量管理模式:行首显示复选框
  bulkSelected: new Set(), // 批量模式勾选的会话 id;innerHTML 全量重建后据此恢复 checked
  projects: [],
  lastFileOpen: { path: '', at: 0 },
  fileTreeRefreshJob: null,
  fileTreeSignature: '',
  fileTreeInteractionAt: 0,
  fileTreeDragging: false,
  contextProjectPath: '',
  fileTreeContextTarget: { path: '', type: '' },
  sessionActivityMonitors: new Map(),
  sessionActivityStates: new Map(),
};

// localStorage 键；与拆分前保持一致
export const keys = {
  projectPath: 'claude-workbench-project-path',
  view: 'claude-workbench-view',
  theme: 'claude-workbench-workspace-theme',
  terminalFontSize: 'claude-workbench-terminal-font-size',
  projectsExpanded: 'claude-workbench-projects-expanded',
  collapsedProjects: 'claude-workbench-collapsed-projects',
};
