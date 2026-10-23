import fs from 'node:fs';
import path from 'node:path';
import { MAX_BODY, WEB_ROOT } from './paths.mjs';

/** 读取原始请求体；超过 limit 时抛出与原实现一致的错误 */
export async function readRawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('图片不能超过 20 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/** 读取并解析 JSON 请求体；超过 MAX_BODY 时抛出 Request too large */
export async function bodyJson(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > MAX_BODY) throw new Error('Request too large');
  }
  return text ? JSON.parse(text) : {};
}

/** 统一响应头与 JSON 序列化 */
export function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

/** 静态资源兜底；命中并发送时返回 true，否则返回 false 交给 404 处理 */
export function serveWorkspaceAsset(url, res) {
  const relative = decodeURIComponent(url.pathname.slice(1));
  if (!relative || relative.includes('\\') || relative.split('/').some(x => x === '..')) return false;
  const extension = path.extname(relative).toLowerCase();
  const mime = ({ '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' })[extension];
  if (!mime) return false;
  const target = path.resolve(WEB_ROOT, relative);
  const rel = path.relative(WEB_ROOT, target);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return false;
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(fs.readFileSync(target));
  return true;
}
