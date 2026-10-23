import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server.mjs';

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

test('GET 路由表命中：/api/workspace/projects 返回项目列表', async () => {
  const res = await fetch(`${base}/api/workspace/projects`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.projects));
});

test('GET 未知路径返回 404 文本', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), 'Not found');
});

test('POST 未知 /api/* 路径返回 404 JSON', async () => {
  const res = await fetch(`${base}/api/not-exists`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Not found' });
});

test('首页与静态资源走同一兜底链路', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
});
