/** 查询单个 DOM 元素 */
export const $ = selector => document.querySelector(selector);

/** 转义 HTML 特殊字符，供模板字符串安全插值 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
