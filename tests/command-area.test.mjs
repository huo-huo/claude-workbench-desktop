import test from 'node:test';
import assert from 'node:assert/strict';
import { matchComposerShortcut } from '../src/workspace/shortcuts.mjs';
import { selectOverflowActions } from '../src/workspace/toolbar-layout.mjs';
import {
  clampStatuslineFontSize,
  normalizeStatuslineConfig,
  statuslineItemEnabled,
  STATUSLINE_FONT_RANGE,
} from '../src/workspace/statusline-config.mjs';
import { createWriteQueue, createDebouncer } from '../src/workspace/terminal-scheduler.mjs';

test('快捷键：Ctrl+Enter 发送、Enter 换行、Esc 回到终端', () => {
  assert.equal(matchComposerShortcut({ key: 'Enter', ctrlKey: true }), 'send');
  assert.equal(matchComposerShortcut({ key: 'Enter', ctrlKey: false }), null);
  assert.equal(matchComposerShortcut({ key: 'Escape' }), 'focus-terminal');
  assert.equal(matchComposerShortcut({ key: 'Escape', ctrlKey: true }), null);
});

test('快捷键：Ctrl+` 在非终端焦点切换输入区，终端焦点时放行', () => {
  assert.equal(matchComposerShortcut({ key: '`', ctrlKey: true }), 'toggle-composer');
  assert.equal(matchComposerShortcut({ key: '`', ctrlKey: true }, { inTerminal: true }), null);
  assert.equal(matchComposerShortcut({ key: '`', ctrlKey: true, shiftKey: true }), null);
});

test('工具栏溢出：按低优先级先收起，直到不超过预算', () => {
  const candidates = [
    { id: 'toggleFiles', width: 60 },
    { id: 'openStatuslineSettings', width: 80 },
    { id: 'zoom', width: 110 },
    { id: 'toggleComposer', width: 90 },
  ];
  assert.deepEqual(selectOverflowActions(candidates, 400), []);
  assert.deepEqual(selectOverflowActions(candidates, 250), ['toggleFiles', 'openStatuslineSettings']);
  assert.deepEqual(selectOverflowActions(candidates, 0), ['toggleFiles', 'openStatuslineSettings', 'zoom', 'toggleComposer']);
});

test('状态栏字号：旧配置 8px 被夹到下限 10px', () => {
  const config = normalizeStatuslineConfig({ fontSize: 8, items: { model: false } });
  assert.equal(STATUSLINE_FONT_RANGE.min, 10);
  assert.equal(config.fontSize, 10);
  assert.equal(config.items.model, false);
  assert.equal(clampStatuslineFontSize(99), 14);
  assert.equal(clampStatuslineFontSize('abc'), 10);
});

test('状态栏默认隐藏重复项，显式开启后可见', () => {
  assert.equal(statuslineItemEnabled({}, 'mcpConfig'), false);
  assert.equal(statuslineItemEnabled({ mcpConfig: true }, 'mcpConfig'), true);
  assert.equal(statuslineItemEnabled({}, 'model'), true);
});

test('终端写入队列：同一帧合并并按顺序写入', () => {
  let scheduled = null;
  const written = [];
  const queue = createWriteQueue({
    write: chunk => written.push(chunk),
    schedule: handler => { scheduled = handler; return 1; },
    cancel: () => {},
  });
  queue.push('a');
  queue.push('b');
  assert.deepEqual(written, []);
  assert.equal(queue.size, 2);
  scheduled();
  assert.deepEqual(written, ['ab']);
  assert.equal(queue.size, 0);
});

test('终端写入队列：帧回调前清空则不写入', () => {
  let scheduled = null;
  const written = [];
  const queue = createWriteQueue({
    write: chunk => written.push(chunk),
    schedule: handler => { scheduled = handler; return 1; },
    cancel: () => { scheduled = null; },
  });
  queue.push('x');
  queue.clear();
  assert.equal(scheduled, null);
  assert.deepEqual(written, []);
});

test('防抖：连续触发只执行最后一次', () => {
  let pending = null;
  let runs = 0;
  let now = 0;
  const trigger = createDebouncer({
    delay: 100,
    run: () => { runs += 1; },
    setTimer: handler => { pending = handler; return ++now; },
    clearTimer: () => { pending = null; },
  });
  trigger();
  trigger();
  trigger();
  assert.equal(runs, 0);
  pending();
  assert.equal(runs, 1);
});
