import test from 'node:test';
import assert from 'node:assert/strict';

import { createInputQueue, createSdkRuntime } from '../sdk-runtime.mjs';

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

test('createSession()：项目路径校验失败时抛 400 且不加载 SDK', async () => {
  let loads = 0;
  const runtime = createSdkRuntime({
    resolveProject: () => {
      throw new Error('项目路径无效');
    },
    loadSdk: () => {
      loads += 1;
      return Promise.resolve({ query: () => {} });
    },
  });

  await assert.rejects(runtime.createSession({ projectPath: 'C:\\Windows' }), (error) => {
    assert.equal(error.statusCode, 400);
    assert.ok(error.message.includes('项目路径无效'));
    return true;
  });
  assert.equal(loads, 0, '路径校验失败时不应加载 SDK');
});

test('createSession()：路径有效且 SDK 可用时暂时抛出 501', async () => {
  const runtime = createSdkRuntime({
    resolveProject: (value) => value,
    loadSdk: () => Promise.resolve({ query: () => {} }),
  });

  await assert.rejects(runtime.createSession({ projectPath: 'C:\\已登记项目' }), (error) => {
    assert.equal(error.statusCode, 501);
    return true;
  });
});
