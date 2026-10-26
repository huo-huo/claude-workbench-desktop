import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../server.mjs';
import { statuslineStore, getStatusline } from '../server/statusline/store.mjs';

// 端点冒烟：启动真实服务（随机端口），只请求只读端点，不写入用户配置
let server;
let base;

before(async () => {
  server = startServer(0);
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('冒烟：/api/state 返回概览结构', async () => {
  const res = await fetch(`${base}/api/state`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.model && typeof body.model === 'object');
  assert.ok(Array.isArray(body.hooks));
  assert.ok(Array.isArray(body.skills));
  assert.ok(Array.isArray(body.mcp));
  assert.ok(Array.isArray(body.errors));
});

test('冒烟：/api/workspace/projects 返回列表', async () => {
  const res = await fetch(`${base}/api/workspace/projects`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).projects));
});

test('冒烟：/api/workspace/sessions 返回列表', async () => {
  const res = await fetch(`${base}/api/workspace/sessions`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).sessions));
});

test('冒烟：/api/sdk/health 返回可用性结构', async () => {
  const res = await fetch(`${base}/api/sdk/health`);
  assert.ok([200, 503].includes(res.status));
  const body = await res.json();
  assert.equal(typeof body.available, 'boolean');
  assert.equal(typeof body.nodeVersion, 'string');
});

test('冒烟：/api/prompt-library 返回提示词列表', async () => {
  const res = await fetch(`${base}/api/prompt-library`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).prompts));
});

test('冒烟：/api/state 返回 usageWindow 结构', async () => {
  const res = await fetch(`${base}/api/state`);
  const body = await res.json();
  // 仅验证结构存在；真实统计数据依赖本机会话文件，不在冒烟测试中做数值断言
  assert.equal(typeof body.usageWindow.sessions, 'number');
  assert.equal(typeof body.usageWindow.label, 'string');
  assert.equal(typeof body.counts.skills, 'number');
});

test('冒烟：图片上传走独立原始请求体分支', async () => {
  const bad = await fetch(`${base}/api/workspace/image-upload`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'not an image',
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /只支持 PNG/);

  // 1x1 透明 PNG，验证 201 与返回结构；测试结束删除临时文件
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const ok = await fetch(`${base}/api/workspace/image-upload`, {
    method: 'POST',
    headers: { 'content-type': 'image/png' },
    body: png,
  });
  assert.equal(ok.status, 201);
  const uploaded = await ok.json();
  assert.equal(uploaded.mime, 'image/png');
  assert.ok(uploaded.imagePath);
  try { fs.unlinkSync(uploaded.imagePath); } catch {}
});

test('冒烟：超过 1 MB 的 JSON 请求体被拒绝', async () => {
  const res = await fetch(`${base}/api/save-models`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 1) }),
  });
  assert.equal(res.status, 400);
});

test('冒烟：statusline 转发保存会话状态并在同会话覆盖', async () => {
  statuslineStore.clear();
  const first = await fetch(`${base}/api/statusline/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 'smoke-1', model: { display_name: '旧' } }),
  });
  assert.equal(first.status, 200);
  assert.equal(getStatusline('smoke-1').data.model.display_name, '旧');

  const second = await fetch(`${base}/api/statusline/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 'smoke-1', model: { display_name: '新' } }),
  });
  assert.equal(second.status, 200);
  assert.equal(statuslineStore.size, 1);
  assert.equal(getStatusline('smoke-1').data.model.display_name, '新');
});

test('冒烟：statusline 转发非法 JSON 返回 400', async () => {
  const res = await fetch(`${base}/api/statusline/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json',
  });
  assert.equal(res.status, 400);
});

test('冒烟：statusline 转发超过 256 KB 的请求体返回 413', async () => {
  const res = await fetch(`${base}/api/statusline/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 'big', pad: 'x'.repeat(256 * 1024 + 1) }),
  });
  assert.equal(res.status, 413);
});

test('冒烟：statusline 查询不存在的会话返回 404', async () => {
  const res = await fetch(`${base}/api/statusline/state?id=no-such-workbench-session`);
  assert.equal(res.status, 404);
});

test('冒烟：statusline 无 id 查询仅返回启用标志', async () => {
  const res = await fetch(`${base}/api/statusline/state`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.enabled, 'boolean');
  assert.equal(body.status, null);
});

test('源码静态检查：PowerShell 脚本不含被误改的 export 关键字', async () => {
  const source = fs.readFileSync(new URL('../server/workspace/native.mjs', import.meta.url), 'utf8');
  assert.ok(!/export function Show-/.test(source), 'PowerShell 脚本中的函数声明不应带 export');
});

test('冒烟：statusline 切换接口拒绝非法思考等级', async () => {
  const res = await fetch(`${base}/api/statusline/switch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'whatever', effort: 'ultra' }),
  });
  assert.equal(res.status, 400);
});

test('冒烟：statusline 切换接口对不存在的会话返回 404', async () => {
  const res = await fetch(`${base}/api/statusline/switch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'no-such-session', model: 'claude-opus' }),
  });
  assert.equal(res.status, 404);
});
