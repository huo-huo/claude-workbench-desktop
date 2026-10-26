// statusLine 转发数据的内存存储：按 CLI session_id 保存最近一次状态，软件重启后由下一次转发自然恢复

/** 每个会话保留一条状态；默认总上限，超出时淘汰最旧 */
const DEFAULT_LIMIT = 200;

/** 会话状态表：sessionId -> { data, receivedAt } */
export const statuslineStore = new Map();

/**
 * 保存一条 statusLine 转发数据；同一会话覆盖旧值，超限淘汰最旧。
 * @param {unknown} data Claude Code 传入的原始 JSON（必须含 session_id）
 * @param {number} [limit] 测试可注入的上限
 * @returns {boolean} 是否已保存（缺少 session_id 时为 false）
 */
export function recordStatusline(data, limit = DEFAULT_LIMIT) {
  const sessionId = data && typeof data === 'object' ? String(data.session_id || '') : '';
  if (!sessionId) return false;
  statuslineStore.set(sessionId, { data, receivedAt: Date.now() });
  while (statuslineStore.size > limit) {
    // 找到 receivedAt 最小的条目淘汰；条目数量有限，线性扫描足够
    let oldestKey = null;
    let oldestAt = Infinity;
    for (const [key, entry] of statuslineStore) {
      if (entry.receivedAt < oldestAt) {
        oldestAt = entry.receivedAt;
        oldestKey = key;
      }
    }
    statuslineStore.delete(oldestKey);
  }
  return true;
}

/** 读取一个会话的最近状态；不存在时返回 undefined */
export function getStatusline(sessionId) {
  return statuslineStore.get(String(sessionId || ''));
}

/**
 * 按项目目录兜底匹配最近转发的状态，供 continue/picker 等未记录
 * CLI sessionId 的会话使用；目录比较不区分大小写（Windows）。
 */
export function statuslineByCwd(cwd) {
  const wanted = String(cwd || '').toLowerCase();
  if (!wanted) return undefined;
  let best;
  for (const entry of statuslineStore.values()) {
    const dir = String(entry.data?.workspace?.current_dir || entry.data?.cwd || '').toLowerCase();
    if (dir === wanted && (!best || entry.receivedAt > best.receivedAt)) best = entry;
  }
  return best;
}
