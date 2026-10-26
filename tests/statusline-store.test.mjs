import test from 'node:test';
import assert from 'node:assert/strict';

import { statuslineStore, recordStatusline, getStatusline, statuslineByCwd } from '../server/statusline/store.mjs';

/** 每条用例开始前清空共享 store，避免相互污染 */
function resetStore() {
  statuslineStore.clear();
}

test('recordStatusline 保存并按 session_id 读取', () => {
  resetStore();
  const saved = recordStatusline({ session_id: 's1', model: { display_name: 'glm-5.3-flash' } });
  assert.equal(saved, true);
  const got = getStatusline('s1');
  assert.equal(got.data.model.display_name, 'glm-5.3-flash');
  assert.equal(typeof got.receivedAt, 'number');
});

test('recordStatusline 同一会话新数据覆盖旧数据', () => {
  resetStore();
  recordStatusline({ session_id: 's1', model: { display_name: '旧' } });
  recordStatusline({ session_id: 's1', model: { display_name: '新' } });
  assert.equal(statuslineStore.size, 1);
  assert.equal(getStatusline('s1').data.model.display_name, '新');
});

test('recordStatusline 缺少 session_id 时忽略并返回 false', () => {
  resetStore();
  assert.equal(recordStatusline({ model: { display_name: 'x' } }), false);
  assert.equal(recordStatusline(null), false);
  assert.equal(statuslineStore.size, 0);
});

test('超过上限时按接收时间淘汰最旧会话', () => {
  resetStore();
  for (let i = 0; i < 6; i += 1) {
    recordStatusline({ session_id: `s${i}` }, 5);
  }
  assert.equal(statuslineStore.size, 5);
  assert.equal(getStatusline('s0'), undefined);
  assert.notEqual(getStatusline('s1'), undefined);
  assert.notEqual(getStatusline('s5'), undefined);
});

test('statuslineByCwd 按项目目录兜底匹配最近转发', () => {
  resetStore();
  recordStatusline({ session_id: 'cont', workspace: { current_dir: 'E:\\demo\\proj' } });
  recordStatusline({ session_id: 'other', workspace: { current_dir: 'E:\\other' } });
  const got = statuslineByCwd('e:\\DEMO\\proj');
  assert.notEqual(got, undefined);
  assert.equal(got.data.session_id, 'cont');
});

test('statuslineByCwd 无匹配时返回 undefined', () => {
  resetStore();
  recordStatusline({ session_id: 'a', cwd: 'E:\\x' });
  assert.equal(statuslineByCwd('E:\\nope'), undefined);
});
