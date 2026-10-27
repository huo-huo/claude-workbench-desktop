/** 状态栏字号范围：可读性下限 10px，上限 14px */
export const STATUSLINE_FONT_RANGE = { min: 10, max: 14, default: 10 };

/** 默认隐藏的状态栏单元：与同类计数重复，用户可在配置面板重新开启 */
export const DEFAULT_HIDDEN_STATUSLINE_ITEMS = new Set(['mcpConfig']);

/** 把任意输入夹紧到状态栏字号范围 */
export function clampStatuslineFontSize(size) {
  const value = Number(size);
  if (!Number.isFinite(value)) return STATUSLINE_FONT_RANGE.default;
  return Math.max(STATUSLINE_FONT_RANGE.min, Math.min(STATUSLINE_FONT_RANGE.max, Math.round(value)));
}

/** 归一化持久化配置：旧版 8px 字号会被夹到 10px */
export function normalizeStatuslineConfig(raw) {
  const fallback = { fontSize: STATUSLINE_FONT_RANGE.default, items: {} };
  if (!raw || typeof raw !== 'object') return fallback;
  return {
    fontSize: clampStatuslineFontSize(raw.fontSize),
    items: raw.items && typeof raw.items === 'object' ? raw.items : {},
  };
}

/** 单个状态栏单元是否启用；未显式配置时，重复项默认隐藏 */
export function statuslineItemEnabled(items, key) {
  if (items?.[key] === false) return false;
  if (items?.[key] === undefined && DEFAULT_HIDDEN_STATUSLINE_ITEMS.has(key)) return false;
  return true;
}
