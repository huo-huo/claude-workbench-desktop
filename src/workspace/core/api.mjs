/** JSON 请求封装：自动序列化请求体并统一错误消息 */
export async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : options.body,
  });
  const type = response.headers.get('content-type') || '';
  const value = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(value?.error || `请求失败（${response.status}）`);
  return value;
}

/** 优先复用管理页的 toast；不可用时回退到原生 alert */
export function toast(message) {
  if (window.workbenchToast) window.workbenchToast(message);
  else alert(message);
}
