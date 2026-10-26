import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { enrichStatusline } from '../server/statusline/enrich.mjs';

/** 创建带 todos 文件的临时目录；返回目录路径，测试结束后清理 */
function createTodosDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-enrich-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

test('enrichStatusline 解析最新 agent todos 文件的完成进度', () => {
  const dir = createTodosDir({
    'sess-agent-a1.json': [{ content: 'a', status: 'completed' }, { content: 'b', status: 'pending' }],
    'sess-agent-b2.json': [{ content: 'c', status: 'completed' }, { content: 'd', status: 'completed' }],
  });
  // b2 文件修改时间更新，应被选中（强制设置 mtime 保证确定性）
  const now = Date.now() / 1000;
  fs.utimesSync(path.join(dir, 'sess-agent-a1.json'), now - 60, now - 60);
  fs.utimesSync(path.join(dir, 'sess-agent-b2.json'), now, now);
  const extra = enrichStatusline({ session_id: 'sess' }, { todosDir: dir });
  assert.deepEqual(extra.todo, { completed: 2, total: 2 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enrichStatusline 兼容 { todos: [...] } 包裹格式', () => {
  const dir = createTodosDir({
    'sess-agent-x.json': { sessionId: 'sess', todos: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }] },
  });
  const extra = enrichStatusline({ session_id: 'sess' }, { todosDir: dir });
  assert.deepEqual(extra.todo, { completed: 1, total: 3 });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enrichStatusline 无 todos 文件时省略 todo 字段', () => {
  const dir = createTodosDir({});
  const extra = enrichStatusline({ session_id: 'none' }, { todosDir: dir });
  assert.equal('todo' in extra, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enrichStatusline todos 文件损坏时省略 todo 字段', () => {
  const dir = createTodosDir({ 'bad-agent-x.json': '{not json' });
  const extra = enrichStatusline({ session_id: 'bad' }, { todosDir: dir });
  assert.equal('todo' in extra, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enrichStatusline 缺 session_id 时返回空补充', () => {
  const extra = enrichStatusline({}, { todosDir: os.tmpdir() });
  assert.equal('todo' in extra, false);
});

/** 创建伪造 transcript 的临时文件并返回路径 */
function createTranscript(lines) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-tr-')), 't.jsonl');
  fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n'));
  return file;
}

test('转发数据自带 context_window 与 cost 时优先使用，不读 transcript', () => {
  const extra = enrichStatusline({
    session_id: 's',
    context_window: { used_percentage: 42 },
    cost: { total_cost_usd: 0.5 },
  }, { todosDir: os.tmpdir() });
  assert.equal(extra.context.usedPercentage, 42);
  assert.equal(extra.cost, 0.5);
});

test('缺失时回退解析 transcript 的 usage 与 costUSD', () => {
  const transcript = createTranscript([
    { type: 'assistant', costUSD: 0.2, message: { usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10, output_tokens: 5 } } },
    { type: 'assistant', costUSD: 0.3, message: { usage: { input_tokens: 200, cache_read_input_tokens: 60, cache_creation_input_tokens: 20, output_tokens: 8 } } },
    { type: 'user', message: { role: 'user', content: 'hi' } },
  ]);
  const extra = enrichStatusline({ session_id: 's', transcript_path: transcript }, { todosDir: os.tmpdir() });
  // 最后一条 assistant 的完整 usage 之和即当前上下文（输入+输出+缓存，与 claude-hud 同口径）
  assert.equal(extra.context.usedTokens, 288);
  assert.equal(extra.cost, 0.5);
  // 全量累计：输入 300、输出 13、缓存 140
  assert.deepEqual(extra.tokens, { input: 300, output: 13, cache: 140 });
});

test('transcript 中途损坏行被跳过', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-tr-')), 't.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'assistant', costUSD: 0.1, message: { usage: { input_tokens: 10 } } }),
    '{broken',
    JSON.stringify({ type: 'assistant', costUSD: 0.1, message: { usage: { input_tokens: 20 } } }),
  ].join('\n'));
  const extra = enrichStatusline({ session_id: 's', transcript_path: file }, { todosDir: os.tmpdir() });
  assert.equal(extra.context.usedTokens, 20);
  assert.equal(extra.cost, 0.2);
});

test('同一 message.id 的重复写入只累计增量（Claude Code dual-logging）', () => {
  // streaming 场景：同一响应先写中间帧再写最终帧，只应累计增量 300/5/10
  const transcript = createTranscript([
    { type: 'assistant', message: { id: 'msg_1', usage: { input_tokens: 100, output_tokens: 3, cache_read_input_tokens: 10 } } },
    { type: 'assistant', message: { id: 'msg_1', usage: { input_tokens: 400, output_tokens: 8, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 } } },
    { type: 'assistant', message: { id: 'msg_2', usage: { input_tokens: 50 } } },
  ]);
  const extra = enrichStatusline({ session_id: 's', transcript_path: transcript }, { todosDir: os.tmpdir() });
  // 首次出现按全量累计，同 id 后续出现只计增量：input 100+300+50，output 3+5，cache 10+20
  assert.deepEqual(extra.tokens, { input: 450, output: 8, cache: 30 });
  // 当前上下文快照取最后一条 assistant 的完整 usage
  assert.equal(extra.context.usedTokens, 50);
});

test('行内 sessionId 与会话不符的条目不计入累计', () => {
  // resume 场景：transcript 文件里混入其他会话的条目
  const transcript = createTranscript([
    { type: 'assistant', sessionId: 'other-session', message: { id: 'msg_x', usage: { input_tokens: 9000 } } },
    { type: 'assistant', sessionId: 's', message: { id: 'msg_1', usage: { input_tokens: 100 } } },
    { type: 'assistant', message: { id: 'msg_2', usage: { input_tokens: 40 } } },
  ]);
  const extra = enrichStatusline({ session_id: 's', transcript_path: transcript }, { todosDir: os.tmpdir() });
  // other-session 的 9000 不计入；行内无 sessionId 的条目无法判断，仍计入
  assert.deepEqual(extra.tokens, { input: 140, output: 0, cache: 0 });
  assert.equal(extra.context.usedTokens, 40);
});

test('transcript 文件缺失时省略 context 与 cost', () => {
  const extra = enrichStatusline({ session_id: 's', transcript_path: 'E:\\no\\such\\file.jsonl' }, { todosDir: os.tmpdir() });
  assert.equal('context' in extra, false);
  assert.equal('cost' in extra, false);
});

test('无 transcript_path 也无自带字段时省略 context 与 cost', () => {
  const extra = enrichStatusline({ session_id: 's' }, { todosDir: os.tmpdir() });
  assert.equal('context' in extra, false);
  assert.equal('cost' in extra, false);
});
