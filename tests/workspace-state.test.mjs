import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORKSPACE_FILE } from '../server/core/paths.mjs';
import { atomicJson } from '../server/core/storage.mjs';
import {
  sessionDisplayName,
  setWorkspaceFileForTest,
  workspaceSessionName,
  workspaceState,
} from '../server/workspace/state.mjs';
import { listWorkspaceSessions } from '../server/workspace/sessions.mjs';

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
