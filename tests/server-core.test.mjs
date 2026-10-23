import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atomicJson, fileMtimeMs, hash, safeReadJson } from '../server/core/storage.mjs';
import { bodyJson, readRawBody, send, serveWorkspaceAsset } from '../server/core/http.mjs';
import { workspacePath } from '../server/workspace/files.mjs';

// 构造可被 for await 消费的请求体
function requestOf(...parts) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) yield Buffer.from(part);
    },
  };
}

// 每个测试使用独立临时目录，避免相互影响
function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cw-core-'));
}

test('atomicJson：写入后可读回，并自动创建父目录', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'nested', 'state.json');
    atomicJson(file, { a: 1 });
    assert.deepEqual(safeReadJson(file), { a: 1 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('atomicJson：覆盖已有文件且不残留临时文件', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'state.json');
    atomicJson(file, { a: 1 });
    atomicJson(file, { a: 2 });
    assert.deepEqual(safeReadJson(file), { a: 2 });
    assert.deepEqual(fs.readdirSync(dir), ['state.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('safeReadJson：文件缺失时返回 fallback', () => {
  const dir = tempDir();
  try {
    assert.deepEqual(safeReadJson(path.join(dir, 'missing.json'), { fallback: true }), { fallback: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('safeReadJson：损坏 JSON 时返回 fallback', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'broken.json');
    fs.writeFileSync(file, '{ not json');
    assert.deepEqual(safeReadJson(file, { fallback: true }), { fallback: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fileMtimeMs：文件不存在返回 0，存在返回正数', () => {
  const dir = tempDir();
  try {
    assert.equal(fileMtimeMs(path.join(dir, 'missing.json')), 0);
    const file = path.join(dir, 'exists.json');
    fs.writeFileSync(file, '{}');
    assert.ok(fileMtimeMs(file) > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('hash：同一输入稳定且长度为 20', () => {
  assert.equal(hash({ a: 1 }), hash({ a: 1 }));
  assert.equal(hash({ a: 1 }).length, 20);
  assert.notEqual(hash({ a: 1 }), hash({ a: 2 }));
});

test('bodyJson：空请求体返回空对象，合法 JSON 正常解析', async () => {
  assert.deepEqual(await bodyJson(requestOf()), {});
  assert.deepEqual(await bodyJson(requestOf('{"a":1}')), { a: 1 });
});

test('bodyJson：超过 MAX_BODY 时抛出 Request too large', async () => {
  await assert.rejects(() => bodyJson(requestOf('x'.repeat(1024 * 1024 + 1))), /Request too large/);
});

test('readRawBody：超过 limit 时抛出图片大小错误', async () => {
  await assert.rejects(() => readRawBody(requestOf('12345'), 3), /图片不能超过 20 MB/);
  assert.equal((await readRawBody(requestOf('123'), 3)).toString(), '123');
});

test('send：JSON 响应带统一响应头并序列化', () => {
  const calls = { headers: null, body: null };
  const res = {
    writeHead(status, headers) { calls.status = status; calls.headers = headers; },
    end(body) { calls.body = body; },
  };
  send(res, 201, { ok: true });
  assert.equal(calls.status, 201);
  assert.equal(calls.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(calls.body, '{"ok":true}');
});

test('serveWorkspaceAsset：拒绝路径穿越与不支持的扩展名', () => {
  assert.equal(serveWorkspaceAsset(new URL('http://127.0.0.1/..%2Fsecret.png'), {}), false);
  assert.equal(serveWorkspaceAsset(new URL('http://127.0.0.1/notes.txt'), {}), false);
  assert.equal(serveWorkspaceAsset(new URL('http://127.0.0.1/missing.png'), {}), false);
});

test('workspacePath：允许项目内路径，拒绝越界路径', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ws-'));
  try {
    fs.mkdirSync(path.join(dir, 'sub'));
    const inside = workspacePath(dir, 'sub');
    assert.equal(inside.real, fs.realpathSync(path.join(dir, 'sub')));
    assert.throws(() => workspacePath(dir, '../outside'), /不能读取项目文件夹以外的路径/);
    assert.throws(() => workspacePath(dir, 'missing.txt'), /文件不存在或无法读取/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
