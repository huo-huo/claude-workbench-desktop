import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createInputQueue, createSdkRuntime } from '../sdk-runtime.mjs';

/**
 * 创建可控的 mock SDK。
 *
 * query() 同步返回一个带 interrupt() 的异步迭代器；测试可手动 push/end/fail
 * 消息，从而精确验证会话消费循环与事件广播行为。
 */
function createMockSdk() {
  /** 每次 query() 的调用参数与消息流 */
  const calls = [];
  const sdk = {
    query(params) {
      const stream = createMockStream();
      calls.push({ params, stream });
      return {
        [Symbol.asyncIterator]: () => stream,
        interrupt: async () => {
          stream.interruptCalls += 1;
        },
      };
    },
  };
  return { sdk, calls };
}

/** 创建可手动推入消息 / 结束 / 失败的异步消息流 */
function createMockStream() {
  const buffer = [];
  const waiters = [];
  let finished = false;
  let failure = null;

  return {
    /** interrupt() 被调用的次数 */
    interruptCalls: 0,

    /** 推入一条 SDK 消息 */
    push(message) {
      const waiter = waiters.shift();
      if (waiter) waiter.resolve({ value: message, done: false });
      else buffer.push(message);
    },

    /** 正常结束消息流 */
    end() {
      if (finished) return;
      finished = true;
      while (waiters.length > 0) waiters.shift().resolve({ value: undefined, done: true });
    },

    /** 让消息流抛出错误 */
    fail(error) {
      if (finished) return;
      finished = true;
      failure = error;
      while (waiters.length > 0) waiters.shift().reject(error);
      waiters.length = 0;
    },

    next() {
      if (buffer.length > 0) return Promise.resolve({ value: buffer.shift(), done: false });
      if (failure) {
        const error = failure;
        failure = null;
        return Promise.reject(error);
      }
      if (finished) return Promise.resolve({ value: undefined, done: true });
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },

    /** for await 提前退出时调用 */
    return() {
      this.end();
      return Promise.resolve({ value: undefined, done: true });
    },

    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/** 等待消息流与事件广播完成一轮异步处理 */
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** 创建临时目录，测试结束时清理，避免污染真实 ~/.claude */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwb-sdk-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 构造注入了 mock SDK 与临时记录文件的运行时 */
function createTestRuntime({ sdk, sessionFile, resolveProject, resolveExecutable, buildChannelEnv } = {}) {
  return createSdkRuntime({
    resolveProject: resolveProject || ((value) => `C:\\规范\\${value}`),
    resolveExecutable: resolveExecutable || (() => ({ path: '', source: 'bundled' })),
    buildChannelEnv: buildChannelEnv || (() => ({ CWB_CHANNEL: 'test' })),
    sessionFile,
    loadSdk: () => sdk,
  });
}

test('输入队列：无数据时 next() 挂起，push() 唤醒并返回该消息', async () => {
  const queue = createInputQueue();
  let settled = false;

  // 先发起 next()，此时队列为空，应当处于挂起状态
  const pending = queue.next().then((result) => {
    settled = true;
    return result;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false, '队列为空时 next() 不应提前完成');

  // push() 应当唤醒挂起的 next()，并把消息原样返回
  const message = { type: 'user', message: { role: 'user', content: '你好' } };
  assert.equal(queue.push(message), message);
  assert.deepEqual(await pending, { value: message, done: false });
});

test('输入队列：close() 后 next() 返回 done，重复 close() 幂等', async () => {
  const queue = createInputQueue();

  // 关闭时仍处于挂起状态的 next() 也应得到 done 结果
  const waiting = queue.next();
  queue.close();

  assert.deepEqual(await waiting, { value: undefined, done: true });
  assert.deepEqual(await queue.next(), { value: undefined, done: true });

  // 重复关闭不应抛错，行为保持幂等
  queue.close();
  assert.deepEqual(await queue.next(), { value: undefined, done: true });
});

test('输入队列：暴露异步迭代器并支持逐条消费', async () => {
  const queue = createInputQueue();
  const iterator = queue[Symbol.asyncIterator]();

  queue.push('第一条');
  assert.deepEqual(await iterator.next(), { value: '第一条', done: false });

  queue.close();
  assert.deepEqual(await iterator.next(), { value: undefined, done: true });
});

test('createSdkRuntime：返回约定的方法集合', () => {
  const runtime = createSdkRuntime({});
  for (const name of [
    'health',
    'createSession',
    'send',
    'interrupt',
    'close',
    'get',
    'subscribe',
    'shutdown',
  ]) {
    assert.equal(typeof runtime[name], 'function', `${name} 应当是函数`);
  }
});

test('health()：未注入 loadSdk 时返回不可用且有错误信息', async () => {
  const runtime = createSdkRuntime({});
  const health = await runtime.health();

  assert.equal(health.available, false);
  assert.equal(typeof health.error, 'string');
  assert.ok(health.error.length > 0, 'error 应当是非空字符串');
  assert.equal(health.nodeVersion, process.version);
  assert.ok('sdkVersion' in health);
  assert.equal(health.runtimePath, '');
  assert.equal(health.runtimeSource, 'bundled');
});

test('health()：loadSdk 抛错时返回不可用且有错误信息', async () => {
  const runtime = createSdkRuntime({
    loadSdk: () => {
      throw new Error('模拟 SDK 加载失败');
    },
  });
  const health = await runtime.health();

  assert.equal(health.available, false);
  assert.equal(typeof health.error, 'string');
  assert.ok(health.error.includes('模拟 SDK 加载失败'));
  assert.equal(health.nodeVersion, process.version);
});

test('health()：env 指定的运行时存在时采用该路径', async () => {
  // process.execPath 在当前环境必然存在，可代表合法的运行时文件
  const runtimePath = process.execPath;
  const runtime = createSdkRuntime({
    resolveExecutable: () => ({ path: runtimePath, source: 'env' }),
    loadSdk: () => Promise.resolve({ query: () => {} }),
  });
  const health = await runtime.health();

  assert.equal(health.available, true);
  assert.equal(health.runtimePath, runtimePath);
  assert.equal(health.runtimeSource, 'env');
  assert.equal(health.error, null);
  assert.equal(health.nodeVersion, process.version);
});

test('health()：installed 运行时存在时采用该路径', async () => {
  const runtimePath = process.execPath;
  const runtime = createSdkRuntime({
    resolveExecutable: () => ({ path: runtimePath, source: 'installed' }),
    loadSdk: () => Promise.resolve({ query: () => {} }),
  });
  const health = await runtime.health();

  assert.equal(health.available, true);
  assert.equal(health.runtimePath, runtimePath);
  assert.equal(health.runtimeSource, 'installed');
});

test('health()：没有可用运行时路径时回落到 bundled', async () => {
  const runtime = createSdkRuntime({
    resolveExecutable: () => ({ path: '', source: 'bundled' }),
    loadSdk: () => Promise.resolve({ query: () => {} }),
  });
  const health = await runtime.health();

  assert.equal(health.available, true);
  assert.equal(health.runtimePath, '');
  assert.equal(health.runtimeSource, 'bundled');
});

test('health()：env 指定的运行时不存时不可用并说明原因', async () => {
  const missing = 'C:\\不存在的目录\\claude.exe';
  const runtime = createSdkRuntime({
    resolveExecutable: () => ({ path: missing, source: 'env' }),
    loadSdk: () => Promise.resolve({ query: () => {} }),
  });
  const health = await runtime.health();

  assert.equal(health.available, false);
  assert.equal(health.runtimePath, missing);
  assert.equal(health.runtimeSource, 'env');
  assert.ok(health.error.includes('不存在'), 'error 应说明指定的运行时不存在');
  assert.ok(health.error.includes(missing), 'error 应包含具体路径');
});

test('health()：loadSdk 返回 Promise 时只加载一次', async () => {
  let loads = 0;
  const runtime = createSdkRuntime({
    loadSdk: () => {
      loads += 1;
      return Promise.resolve({ query: () => {} });
    },
  });

  const first = await runtime.health();
  const second = await runtime.health();

  assert.equal(first.available, true);
  assert.equal(second.available, true);
  assert.equal(loads, 1, '缓存的 Promise 不应重复加载');
});

test('health()：SDK 模块缺少 query 时不可用', async () => {
  const runtime = createSdkRuntime({
    loadSdk: () => Promise.resolve({}),
  });
  const health = await runtime.health();

  assert.equal(health.available, false);
  assert.ok(health.error.length > 0);
});

test('health()：可用时读取已安装 SDK 的版本号', async () => {
  const runtime = createSdkRuntime({
    loadSdk: () => import('@anthropic-ai/claude-agent-sdk'),
  });
  const health = await runtime.health();

  assert.equal(health.available, true);
  assert.match(String(health.sdkVersion), /^\d+\.\d+\.\d+/, 'sdkVersion 应是语义化版本号');
});

test('health()：SDK 加载失败后缓存原因，不重复加载', async () => {
  let loads = 0;
  const runtime = createSdkRuntime({
    loadSdk: () => {
      loads += 1;
      throw new Error('模拟 SDK 加载失败');
    },
  });

  const first = await runtime.health();
  const second = await runtime.health();

  assert.equal(first.available, false);
  assert.ok(first.error.includes('模拟 SDK 加载失败'));
  assert.equal(second.available, false);
  assert.equal(second.error, first.error);
  assert.equal(loads, 1, '失败原因应被缓存，避免反复尝试加载');
});

test('createSession()：SDK 不可用时抛出 503', async () => {
  const runtime = createSdkRuntime({
    resolveProject: () => 'C:\\已登记项目',
    loadSdk: () => {
      throw new Error('模拟 SDK 加载失败');
    },
  });

  await assert.rejects(runtime.createSession({ projectPath: 'C:\\已登记项目' }), (error) => {
    assert.equal(error.statusCode, 503);
    assert.ok(error.message.length > 0);
    return true;
  });
});

test('createSession()：项目路径校验失败时抛 400 且不启动查询', async () => {
  let queries = 0;
  const runtime = createSdkRuntime({
    resolveProject: () => {
      throw new Error('项目路径无效');
    },
    loadSdk: () => Promise.resolve({
      query: () => {
        queries += 1;
        return createMockStream();
      },
    }),
  });

  await assert.rejects(runtime.createSession({ projectPath: 'C:\\Windows' }), (error) => {
    assert.equal(error.statusCode, 400);
    assert.ok(error.message.includes('项目路径无效'));
    return true;
  });
  assert.equal(queries, 0, '路径校验失败时不应启动 SDK 查询');
});

test('3.1 创建会话：返回 id、eventUrl 与 starting，query 只调用一次', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });

  const session = await runtime.createSession({ projectPath: '我的项目', prompt: '你好', model: 'claude-opus' });

  assert.match(session.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/);
  assert.equal(session.sessionId, '');
  assert.equal(session.status, 'starting');
  assert.equal(session.projectPath, 'C:\\规范\\我的项目');
  assert.equal(session.eventUrl, `/api/sdk/events?session=${session.id}`);
  assert.equal(calls.length, 1, '每条会话应只调用一次 query');

  // 初始提示词应进入输入队列，结构遵循 SDK 流式输入约定
  assert.deepEqual(await calls[0].params.prompt.next(), {
    value: { type: 'user', session_id: '', message: { role: 'user', content: '你好' }, parent_tool_use_id: null },
    done: false,
  });

  const { options } = calls[0].params;
  assert.equal(options.cwd, 'C:\\规范\\我的项目');
  assert.equal(options.permissionMode, 'default');
  assert.equal(options.includePartialMessages, false);
  assert.equal(options.model, 'claude-opus');
  assert.equal(options.env.CWB_CHANNEL, 'test');
  assert.equal(options.pathToClaudeCodeExecutable, undefined, 'bundled 运行时不应传路径');
  assert.ok(options.abortController instanceof AbortController);

  // 权限回调只放行只读工具，并在放行时原样回传 input
  assert.deepEqual(await options.canUseTool('Read', { file_path: 'a.txt' }), {
    behavior: 'allow',
    updatedInput: { file_path: 'a.txt' },
  });
  const denied = await options.canUseTool('Bash', { command: 'dir' });
  assert.equal(denied.behavior, 'deny');
  assert.ok(denied.message.includes('Bash'));
});

test('3.1 创建会话：自定义权限模式与非 bundled 运行时路径', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({
    sdk,
    sessionFile: path.join(dir, 'sessions.json'),
    resolveExecutable: () => ({ path: process.execPath, source: 'installed' }),
  });

  await runtime.createSession({ projectPath: '项目', permissionMode: 'plan' });

  const { options } = calls[0].params;
  assert.equal(options.permissionMode, 'plan');
  assert.equal(options.pathToClaudeCodeExecutable, process.execPath);
  assert.equal(options.model, undefined);
});

test('3.1 创建会话：路径校验的原始状态码优先于默认 400', async (t) => {
  const { sdk } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({
    sdk,
    sessionFile: path.join(dir, 'sessions.json'),
    resolveProject: () => {
      const error = new Error('项目路径被禁用');
      error.statusCode = 403;
      throw error;
    },
  });

  await assert.rejects(runtime.createSession({ projectPath: '项目' }), (error) => {
    assert.equal(error.statusCode, 403);
    return true;
  });
});

test('3.2 发送提示词：连续两条消息依次进入输入队列', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });

  const first = runtime.send(session.id, '第一条');
  assert.deepEqual(first, { accepted: true, status: 'running' });
  const second = runtime.send(session.id, '第二条');
  assert.deepEqual(second, { accepted: true, status: 'running' });

  const queue = calls[0].params.prompt;
  assert.deepEqual(await queue.next(), {
    value: { type: 'user', session_id: '', message: { role: 'user', content: '第一条' }, parent_tool_use_id: null },
    done: false,
  });
  assert.deepEqual(await queue.next(), {
    value: { type: 'user', session_id: '', message: { role: 'user', content: '第二条' }, parent_tool_use_id: null },
    done: false,
  });
});

test('3.2 发送提示词：不存在 404、空提示词 400', async (t) => {
  const { sdk } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });

  assert.throws(() => runtime.send('不存在的会话', '你好'), (error) => {
    assert.equal(error.statusCode, 404);
    return true;
  });
  assert.throws(() => runtime.send(session.id, '   '), (error) => {
    assert.equal(error.statusCode, 400);
    return true;
  });
  assert.throws(() => runtime.send(session.id, null), (error) => {
    assert.equal(error.statusCode, 400);
    return true;
  });
});

test('3.3 事件流：init/result 驱动状态，订阅先 ready 回放再收新事件', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });
  const { stream } = calls[0];

  stream.push({ type: 'system', subtype: 'init', session_id: 'sdk-session-1' });
  stream.push({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '你好' }] } });
  stream.push({ type: 'result', subtype: 'success', session_id: 'sdk-session-1' });
  await flush();

  assert.equal(runtime.get(session.id).sessionId, 'sdk-session-1', 'init 应回填 SDK 会话标识');
  assert.equal(runtime.get(session.id).status, 'idle', 'result 应把状态置为 idle');

  const received = [];
  const unsubscribe = runtime.subscribe(session.id, (message) => received.push(message));

  assert.equal(received[0].type, 'ready');
  assert.equal(received[0].sessionId, session.id);
  assert.equal(received[0].status, 'idle');
  assert.equal(received[0].replay, 3, 'ready 应报告缓冲条数');
  assert.deepEqual(received.slice(1).map((item) => item.eventType), ['system.init', 'assistant', 'result.success']);
  assert.deepEqual(received[1], {
    type: 'event',
    sessionId: session.id,
    eventType: 'system.init',
    event: { type: 'system', subtype: 'init', session_id: 'sdk-session-1' },
  });

  // 订阅之后的新事件应实时推送
  stream.push({ type: 'assistant', message: { role: 'assistant', content: [] } });
  await flush();
  assert.equal(received.at(-1).eventType, 'assistant');
  assert.equal(received.length, 5);

  unsubscribe();
});

test('3.3 事件缓冲：最多保留最近 100 条', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });
  const { stream } = calls[0];

  for (let index = 0; index < 105; index += 1) {
    stream.push({ type: 'assistant', index, message: { role: 'assistant', content: [] } });
  }
  await flush();

  const received = [];
  runtime.subscribe(session.id, (message) => received.push(message));
  assert.equal(received[0].replay, 100, '缓冲应裁剪到最近 100 条');
  assert.equal(received[1].event.index, 5, '应保留最新 100 条，丢弃最早的 5 条');
  assert.equal(received.at(-1).event.index, 104);
});

test('3.3 事件流：循环正常结束置 exited 并广播 exit', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });

  const received = [];
  runtime.subscribe(session.id, (message) => received.push(message));
  calls[0].stream.end();
  await flush();

  assert.equal(runtime.get(session.id).status, 'exited');
  assert.deepEqual(received.at(-1), { type: 'exit', sessionId: session.id });
});

test('3.3 事件流：循环抛错置 failed 并广播 error 与 exit', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });

  const received = [];
  runtime.subscribe(session.id, (message) => received.push(message));
  calls[0].stream.fail(new Error('模拟运行时崩溃'));
  await flush();

  assert.equal(runtime.get(session.id).status, 'failed');
  const errorEvent = received.find((message) => message.type === 'error');
  assert.ok(errorEvent, '应广播 error 消息');
  assert.equal(errorEvent.sessionId, session.id);
  assert.ok(errorEvent.message.includes('模拟运行时崩溃'));
  assert.deepEqual(received.at(-1), { type: 'exit', sessionId: session.id });
});

test('3.5 中断：仅 running 状态调用 query.interrupt()', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });
  const { stream } = calls[0];

  // starting 状态不触发 SDK 中断
  assert.deepEqual(await runtime.interrupt(session.id), { interrupted: false });
  assert.equal(stream.interruptCalls, 0);

  stream.push({ type: 'system', subtype: 'init', session_id: 'sdk-session-1' });
  await flush();
  assert.deepEqual(await runtime.interrupt(session.id), { interrupted: true });
  assert.equal(stream.interruptCalls, 1);

  // 中断后收到 result 回到 idle，再次中断不再调用 SDK
  stream.push({ type: 'result', subtype: 'success' });
  await flush();
  assert.deepEqual(await runtime.interrupt(session.id), { interrupted: false });
  assert.equal(stream.interruptCalls, 1);

  await assert.rejects(runtime.interrupt('不存在的会话'), (error) => {
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test('3.5 关闭：幂等、广播 exit、关闭后订阅与发送返回 409', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });
  const { stream } = calls[0];

  const received = [];
  runtime.subscribe(session.id, (message) => received.push(message));

  assert.deepEqual(await runtime.close(session.id), { closed: true });
  assert.equal(runtime.get(session.id).status, 'closed');
  assert.deepEqual(received.at(-1), { type: 'exit', sessionId: session.id, reason: 'closed' });

  // 关闭后订阅与发送均拒绝
  await assert.rejects(async () => runtime.subscribe(session.id, () => {}), (error) => {
    assert.equal(error.statusCode, 409);
    return true;
  });
  assert.throws(() => runtime.send(session.id, '你好'), (error) => {
    assert.equal(error.statusCode, 409);
    return true;
  });

  // 重复关闭幂等，未知会话仍 404
  assert.deepEqual(await runtime.close(session.id), { closed: true });
  await assert.rejects(runtime.close('不存在的会话'), (error) => {
    assert.equal(error.statusCode, 404);
    return true;
  });

  // 关闭后即使消息流继续产出也不再广播
  const countBefore = received.length;
  stream.push({ type: 'assistant', message: { role: 'assistant', content: [] } });
  await flush();
  assert.equal(received.length, countBefore, '关闭后不应再广播事件');
});

test('3.5 shutdown：关闭全部会话且重复调用不抛错', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const first = await runtime.createSession({ projectPath: '项目一' });
  const second = await runtime.createSession({ projectPath: '项目二' });

  await runtime.shutdown();
  assert.equal(runtime.get(first.id).status, 'closed');
  assert.equal(runtime.get(second.id).status, 'closed');
  assert.equal(calls.length, 2);

  // 再次调用保持幂等且不抛错
  await runtime.shutdown();
});

test('3.6 会话记录：创建与状态变化写入独立文件', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const file = path.join(dir, 'sdk-sessions.json');
  const runtime = createTestRuntime({ sdk, sessionFile: file });
  const session = await runtime.createSession({ projectPath: '项目' });

  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  let saved = read();
  assert.equal(saved.sessions.length, 1);
  assert.deepEqual(
    Object.keys(saved.sessions[0]).sort(),
    ['createdAt', 'id', 'lastUsedAt', 'projectPath', 'sessionId', 'status'],
    '记录字段应与约定结构一致',
  );
  assert.equal(saved.sessions[0].id, session.id);
  assert.equal(saved.sessions[0].status, 'starting');
  assert.equal(saved.sessions[0].sessionId, '');

  calls[0].stream.push({ type: 'system', subtype: 'init', session_id: 'sdk-session-1' });
  await flush();
  saved = read();
  assert.equal(saved.sessions[0].status, 'running');
  assert.equal(saved.sessions[0].sessionId, 'sdk-session-1');

  await runtime.close(session.id);
  saved = read();
  assert.equal(saved.sessions[0].status, 'closed');
});

test('3.6 会话记录：损坏文件按空记录回退', async (t) => {
  const { sdk } = createMockSdk();
  const dir = tempDir(t);
  const file = path.join(dir, 'sdk-sessions.json');
  fs.writeFileSync(file, '{ 这不是合法 JSON', 'utf8');

  const runtime = createTestRuntime({ sdk, sessionFile: file });
  const session = await runtime.createSession({ projectPath: '项目' });

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.sessions.length, 1);
  assert.equal(saved.sessions[0].id, session.id);
});

test('3.6 会话记录：最多保留 200 条并保留最新', async (t) => {
  const { sdk } = createMockSdk();
  const dir = tempDir(t);
  const file = path.join(dir, 'sdk-sessions.json');
  const runtime = createTestRuntime({ sdk, sessionFile: file });

  const created = [];
  for (let index = 0; index < 201; index += 1) {
    created.push(await runtime.createSession({ projectPath: `项目${index}` }));
  }

  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.sessions.length, 200);
  const ids = new Set(saved.sessions.map((item) => item.id));
  assert.ok(ids.has(created.at(-1).id), '最新会话应被保留');
  assert.ok(!ids.has(created[0].id), '最早的会话应被裁剪');
});

test('3.6 会话记录：不读写终端会话文件', async (t) => {
  const { sdk } = createMockSdk();
  const dir = tempDir(t);
  const workspaceFile = path.join(dir, 'workbench-workspace.json');
  const sdkFile = path.join(dir, 'workbench-sdk-sessions.json');
  const workspaceContent = `${JSON.stringify({ projects: [], sessions: [{ id: '终端会话' }] }, null, 2)}\n`;
  fs.writeFileSync(workspaceFile, workspaceContent, 'utf8');

  const runtime = createTestRuntime({ sdk, sessionFile: sdkFile });
  await runtime.createSession({ projectPath: '项目' });

  assert.ok(fs.existsSync(sdkFile), 'SDK 会话记录应写入独立文件');
  assert.equal(fs.readFileSync(workspaceFile, 'utf8'), workspaceContent, '终端会话文件不应被读写');
});

test('3.4 重连续接：取消订阅不影响会话，重连收到完整回放并继续收新事件', async (t) => {
  const { sdk, calls } = createMockSdk();
  const dir = tempDir(t);
  const runtime = createTestRuntime({ sdk, sessionFile: path.join(dir, 'sessions.json') });
  const session = await runtime.createSession({ projectPath: '项目' });
  const { stream } = calls[0];

  stream.push({ type: 'system', subtype: 'init', session_id: 'sdk-session-1' });
  stream.push({ type: 'assistant', message: { role: 'assistant', content: [] } });
  await flush();

  // 第一次订阅后立即取消
  const first = [];
  const unsubscribe = runtime.subscribe(session.id, (message) => first.push(message));
  assert.equal(first[0].type, 'ready');
  assert.equal(first[0].replay, 2);
  unsubscribe();

  // 断线期间产生的事件仍进入缓冲
  stream.push({ type: 'assistant', message: { role: 'assistant', content: [] } });
  await flush();

  // 重连：再次收到 ready 与完整回放
  const second = [];
  runtime.subscribe(session.id, (message) => second.push(message));
  assert.equal(second[0].type, 'ready');
  assert.equal(second[0].replay, 3, '重连应回放全部缓冲');
  assert.equal(second.filter((message) => message.type === 'event').length, 3);

  // 会话状态与输入队列不受取消订阅影响
  assert.equal(runtime.get(session.id).status, 'running');
  assert.deepEqual(runtime.send(session.id, '重连后的消息'), { accepted: true, status: 'running' });
  assert.equal((await calls[0].params.prompt.next()).value.message.content, '重连后的消息');

  // 新事件继续推送给重连后的订阅者
  stream.push({ type: 'assistant', message: { role: 'assistant', content: [] } });
  await flush();
  assert.equal(second.at(-1).eventType, 'assistant');
  assert.equal(second.filter((message) => message.type === 'event').length, 4);
});
