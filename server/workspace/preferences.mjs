// 工作区界面设置的纯校验逻辑；存储读写由 server/workspace/state.mjs 负责
const THEMES = new Set(['dark', 'light']);
const VIEWS = new Set(['management', 'workspace']);

/** 布尔型设置字段，缺省由前端决定 */
const BOOLEAN_KEYS = new Set([
  'projectsExpanded', 'composerVisible', 'sessionsCollapsed', 'filesCollapsed',
  'statuslineVisible', 'toolbarVisible', 'navCollapsed',
]);

/** 校验并规范化状态栏配置：字号 10-14，显示项只能是布尔值 */
function normalizeStatusline(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('statusline 必须是对象');
  const result = {};
  if (value.fontSize !== undefined) {
    const size = Number(value.fontSize);
    if (!Number.isFinite(size) || size < 10 || size > 14) throw new Error('statusline.fontSize 必须在 10-14 之间');
    result.fontSize = Math.round(size);
  }
  if (value.items !== undefined) {
    if (!value.items || typeof value.items !== 'object' || Array.isArray(value.items)) throw new Error('statusline.items 必须是对象');
    const entries = Object.entries(value.items);
    if (entries.length > 64) throw new Error('statusline.items 最多 64 项');
    const items = {};
    for (const [key, enabled] of entries) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 64) throw new Error('statusline.items 的键名无效');
      if (typeof enabled !== 'boolean') throw new Error(`statusline.items.${key} 必须是布尔值`);
      items[key] = enabled;
    }
    result.items = items;
  }
  return result;
}

/**
 * 把部分设置合并到现有设置上。
 * 未知字段进入 ignored，非法字段抛出可读错误，保证调用方不会产生部分写入。
 */
export function normalizePreferences(patch, current = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置必须是对象');
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const next = { ...base };
  const ignored = [];
  for (const [key, value] of Object.entries(patch)) {
    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') throw new Error(`${key} 必须是布尔值`);
      next[key] = value;
      continue;
    }
    switch (key) {
      case 'theme':
        if (!THEMES.has(value)) throw new Error('theme 只能是 dark 或 light');
        next.theme = value;
        break;
      case 'view':
        if (!VIEWS.has(value)) throw new Error('view 只能是 management 或 workspace');
        next.view = value;
        break;
      case 'terminalFontSize': {
        const size = Number(value);
        if (!Number.isFinite(size) || size < 10 || size > 24) throw new Error('terminalFontSize 必须在 10-24 之间');
        next.terminalFontSize = Math.round(size);
        break;
      }
      case 'projectPath':
        if (typeof value !== 'string' || value.length > 32767) throw new Error('projectPath 必须是字符串');
        next.projectPath = value;
        break;
      case 'collapsedProjects':
        if (!Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string' || item.length > 4096)) {
          throw new Error('collapsedProjects 必须是字符串数组，单条不超过 4096 字符');
        }
        next.collapsedProjects = [...new Set(value)];
        break;
      case 'statusline':
        next.statusline = normalizeStatusline(value);
        break;
      default:
        ignored.push(key);
    }
  }
  return { preferences: next, ignored };
}

/**
 * 逐字段清洗已保存的设置：单个字段损坏时只丢弃该字段，保留其他合法值。
 * 用于读取文件与写入前清洗现有配置，避免一格非法导致整份设置被清空。
 */
export function sanitizePreferences(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result = {};
  for (const [key, value] of Object.entries(raw)) {
    try {
      const { preferences } = normalizePreferences({ [key]: value }, {});
      if (Object.prototype.hasOwnProperty.call(preferences, key)) result[key] = preferences[key];
    } catch { /* 单个字段非法时跳过 */ }
  }
  return result;
}
