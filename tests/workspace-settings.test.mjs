import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSettingsManager,
  normalizeClientPreferences,
  readStoredPreferences,
  writeStoredPreferences,
} from '../src/workspace/settings-data.mjs';

/** Map 实现的假 storage，避免测试触碰真实 localStorage */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    dump: () => Object.fromEntries(map),
  };
}

/** 按顺序返回预设响应的假 fetch */
function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    if (next instanceof Error) throw next;
    return {
      ok: next.ok !== false,
      status: next.status || 200,
      json: async () => next.body,
    };
  };
  impl.calls = calls;
  return impl;
}

/** 可手动触发的定时器 */
function fakeTimers() {
  let id = 0;
  const jobs = new Map();
  return {
    setTimeout: handler => { const key = ++id; jobs.set(key, handler); return key; },
    clearTimeout: key => { jobs.delete(key); },
    runAll: () => { for (const [key, handler] of [...jobs]) { jobs.delete(key); handler(); } },
  };
}

test('设置归一化：夹紧字号并补默认值', () => {
  const prefs = normalizeClientPreferences({ terminalFontSize: 99, statusline: { fontSize: 3 } });
  assert.equal(prefs.terminalFontSize, 24);
  assert.equal(prefs.statusline.fontSize, 10);
  assert.equal(prefs.theme, 'light');
  assert.equal(prefs.statuslineVisible, true);
});

test('本地缓存读写：只读写白名单字段', () => {
  const storage = fakeStorage();
  writeStoredPreferences({ theme: 'dark', terminalFontSize: 14, unknown: 1 }, storage);
  const read = readStoredPreferences(storage);
  assert.deepEqual(read, { theme: 'dark', terminalFontSize: 14 });
  assert.equal(storage.dump().unknown, undefined);
});

test('加载成功：应用服务端设置并写缓存', async () => {
  const storage = fakeStorage();
  let applied = null;
  const fetchImpl = fakeFetch([{ body: { preferences: { theme: 'dark', terminalFontSize: 13 } } }]);
  const manager = createSettingsManager({ fetchImpl, storage, onApply: value => { applied = value; } });
  const result = await manager.load();
  assert.equal(result.source, 'server');
  assert.equal(applied.theme, 'dark');
  assert.equal(applied.terminalFontSize, 13);
  assert.equal(readStoredPreferences(storage).theme, 'dark');
});

test('加载失败：回退本地缓存并提示', async () => {
  const storage = fakeStorage({ 'claude-workbench-workspace-theme': 'dark' });
  const errors = [];
  const fetchImpl = fakeFetch([new Error('offline')]);
  const manager = createSettingsManager({ fetchImpl, storage, onError: message => errors.push(message) });
  const result = await manager.load();
  assert.equal(result.source, 'cache');
  assert.equal(manager.get().theme, 'dark');
  assert.match(errors[0], /本地缓存/);
});

test('加载超时：回退本地缓存', async () => {
  const storage = fakeStorage({ 'claude-workbench-terminal-font-size': '16' });
  const fetchImpl = () => new Promise(() => {});
  const manager = createSettingsManager({ fetchImpl, storage, timeoutMs: 10 });
  const result = await manager.load();
  assert.equal(result.source, 'cache');
  assert.equal(manager.get().terminalFontSize, 16);
});

test('首次迁移：服务端为空时写入归一化后的本地缓存', async () => {
  const storage = fakeStorage({ 'claude-workbench-workspace-theme': 'dark', 'claude-workbench-view': 'workspace' });
  const fetchImpl = fakeFetch([
    { body: { preferences: {} } },
    { ok: true, body: { preferences: { theme: 'dark', view: 'workspace' } } },
  ]);
  const manager = createSettingsManager({ fetchImpl, storage });
  const result = await manager.load();
  assert.equal(result.source, 'migration');
  const posted = fetchImpl.calls[1].body;
  assert.equal(posted.theme, 'dark');
  assert.equal(posted.view, 'workspace');
  assert.equal(posted.statusline.fontSize, 10);
});

test('首次迁移：旧版 8px 状态栏字号被夹到 10px 后写入', async () => {
  const storage = fakeStorage({
    'claude-workbench-statusline-config': JSON.stringify({ fontSize: 8, items: { model: true } }),
  });
  const fetchImpl = fakeFetch([{ body: { preferences: {} } }, { body: { preferences: {} } }]);
  const manager = createSettingsManager({ fetchImpl, storage });
  await manager.load();
  assert.equal(fetchImpl.calls[1].body.statusline.fontSize, 10);
});

test('已有服务端设置时不用本地缓存覆盖', async () => {
  const storage = fakeStorage({ 'claude-workbench-workspace-theme': 'dark' });
  const fetchImpl = fakeFetch([{ body: { preferences: { theme: 'light' } } }]);
  const manager = createSettingsManager({ fetchImpl, storage });
  await manager.load();
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(manager.get().theme, 'light');
});

test('迁移写入失败：保留本地缓存值', async () => {
  const storage = fakeStorage({ 'claude-workbench-workspace-theme': 'dark' });
  const errors = [];
  const fetchImpl = fakeFetch([{ body: { preferences: {} } }, new Error('write failed')]);
  const manager = createSettingsManager({ fetchImpl, storage, onError: message => errors.push(message) });
  const result = await manager.load();
  assert.equal(result.source, 'cache');
  assert.equal(manager.get().theme, 'dark');
  assert.match(errors[0], /迁移失败/);
});

test('防抖写入：连续修改只发送一次合并补丁', async () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const fetchImpl = fakeFetch([{ body: { preferences: {} } }, { body: { preferences: {} } }]);
  const manager = createSettingsManager({ fetchImpl, storage, timers, saveDelay: 100 });
  await manager.load();
  manager.save({ terminalFontSize: 13 });
  manager.save({ terminalFontSize: 14, theme: 'dark' });
  assert.equal(fetchImpl.calls.length, 1);
  timers.runAll();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetchImpl.calls.length, 2);
  assert.deepEqual(fetchImpl.calls[1].body, { terminalFontSize: 14, theme: 'dark' });
});

test('写入前归一化：越界字段被夹紧且不拖垮其他字段', async () => {
  const storage = fakeStorage();
  const timers = fakeTimers();
  const fetchImpl = fakeFetch([{ body: { preferences: {} } }, { body: { preferences: {} } }]);
  const manager = createSettingsManager({ fetchImpl, storage, timers, saveDelay: 10 });
  await manager.load();
  manager.save({ terminalFontSize: 99, theme: 'dark', unknownKey: 1 });
  timers.runAll();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(fetchImpl.calls[1].body, { terminalFontSize: 24, theme: 'dark' });
});

test('写入失败：提示错误但保留内存与缓存中的设置', async () => {
  const storage = fakeStorage();
  const errors = [];
  const timers = fakeTimers();
  const fetchImpl = fakeFetch([{ body: { preferences: {} } }, new Error('save failed')]);
  const manager = createSettingsManager({
    fetchImpl, storage, timers, onError: message => errors.push(message),
  });
  await manager.load();
  manager.save({ theme: 'dark' });
  timers.runAll();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.get().theme, 'dark');
  assert.equal(readStoredPreferences(storage).theme, 'dark');
  assert.match(errors[0], /未保存/);
});
