/**
 * Claude Agent SDK 运行时骨架。
 *
 * 本模块后续承担 SDK 会话生命周期与事件分发；当前阶段只提供输入队列与健康检查
 * 的最小可用实现，其余会话方法留待后续任务补齐。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * 创建 SDK 会话的输入队列。
 *
 * 返回对象同时实现异步迭代协议，SDK 侧可直接使用 for await 消费用户消息。
 *
 * @returns {{ push: (message: unknown) => unknown, close: () => void, next: () => Promise<{ value: unknown, done: boolean }>, [Symbol.asyncIterator]: () => unknown }}
 */
export function createInputQueue() {
  /** 待消费的消息缓冲 */
  const buffer = [];
  /** 当前挂起等待消息的 next() 回调 */
  const waiters = [];
  /** 队列是否已关闭 */
  let closed = false;

  return {
    /**
     * 放入一条消息；若有挂起的 next() 则直接唤醒它。
     * 按约定返回该消息本身。
     */
    push(message) {
      if (closed) {
        // 队列已关闭时不再投递，但仍按契约原样返回消息
        return message;
      }

      const waiter = waiters.shift();
      if (waiter) {
        waiter(message, false);
      } else {
        buffer.push(message);
      }
      return message;
    },

    /**
     * 关闭队列；重复调用保持幂等。
     * 关闭时丢弃尚未消费的缓冲，并唤醒所有挂起的 next()。
     */
    close() {
      if (closed) {
        return;
      }
      closed = true;
      buffer.length = 0;

      while (waiters.length > 0) {
        const waiter = waiters.shift();
        waiter(undefined, true);
      }
    },

    /**
     * 取出一条消息；无数据且未关闭时保持挂起，直到被 push() 或 close() 唤醒。
     */
    next() {
      if (closed) {
        return Promise.resolve({ value: undefined, done: true });
      }
      if (buffer.length > 0) {
        return Promise.resolve({ value: buffer.shift(), done: false });
      }

      return new Promise((resolve) => {
        waiters.push((value, done) => resolve({ value, done: Boolean(done) }));
      });
    },

    /**
     * 返回自身作为异步迭代器，便于 SDK 侧按顺序消费消息。
     */
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

/**
 * 创建 SDK 运行时骨架。
 *
 * @param {object} [options] 依赖注入项
 * @param {(projectPath: string) => string} [options.resolveProject] 项目路径校验（后续任务使用）
 * @param {() => { path: string, source: string }} [options.resolveExecutable] 运行时可执行文件解析（后续任务使用）
 * @param {() => object} [options.buildChannelEnv] 渠道环境构造（后续任务使用）
 * @param {string} [options.sessionFile] 会话记录文件路径（后续任务使用）
 * @param {() => object} [options.loadSdk] SDK 加载函数，注入后才视为可用
 * @returns {{ health: () => object, createSession: Function, send: Function, interrupt: Function, close: Function, get: Function, subscribe: Function, shutdown: Function }}
 */
export function createSdkRuntime({
  resolveProject,
  resolveExecutable,
  buildChannelEnv,
  sessionFile,
  loadSdk,
} = {}) {
  /** 会话表：会话 id -> 会话对象；本阶段尚未创建任何会话 */
  const sessions = new Map();
  /** 已加载的 SDK 模块缓存，避免重复加载 */
  let cachedSdk = null;

  /**
   * 读取已安装 SDK 包的版本号；读取失败时返回 null。
   */
  function readSdkVersion() {
    try {
      return require('@anthropic-ai/claude-agent-sdk/package.json').version;
    } catch {
      return null;
    }
  }

  /**
   * 健康检查：返回 SDK 是否可用以及运行时信息。
   */
  function health() {
    const result = {
      available: false,
      sdkVersion: null,
      runtimePath: '',
      runtimeSource: 'bundled',
      nodeVersion: process.version,
      error: null,
    };

    if (typeof loadSdk !== 'function') {
      result.error = '未注入 SDK 加载函数 loadSdk，Claude Agent SDK 不可用';
      return result;
    }

    try {
      cachedSdk = cachedSdk ?? loadSdk();
      if (!cachedSdk || typeof cachedSdk.query !== 'function') {
        throw new Error('Claude Agent SDK 缺少 query 导出');
      }
      result.available = true;
      result.sdkVersion = readSdkVersion();
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  /**
   * 生成“尚未实现”错误，供后续任务逐步替换骨架方法。
   */
  function notImplemented(name) {
    const error = new Error(`${name} 尚未实现`);
    error.statusCode = 501;
    return error;
  }

  return {
    health,

    createSession() {
      throw notImplemented('createSession');
    },

    send() {
      throw notImplemented('send');
    },

    interrupt() {
      throw notImplemented('interrupt');
    },

    close() {
      throw notImplemented('close');
    },

    /**
     * 查询会话摘要；本阶段会话表为空，始终返回 null。
     */
    get(id) {
      return sessions.get(id) ?? null;
    },

    subscribe() {
      throw notImplemented('subscribe');
    },

    shutdown() {
      throw notImplemented('shutdown');
    },
  };
}
