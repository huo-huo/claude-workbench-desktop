// 设置数据的纯逻辑：本地缓存读写、字段归一化、加载/迁移/防抖写入管理器
// 不依赖 DOM，便于在 node --test 中直接验证

/** 设置默认值；与服务端白名单字段保持一致 */
export const DEFAULT_PREFERENCES = {
  theme: 'light',
  terminalFontSize: 12,
  projectPath: '',
  view: 'management',
  projectsExpanded: false,
  collapsedProjects: [],
  navCollapsed: false,
  composerVisible: false,
  sessionsCollapsed: false,
  filesCollapsed: false,
  statuslineVisible: true,
  toolbarVisible: true,
  viewerWrap: false,
  statusline: { fontSize: 10, items: {} },
};

/** 旧 localStorage 键；新字段沿用同一命名风格 */
export const STORAGE_KEYS = {
  theme: 'claude-workbench-workspace-theme',
  terminalFontSize: 'claude-workbench-terminal-font-size',
  projectPath: 'claude-workbench-project-path',
  view: 'claude-workbench-view',
  projectsExpanded: 'claude-workbench-projects-expanded',
  collapsedProjects: 'claude-workbench-collapsed-projects',
  navCollapsed: 'claude-workbench-nav-collapsed',
  composerVisible: 'claude-workbench-composer-visible',
  sessionsCollapsed: 'claude-workbench-sessions-collapsed',
  filesCollapsed: 'claude-workbench-files-collapsed',
  statuslineVisible: 'claude-workbench-statusline-visible',
  toolbarVisible: 'claude-workbench-toolbar-visible',
  viewerWrap: 'claude-workbench-viewer-wrap',
  statusline: 'claude-workbench-statusline-config',
};

/** 只返回本地缓存中实际保存过的字段，便于判断是否需要首次迁移 */
export function readStoredPreferences(storage = globalThis.localStorage) {
  const result = {};
  const get = key => {
    try { return storage.getItem(key); } catch { return null; }
  };
  const theme = get(STORAGE_KEYS.theme);
  if (theme === 'dark' || theme === 'light') result.theme = theme;
  const fontSize = Number(get(STORAGE_KEYS.terminalFontSize));
  if (Number.isFinite(fontSize) && fontSize >= 10 && fontSize <= 24) result.terminalFontSize = fontSize;
  const projectPath = get(STORAGE_KEYS.projectPath);
  if (typeof projectPath === 'string' && projectPath) result.projectPath = projectPath;
  const view = get(STORAGE_KEYS.view);
  if (view === 'management' || view === 'workspace') result.view = view;
  const expanded = get(STORAGE_KEYS.projectsExpanded);
  if (expanded === '1' || expanded === '0') result.projectsExpanded = expanded === '1';
  try {
    const collapsed = JSON.parse(get(STORAGE_KEYS.collapsedProjects) || 'null');
    if (Array.isArray(collapsed)) result.collapsedProjects = collapsed.filter(item => typeof item === 'string');
  } catch { /* 忽略损坏的缓存值 */ }
  for (const key of ['navCollapsed', 'composerVisible', 'sessionsCollapsed', 'filesCollapsed', 'statuslineVisible', 'toolbarVisible', 'viewerWrap']) {
    const raw = get(STORAGE_KEYS[key]);
    if (raw === '1' || raw === '0') result[key] = raw === '1';
  }
  try {
    const statusline = JSON.parse(get(STORAGE_KEYS.statusline) || 'null');
    if (statusline && typeof statusline === 'object' && !Array.isArray(statusline)) result.statusline = statusline;
  } catch { /* 忽略损坏的缓存值 */ }
  return result;
}

/** 只把白名单字段写回本地缓存，作为启动降级来源 */
export function writeStoredPreferences(patch, storage = globalThis.localStorage) {
  const set = (key, value) => {
    try { storage.setItem(key, value); } catch { /* 缓存写入失败不影响界面 */ }
  };
  for (const [key, value] of Object.entries(patch || {})) {
    switch (key) {
      case 'theme': set(STORAGE_KEYS.theme, value === 'dark' ? 'dark' : 'light'); break;
      case 'terminalFontSize': set(STORAGE_KEYS.terminalFontSize, String(value)); break;
      case 'projectPath': set(STORAGE_KEYS.projectPath, String(value || '')); break;
      case 'view': set(STORAGE_KEYS.view, value); break;
      case 'projectsExpanded': set(STORAGE_KEYS.projectsExpanded, value ? '1' : '0'); break;
      case 'collapsedProjects': set(STORAGE_KEYS.collapsedProjects, JSON.stringify([...new Set(value || [])])); break;
      case 'statusline': set(STORAGE_KEYS.statusline, JSON.stringify(value || {})); break;
      case 'navCollapsed':
      case 'composerVisible':
      case 'sessionsCollapsed':
      case 'filesCollapsed':
      case 'statuslineVisible':
      case 'toolbarVisible':
      case 'viewerWrap':
        set(STORAGE_KEYS[key], value ? '1' : '0');
        break;
      default: break;
    }
  }
}

/** 合并默认值并夹紧范围，保证界面拿到可用设置 */
export function normalizeClientPreferences(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const preferences = { ...DEFAULT_PREFERENCES, ...source };
  preferences.theme = source.theme === 'dark' ? 'dark' : 'light';
  const fontSize = Number(source.terminalFontSize);
  preferences.terminalFontSize = Number.isFinite(fontSize) ? Math.max(10, Math.min(24, Math.round(fontSize))) : DEFAULT_PREFERENCES.terminalFontSize;
  preferences.projectPath = typeof source.projectPath === 'string' ? source.projectPath : '';
  preferences.view = source.view === 'workspace' ? 'workspace' : 'management';
  preferences.projectsExpanded = Boolean(source.projectsExpanded);
  preferences.navCollapsed = Boolean(source.navCollapsed);
  preferences.composerVisible = Boolean(source.composerVisible);
  preferences.sessionsCollapsed = Boolean(source.sessionsCollapsed);
  preferences.filesCollapsed = Boolean(source.filesCollapsed);
  preferences.statuslineVisible = source.statuslineVisible !== false;
  preferences.toolbarVisible = source.toolbarVisible !== false;
  preferences.viewerWrap = Boolean(source.viewerWrap);
  preferences.collapsedProjects = Array.isArray(source.collapsedProjects)
    ? source.collapsedProjects.filter(item => typeof item === 'string' && item.length <= 4096)
    : [];
  const statusline = source.statusline && typeof source.statusline === 'object' && !Array.isArray(source.statusline) ? source.statusline : {};
  const statuslineFont = Number(statusline.fontSize);
  const statuslineItems = statusline.items && typeof statusline.items === 'object' && !Array.isArray(statusline.items)
    ? Object.fromEntries(Object.entries(statusline.items).filter(([key, value]) => key.length <= 64 && typeof value === 'boolean').slice(0, 64))
    : {};
  preferences.statusline = {
    fontSize: Number.isFinite(statuslineFont) ? Math.max(10, Math.min(14, Math.round(statuslineFont))) : 10,
    items: statuslineItems,
  };
  return preferences;
}

/** 带超时的 Promise 包装，避免设置读取阻塞启动 */
function withTimeout(promise, timeoutMs, timers) {
  return new Promise((resolve, reject) => {
    const timer = timers.setTimeout(() => reject(new Error('读取设置超时')), timeoutMs);
    promise.then(value => {
      timers.clearTimeout(timer);
      resolve(value);
    }, error => {
      timers.clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * 创建设置管理器：load 读取服务端并在服务端为空时迁移本地缓存；
 * save 立即写缓存并合并为一次 POST；flush 用于测试或退出前强制写入。
 */
export function createSettingsManager({
  fetchImpl,
  storage = globalThis.localStorage,
  onApply = () => {},
  onError = () => {},
  timeoutMs = 1500,
  saveDelay = 300,
  // 原生 setTimeout 不能脱离 window 调用，这里统一包一层避免 Illegal invocation
  timers = { setTimeout: (handler, ms) => setTimeout(handler, ms), clearTimeout: id => clearTimeout(id) },
} = {}) {
  let current = null;
  let pending = {};
  let timer = null;

  const post = async patch => {
    const response = await fetchImpl('/api/workspace/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      // 页面卸载时也尽量把最后的设置送达
      keepalive: true,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || `设置保存失败（${response.status}）`);
    return payload?.preferences || {};
  };

  const get = () => {
    if (!current) current = normalizeClientPreferences(readStoredPreferences(storage));
    return current;
  };

  const load = async () => {
    const stored = readStoredPreferences(storage);
    let payload;
    try {
      payload = await withTimeout(
        fetchImpl('/api/workspace/preferences', { headers: { Accept: 'application/json' } })
          .then(response => {
            if (!response.ok) throw new Error(`设置读取失败（${response.status}）`);
            return response.json();
          }),
        timeoutMs,
        timers,
      );
    } catch (error) {
      current = normalizeClientPreferences(stored);
      onApply(current);
      onError(`未能从服务端读取设置，已使用本地缓存：${error.message}`);
      return { source: 'cache', error: error.message };
    }

    const serverPreferences = payload?.preferences;
    if (!serverPreferences || typeof serverPreferences !== 'object' || Array.isArray(serverPreferences)) {
      current = normalizeClientPreferences(stored);
      onApply(current);
      onError('服务端设置数据非法，已使用本地缓存');
      return { source: 'cache', error: 'invalid server preferences' };
    }

    if (Object.keys(serverPreferences).length === 0) {
      // 服务端为空：首次迁移本地缓存；没有可迁移内容时直接使用默认值
      if (Object.keys(stored).length === 0) {
        current = normalizeClientPreferences({});
        onApply(current);
        return { source: 'empty' };
      }
      // 迁移前先归一化，旧版 8px 字号等值会被夹到当前范围后才会被服务端接受
      current = normalizeClientPreferences(stored);
      try {
        await post(current);
        writeStoredPreferences(current, storage);
        onApply(current);
        return { source: 'migration' };
      } catch (error) {
        onApply(current);
        onError(`设置迁移失败，已继续使用本地缓存：${error.message}`);
        return { source: 'cache', error: error.message };
      }
    }

    current = normalizeClientPreferences(serverPreferences);
    writeStoredPreferences(current, storage);
    onApply(current);
    return { source: 'server' };
  };

  const flush = async () => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    const patch = pending;
    pending = {};
    if (Object.keys(patch).length === 0) return;
    try {
      await post(patch);
    } catch (error) {
      onError(`设置未保存：${error.message}`);
    }
  };

  const save = patch => {
    if (!patch || typeof patch !== 'object') return get();
    const base = normalizeClientPreferences(get());
    const merged = normalizeClientPreferences({ ...base, ...patch });
    // 只提交 patch 中出现的白名单字段，并采用归一化后的值，避免单个越界值拖垮整批写入
    const safePatch = {};
    for (const key of Object.keys(patch)) {
      if (Object.prototype.hasOwnProperty.call(DEFAULT_PREFERENCES, key)) safePatch[key] = merged[key];
    }
    current = { ...base, ...safePatch };
    writeStoredPreferences(safePatch, storage);
    Object.assign(pending, safePatch);
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      void flush();
    }, saveDelay);
    return current;
  };

  return { load, save, flush, get };
}
