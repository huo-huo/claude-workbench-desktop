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

test('health()：未注入 loadSdk 时返回不可用且有错误信息', () => {
  const runtime = createSdkRuntime({});
  const health = runtime.health();

  assert.equal(health.available, false);
  assert.equal(typeof health.error, 'string');
  assert.ok(health.error.length > 0, 'error 应当是非空字符串');
  assert.equal(health.nodeVersion, process.version);
  assert.ok('sdkVersion' in health);
  assert.ok('runtimePath' in health);
  assert.ok('runtimeSource' in health);
});

test('health()：loadSdk 抛错时返回不可用且有错误信息', () => {
  const runtime = createSdkRuntime({
    loadSdk: () => {
      throw new Error('模拟 SDK 加载失败');
    },
  });
  const health = runtime.health();

  assert.equal(health.available, false);
  assert.equal(typeof health.error, 'string');
  assert.ok(health.error.includes('模拟 SDK 加载失败'));
  assert.equal(health.nodeVersion, process.version);
});
