import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePreferences } from '../server/workspace/preferences.mjs';

test('设置合并：合法字段覆盖，其他字段保留', () => {
  const { preferences, ignored } = normalizePreferences(
    { theme: 'dark', terminalFontSize: 14 },
    { theme: 'light', view: 'workspace', terminalFontSize: 12 },
  );
  assert.deepEqual(preferences, { theme: 'dark', view: 'workspace', terminalFontSize: 14 });
  assert.deepEqual(ignored, []);
});

test('设置合并：未知字段被忽略', () => {
  const { preferences, ignored } = normalizePreferences({ unknownKey: 1, view: 'workspace' }, {});
  assert.deepEqual(preferences, { view: 'workspace' });
  assert.deepEqual(ignored, ['unknownKey']);
});

test('设置合并：非法类型与范围被拒绝', () => {
  assert.throws(() => normalizePreferences({ theme: 'blue' }, {}), /theme/);
  assert.throws(() => normalizePreferences({ terminalFontSize: 100 }, {}), /terminalFontSize/);
  assert.throws(() => normalizePreferences({ projectsExpanded: 'yes' }, {}), /projectsExpanded/);
  assert.throws(() => normalizePreferences({ statusline: { fontSize: 8 } }, {}), /statusline/);
  assert.throws(() => normalizePreferences({ statusline: { items: { model: 'on' } } }, {}), /布尔值/);
});

test('设置合并：状态栏与折叠项目正常规范化', () => {
  const { preferences } = normalizePreferences({
    statusline: { fontSize: 12, items: { model: true, mcpConfig: false } },
    collapsedProjects: ['C:\\a', 'C:\\a', 'C:\\b'],
  }, {});
  assert.deepEqual(preferences.statusline, { fontSize: 12, items: { model: true, mcpConfig: false } });
  assert.deepEqual(preferences.collapsedProjects, ['C:\\a', 'C:\\b']);
});

test('设置合并：非对象输入被拒绝', () => {
  assert.throws(() => normalizePreferences(null, {}), /对象/);
  assert.throws(() => normalizePreferences([], {}), /对象/);
});
