import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer } from '../server.mjs';

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

test('源码静态检查：PowerShell 脚本不含被误改的 export 关键字', async () => {
  const source = fs.readFileSync(new URL('../server/workspace/native.mjs', import.meta.url), 'utf8');
  assert.ok(!/export function Show-/.test(source), 'PowerShell 脚本中的函数声明不应带 export');
});
