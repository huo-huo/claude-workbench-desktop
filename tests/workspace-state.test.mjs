import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORKSPACE_FILE } from '../server/core/paths.mjs';
import { atomicJson } from '../server/core/storage.mjs';
import {
  readWorkspacePreferences,
  sessionDisplayName,
  setWorkspaceFileForTest,
  workspaceSessionName,
  workspaceState,
  writeWorkspacePreferences,
} from '../server/workspace/state.mjs';
import { listWorkspaceSessions, renameWorkspaceSession, pinWorkspaceSession, archiveWorkspaceSession, removeWorkspaceSession, removeWorkspaceSessionsBatch } from '../server/workspace/sessions.mjs';
import { workspaceTerminals } from '../server/terminal/sessions.mjs';

/** 构造一条会话条目;projectPath 用绝对路径以满足 workspaceState 的登记逻辑 */
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

/** 重定向到临时数据文件(绝不读写真实 ~/.claude/workbench-workspace.json);返回还原函数 */
function useTempWorkspace(initial = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'));
  const file = path.join(dir, 'workspace.json');
  if (Object.keys(initial).length) atomicJson(file, initial);
  setWorkspaceFileForTest(file);
  return () => {
    setWorkspaceFileForTest(WORKSPACE_FILE);
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

test('sessionDisplayName:customName 非空时优先', () => {
  assert.equal(sessionDisplayName({ name: '自动名', customName: '我的调试会话' }), '我的调试会话');
});

test('sessionDisplayName:customName 为空白时回退持久化名', () => {
  assert.equal(sessionDisplayName({ name: '自动名', customName: '   ' }), '自动名');
});

test('sessionDisplayName:无持久化名时回退实时推导的自动名', () => {
  const session = fakeSession({ name: '' });
  assert.equal(sessionDisplayName(session), workspaceSessionName(session));
});

test('workspaceState:保留合法的 customName/pinned/archived 字段且不改写 name', () => {
  const restore = useTempWorkspace({ sessions: [
    fakeSession({ id: 'a', customName: '我的调试会话', pinned: true, archived: true }),
  ] });
  try {
    const session = workspaceState().sessions.find(x => x.id === 'a');
    assert.equal(session.customName, '我的调试会话');
    assert.equal(session.pinned, true);
    assert.equal(session.archived, true);
    assert.equal(session.name, '自动名');
  } finally { restore(); }
});

test('workspaceState:类型不合法的新字段被忽略,旧条目零迁移可读', () => {
  const restore = useTempWorkspace({ sessions: [
    fakeSession({ id: 'b', customName: 123, pinned: 'yes', archived: false }),
    fakeSession({ id: 'c' }),
  ] });
  try {
    const { sessions } = workspaceState();
    const b = sessions.find(x => x.id === 'b');
    assert.ok(!('customName' in b), '非 string 的 customName 应被丢弃');
    assert.ok(!('pinned' in b), '非 true 的 pinned 应被丢弃');
    assert.ok(!('archived' in b), '非 true 的 archived 应被丢弃');
    const c = sessions.find(x => x.id === 'c');
    assert.ok(!('pinned' in c), '旧条目视为未置顶');
    assert.ok(!('archived' in c), '旧条目视为未归档');
    assert.equal(sessionDisplayName(c), '自动名');
  } finally { restore(); }
});

test('listWorkspaceSessions:默认过滤归档条目且置顶优先排序,displayName 为自定义名优先', () => {
  const restore = useTempWorkspace({ sessions: [
    fakeSession({ id: 'normal-old', lastUsedAt: '2026-10-26T10:00:00.000Z' }),
    fakeSession({ id: 'pinned', pinned: true, lastUsedAt: '2026-10-25T08:00:00.000Z' }),
    fakeSession({ id: 'normal-new', lastUsedAt: '2026-10-26T12:00:00.000Z' }),
    fakeSession({ id: 'archived', archived: true, lastUsedAt: '2026-10-26T13:00:00.000Z' }),
  ] });
  try {
    const sessions = listWorkspaceSessions();
    assert.deepEqual(sessions.map(x => x.id), ['pinned', 'normal-new', 'normal-old'], '归档被过滤且置顶排最前');
    const pinned = sessions.find(x => x.id === 'pinned');
    assert.equal(pinned.displayName, '自动名');
    assert.equal(pinned.status, 'stopped');
  } finally { restore(); }
});

test('listWorkspaceSessions:archived 选项只返回归档条目', () => {
  const restore = useTempWorkspace({ sessions: [
    fakeSession({ id: 'normal', lastUsedAt: '2026-10-26T10:00:00.000Z' }),
    fakeSession({ id: 'archived', archived: true, lastUsedAt: '2026-10-26T13:00:00.000Z' }),
  ] });
  try {
    const archived = listWorkspaceSessions('', { archived: true });
    assert.deepEqual(archived.map(x => x.id), ['archived']);
  } finally { restore(); }
});

test('listWorkspaceSessions:displayName 优先返回 customName', () => {
  const restore = useTempWorkspace({ sessions: [
    fakeSession({ id: 'renamed', customName: '我的调试会话' }),
  ] });
  try {
    assert.equal(listWorkspaceSessions()[0].displayName, '我的调试会话');
  } finally { restore(); }
});

test('renameWorkspaceSession:写入去空白后的 customName 并持久化', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'r1' })] });
  try {
    const renamed = renameWorkspaceSession('r1', '  我的新名字  ');
    assert.equal(renamed.customName, '我的新名字');
    assert.equal(workspaceState().sessions.find(x => x.id === 'r1').customName, '我的新名字');
  } finally { restore(); }
});

test('renameWorkspaceSession:空白名删除 customName 回退自动名', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'r2', customName: '旧名字' })] });
  try {
    const renamed = renameWorkspaceSession('r2', '   ');
    assert.ok(!('customName' in renamed), '清空后不应保留 customName 字段');
    assert.equal(renamed.name, '自动名');
    assert.ok(!('customName' in workspaceState().sessions.find(x => x.id === 'r2')));
  } finally { restore(); }
});

test('pinWorkspaceSession:置顶与取消', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'p1' })] });
  try {
    assert.equal(pinWorkspaceSession('p1').pinned, true);
    assert.ok(!('pinned' in pinWorkspaceSession('p1', false)), '取消置顶后不应保留 pinned 字段');
  } finally { restore(); }
});

test('archiveWorkspaceSession:归档与恢复', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'a1' })] });
  try {
    assert.equal(archiveWorkspaceSession('a1').archived, true);
    assert.ok(!('archived' in archiveWorkspaceSession('a1', false)), '恢复后不应保留 archived 字段');
  } finally { restore(); }
});

test('archiveWorkspaceSession:归档在线会话先发送 Ctrl+C 终止终端', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'online' })] });
  const writes = [];
  workspaceTerminals.set('online', { proc: { write: data => writes.push(data), kill: () => {} } });
  try {
    archiveWorkspaceSession('online');
    assert.deepEqual(writes, ['\u0003'], '应先向在线终端发送 Ctrl+C');
    assert.equal(workspaceState().sessions.find(x => x.id === 'online').archived, true, '条目保留且已标记归档');
  } finally {
    workspaceTerminals.delete('online');
    restore();
  }
});

test('会话更新函数:未知 id 抛错', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'x' })] });
  try {
    assert.throws(() => renameWorkspaceSession('nope', '新名'), /找不到该会话/);
    assert.throws(() => pinWorkspaceSession('nope'), /找不到该会话/);
    assert.throws(() => archiveWorkspaceSession('nope'), /找不到该会话/);
  } finally { restore(); }
});

test('removeWorkspaceSession:删除条目且保留 Claude 记录,未知 id 返回未移除', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'd1' }), fakeSession({ id: 'd2' })] });
  try {
    assert.deepEqual(removeWorkspaceSession('d1'), { removed: true, transcriptPreserved: true });
    assert.deepEqual(workspaceState().sessions.map(x => x.id), ['d2']);
    assert.deepEqual(removeWorkspaceSession('nope'), { removed: false, transcriptPreserved: true });
  } finally { restore(); }
});

test('removeWorkspaceSessionsBatch:在线会话先发送 Ctrl+C 再删除', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'bulk-online' }), fakeSession({ id: 'bulk-idle' })] });
  const writes = [];
  workspaceTerminals.set('bulk-online', { proc: { write: data => writes.push(data), kill: () => {} } });
  try {
    const result = removeWorkspaceSessionsBatch(['bulk-online', 'bulk-idle']);
    assert.deepEqual(writes, ['\u0003'], '应向在线终端发送 Ctrl+C');
    assert.equal(result.removed, 2);
    assert.deepEqual(result.failed, []);
    assert.ok(!workspaceState().sessions.some(x => x.id === 'bulk-online'), '在线条目应被删除');
  } finally {
    workspaceTerminals.delete('bulk-online');
    restore();
  }
});

test('设置读写:合并写入后重新读取一致,项目与会话字段保留', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'keep' })], projects: [{ path: 'C:\\keep', addedAt: 'x', lastUsedAt: 'x' }] });
  try {
    assert.deepEqual(readWorkspacePreferences(), {});
    const saved = writeWorkspacePreferences({ theme: 'dark', terminalFontSize: 13 });
    assert.deepEqual(saved, { theme: 'dark', terminalFontSize: 13 });
    assert.deepEqual(readWorkspacePreferences(), { theme: 'dark', terminalFontSize: 13 });
    assert.equal(workspaceState().sessions[0].id, 'keep');
    assert.equal(workspaceState().projects[0].path, 'C:\\keep');
  } finally { restore(); }
});

test('设置读写:非法字段抛错且文件内容不变', () => {
  const restore = useTempWorkspace({ preferences: { theme: 'light' } });
  try {
    assert.throws(() => writeWorkspacePreferences({ theme: 'blue' }), /theme/);
    assert.deepEqual(readWorkspacePreferences(), { theme: 'light' });
  } finally { restore(); }
});

test('设置读取:文件内非法值回退空对象', () => {
  const restore = useTempWorkspace({ preferences: { terminalFontSize: 'huge', theme: 'blue' } });
  try {
    assert.deepEqual(readWorkspacePreferences(), {});
  } finally { restore(); }
});

test('设置读取:单个字段损坏时保留其他合法值', () => {
  const restore = useTempWorkspace({ preferences: { theme: 'dark', terminalFontSize: 'huge' } });
  try {
    assert.deepEqual(readWorkspacePreferences(), { theme: 'dark' });
  } finally { restore(); }
});

test('会话写操作保留 preferences', () => {
  const restore = useTempWorkspace({ sessions: [fakeSession({ id: 'p1' })], preferences: { theme: 'dark', toolbarVisible: false } });
  try {
    renameWorkspaceSession('p1', '改名后');
    assert.deepEqual(readWorkspacePreferences(), { theme: 'dark', toolbarVisible: false });
  } finally { restore(); }
});
