import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server.mjs';
import { WORKSPACE_FILE } from '../server/core/paths.mjs';
import { atomicJson } from '../server/core/storage.mjs';
import { setWorkspaceFileForTest } from '../server/workspace/state.mjs';

let server;
let base;
let tempDir;

/** 构造一条会话条目作为路由测试夹具 */
function fakeSession(overrides = {}) {
  return {
    id: 's1',
    projectPath: 'C:\\fake-project',
    name: '自动名',
    mode: 'workspace',
    createdAt: '2026-10-26T08:00:00.000Z',
    lastUsedAt: '2026-10-26T09:00:00.000Z',
    ...overrides,
  };
}

/** 发送 JSON POST 请求 */
function post(pathname, body) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  // 工作区数据文件重定向到临时目录,绝不读写真实 ~/.claude/workbench-workspace.json
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-routes-'));
  setWorkspaceFileForTest(path.join(tempDir, 'workspace.json'));
  atomicJson(path.join(tempDir, 'workspace.json'), { sessions: [fakeSession({ id: 's1' }), fakeSession({ id: 's2' })] });
  server = startServer(0);
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  setWorkspaceFileForTest(WORKSPACE_FILE);
  fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
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

test('POST /api/workspace/session/rename 重命名并反映到列表 displayName', async () => {
  const res = await post('/api/workspace/session/rename', { id: 's1', customName: '接口改名' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).customName, '接口改名');
  const list = await (await fetch(`${base}/api/workspace/sessions`)).json();
  assert.equal(list.sessions.find(x => x.id === 's1').displayName, '接口改名');
});

test('POST /api/workspace/session/pin 置顶会话', async () => {
  const res = await post('/api/workspace/session/pin', { id: 's1' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).pinned, true);
});

test('POST /api/workspace/session/archive 归档后 ?archived=1 列表可见', async () => {
  const res = await post('/api/workspace/session/archive', { id: 's2' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).archived, true);
  const list = await (await fetch(`${base}/api/workspace/sessions?archived=1`)).json();
  assert.deepEqual(list.sessions.map(x => x.id), ['s2']);
});

test('会话状态接口对未知 id 返回 400 与错误信息', async () => {
  for (const action of ['rename', 'pin', 'archive']) {
    const res = await post(`/api/workspace/session/${action}`, { id: 'nope' });
    assert.equal(res.status, 400, `${action} 应返回 400`);
    assert.ok((await res.json()).error);
  }
});

test('POST /api/workspace/sessions/remove-batch 批量删除混合存在与不存在的 id', async () => {
  // 重写夹具:与前序测试的会话状态互不影响
  atomicJson(path.join(tempDir, 'workspace.json'), { sessions: [fakeSession({ id: 'b1' }), fakeSession({ id: 'b2' })] });
  const res = await post('/api/workspace/sessions/remove-batch', { ids: ['b1', 'b2', 'nope'] });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.removed, 2);
  assert.deepEqual(body.failed, [{ id: 'nope', error: '找不到该会话' }]);
  assert.equal(body.transcriptPreserved, true);
  const list = await (await fetch(`${base}/api/workspace/sessions`)).json();
  assert.deepEqual(list.sessions.map(x => x.id), []);
});

test('POST /api/workspace/sessions/remove-batch 空 ids 返回 400', async () => {
  for (const ids of [[], undefined]) {
    const res = await post('/api/workspace/sessions/remove-batch', { ids });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
  }
});
