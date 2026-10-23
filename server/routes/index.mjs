import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { WEB_ROOT } from '../core/paths.mjs';
import { bodyJson, send, serveWorkspaceAsset } from '../core/http.mjs';
import { redacted } from '../core/redact.mjs';
import { handleTerminalUpgrade, workspaceWs } from '../terminal/sessions.mjs';
import { saveWorkspaceImageUpload } from '../workspace/files.mjs';
import { sdkRuntime } from '../sdk/bridge.mjs';
import { overview } from '../catalog/metrics.mjs';
import { GET_ROUTES, POST_ROUTES } from './handlers.mjs';

// WebSocket 升级路由；未知路径直接销毁连接，保留原有 origin 校验
const UPGRADE_ROUTES = new Map([
  ['/api/sdk/events', (req, socket, head, url) => {
    const target = sdkRuntime.get(url.searchParams.get('session') || '');
    if (!target || target.status === 'closed') return socket.destroy();
    workspaceWs.handleUpgrade(req, socket, head, ws => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      let unsubscribe = null;
      try {
        // subscribe 会先发送 ready 并同步回放缓冲，再推送实时事件
        unsubscribe = sdkRuntime.subscribe(target.id, message => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
        });
      } catch {
        ws.close();
        return;
      }
      ws.on('close', () => { if (unsubscribe) unsubscribe(); });
      ws.on('error', () => { if (unsubscribe) unsubscribe(); });
    });
  }],
  ['/api/workspace/terminal', (req, socket, head, url) => handleTerminalUpgrade(req, socket, head, url)],
]);

/** 创建 HTTP 请求处理器：GET/POST 路由表分发、静态资源兜底与统一错误处理 */
export function createRequestHandler() {
  return async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

      if (req.method === 'GET') {
        const handler = GET_ROUTES.get(url.pathname);
        if (handler) {
          const result = await handler(url);
          return send(res, result.status, result.body, result.type);
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          return send(res, 200, fs.readFileSync(path.join(WEB_ROOT, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
        }
        if (serveWorkspaceAsset(url, res)) return;
        return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      }

      // 图片上传是唯一不走 JSON body 的 POST 端点：直接读取原始请求体并返回 201
      if (req.method === 'POST' && url.pathname === '/api/workspace/image-upload') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new Error('只接受本地工作台页面发起的操作');
        return send(res, 201, await saveWorkspaceImageUpload(req));
      }

      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new Error('只接受本地工作台页面发起的操作');
        const body = await bodyJson(req);
        const handler = POST_ROUTES.get(url.pathname);
        if (!handler) return send(res, 404, { error: 'Not found' });
        const result = await handler(body, url);
        // 操作类接口沿用原有行为：执行成功后返回最新 overview
        if (result === undefined) return send(res, 200, await overview(null));
        return send(res, result.status, result.body, result.type);
      }

      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    } catch (error) {
      // 透传业务错误自带的状态码（如 SDK 400/501/503），未知错误仍按 400 处理
      return send(res, Number(error.statusCode) || 400, { error: redacted(error.message || 'Request failed') });
    }
  };
}

/** 创建 WebSocket 升级处理器 */
export function createUpgradeHandler() {
  return (req, socket, head) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return socket.destroy();
      const handler = UPGRADE_ROUTES.get(url.pathname);
      if (!handler) return socket.destroy();
      handler(req, socket, head, url);
    } catch { socket.destroy(); }
  };
}
