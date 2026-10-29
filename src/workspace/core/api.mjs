/** JSON 请求封装：自动序列化请求体并统一错误消息 */
export async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : options.body,
    });
  } catch (error) {
    // 网络层失败（服务未启动/已退出）：给出明确提示而不是无声失败
    notifyServiceDown();
    throw new Error('无法连接工作台服务，请重启应用');
  }
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(value?.error || `请求失败（${response.status}）`);
  return value;
}

let lastOfflineNoticeAt = 0;
let reconnectTimer = null;

/** 服务断连提示节流：30 秒内只提示一次，避免多请求同时失败时刷屏 */
function notifyServiceDown() {
  const now = Date.now();
  if (now - lastOfflineNoticeAt < 30000) return;
  lastOfflineNoticeAt = now;
  toast('工作台服务已断开，正在尝试自动恢复；若持续失败请重启应用');
  scheduleReconnect();
}

/** 断线自动恢复轮询：服务守护重启成功后自动刷新页面，窗口无需手动重开 */
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    try {
      const response = await fetch('/api/workspace/projects', { cache: 'no-store' });
      if (response.ok) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
        location.reload();
      }
    } catch { /* 服务未恢复，继续重试 */ }
  }, 3000);
}

/** 优先复用管理页的 toast；不可用时回退到原生 alert */
export function toast(message) {
  if (window.workbenchToast) window.workbenchToast(message);
  else alert(message);
}
