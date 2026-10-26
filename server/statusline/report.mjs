import { recordStatusline } from './store.mjs';

/** statusLine 转发体上限（序列化后字符数） */
const MAX_REPORT_BYTES = 256 * 1024;

/**
 * 处理包装器转发的 statusLine JSON：写入会话 store 后返回确认。
 * 非法 JSON 由路由层统一按 400 处理；超限按 413 拒绝。
 */
export function handleStatuslineReport(body) {
  if (JSON.stringify(body ?? '').length > MAX_REPORT_BYTES) {
    const error = new Error('statusline 数据超过 256 KB');
    error.statusCode = 413;
    throw error;
  }
  recordStatusline(body);
  return { status: 200, body: { ok: true } };
}
