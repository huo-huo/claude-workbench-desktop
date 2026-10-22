#!/usr/bin/env node
/**
 * Claude Agent SDK 冒烟脚本。
 *
 * 按「健康检查 → 创建会话 → 订阅事件 → 发送提示词 → 收到 result → 中断 → 关闭」的顺序
 * 验证本地服务上的 SDK 接口，每一步打印结果。
 *
 * 用法：
 *   node scripts/sdk-smoke.mjs --base http://127.0.0.1:4199
 *   node scripts/sdk-smoke.mjs --base http://127.0.0.1:4199 --health-only
 *
 * 退出码：全部通过或环境不满足（未登记项目）为 0，任一断言失败为 1。
 * 脚本只关闭自己创建的会话，不读写 ~/.claude/settings.json。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

/** 默认服务地址，与 server.mjs 的默认端口一致 */
const DEFAULT_BASE = 'http://127.0.0.1:4173';
/** 等待 result 事件的超时时间 */
const RESULT_TIMEOUT_MS = 120_000;
/** 等待 WebSocket ready 的超时时间 */
const READY_TIMEOUT_MS = 20_000;
/** 发送第二条提示词后到中断之间的等待时间 */
const INTERRUPT_DELAY_MS = 1_000;

/**
 * 解析命令行参数；未知参数直接报错，避免误用。
 *
 * @param {string[]} argv 命令行参数（不含 node 与脚本路径）
 * @returns {{ base: string, healthOnly: boolean }}
 */
function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, healthOnly: false };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--base') {
      const next = argv[index + 1];
      if (!next) throw new Error('--base 需要跟随一个服务地址');
      options.base = next;
      index += 1;
    } else if (value.startsWith('--base=')) {
      options.base = value.slice('--base='.length);
    } else if (value === '--health-only') {
      options.healthOnly = true;
    } else {
      throw new Error(`未知参数：${value}`);
    }
  }

  // 提前校验地址格式，避免后续 fetch 报出难以理解的错误
  new URL(options.base);
  return options;
}

/**
 * 发起 HTTP 请求并解析 JSON 响应。
 *
 * @param {string} base 服务地址
 * @param {string} pathname 接口路径
 * @param {{ method?: string, body?: object }} [init] 请求选项
 * @returns {Promise<{ status: number, body: any }>}
 */
async function request(base, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(new URL(pathname, base), {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, body: data };
}

/**
 * 把接口返回的相对事件路径转换为 WebSocket 地址。
 *
 * @param {string} base HTTP 服务地址
 * @param {string} eventPath 服务端返回的 eventUrl
 * @returns {string}
 */
function toWebSocketUrl(base, eventPath) {
  const target = new URL(eventPath, base);
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  return target.toString();
}

/**
 * 读取工作台登记的第一个项目路径；文件缺失或结构异常时返回空字符串。
 *
 * @returns {string}
 */
function firstRegisteredProject() {
  const file = path.join(os.homedir(), '.claude', 'workbench-workspace.json');
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const projects = Array.isArray(state?.projects) ? state.projects : [];
    const project = projects.find((item) => typeof item?.path === 'string' && item.path.trim());
    return project ? project.path : '';
  } catch {
    return '';
  }
}

/**
 * 把 WebSocket 消息包装成可等待的事件流。
 *
 * 消息到达后先入缓冲再通知等待者，保证「先到的事件」不会被漏掉；
 * 连接错误或关闭时拒绝所有挂起等待，避免脚本一直卡住。
 *
 * @param {WebSocket} socket 已创建的 WebSocket 连接
 * @returns {{ waitFor: (predicate: (message: any) => boolean, timeoutMs: number, label: string) => Promise<any> }}
 */
function createEventStream(socket) {
  /** 已收到的全部消息，用于补发先于等待到达的事件 */
  const messages = [];
  /** 当前挂起的等待者 */
  const waiters = new Set();
  /** 连接层面的失败原因 */
  let failure = null;

  /**
   * 以失败原因拒绝全部挂起等待。
   */
  function failAll(reason) {
    failure = failure || reason;
    for (const waiter of [...waiters]) waiter.reject(new Error(reason));
  }

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      // 非 JSON 消息不属于本协议，直接忽略
      return;
    }
    messages.push(message);
    for (const waiter of [...waiters]) waiter.check(message);
  });
  socket.on('error', (error) => failAll(`WebSocket 错误：${error.message}`));
  socket.on('close', () => failAll('WebSocket 已关闭'));

  /**
   * 等待满足条件的事件；命中已缓冲消息时立即返回。
   */
  function waitFor(predicate, timeoutMs, label) {
    const cached = messages.find(predicate);
    if (cached) return Promise.resolve(cached);
    if (failure) return Promise.reject(new Error(failure));

    return new Promise((resolve, reject) => {
      const waiter = {
        check(message) {
          if (!predicate(message)) return;
          cleanup();
          resolve(message);
        },
        reject(error) {
          cleanup();
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`等待 ${label} 超时（${timeoutMs} 毫秒）`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        waiters.delete(waiter);
      };
      waiters.add(waiter);
    });
  }

  return { waitFor };
}

/**
 * 简单延时。
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 打印通过的一步。
 */
function pass(index, text, detail = '') {
  console.log(`[${index}] 通过：${text}${detail ? `（${detail}）` : ''}`);
}

/**
 * 构造带步骤前缀的错误，便于定位失败位置。
 */
function fail(index, text) {
  return new Error(`[${index}] 失败：${text}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { base } = options;
  console.log(`SDK 冒烟开始：${base}`);

  let sessionId = '';
  let socket = null;
  let exitCode = 1;

  try {
    // 1. 健康检查：不可用时直接失败并打印服务端给出的原因
    const health = await request(base, '/api/sdk/health');
    if (health.status !== 200 || !health.body?.available) {
      const reason = health.body?.error || `HTTP ${health.status}`;
      throw fail(1, `SDK 不可用：${reason}`);
    }
    pass(1, '健康检查可用', `runtimeSource=${health.body.runtimeSource}，sdkVersion=${health.body.sdkVersion || '未知'}`);

    // 2. 仅健康检查模式到此结束
    if (options.healthOnly) {
      console.log('[2] 仅健康检查模式，跳过真实会话');
      exitCode = 0;
      return;
    }

    // 3. 必须有已登记项目，否则 SDK 会话无法通过服务端路径校验
    const projectPath = firstRegisteredProject();
    if (!projectPath) {
      console.log('[3] 跳过：~/.claude/workbench-workspace.json 中没有已登记项目（环境限制，无法创建会话）');
      exitCode = 0;
      return;
    }
    pass(3, '读取已登记项目', projectPath);

    // 4. 创建 SDK 会话
    const created = await request(base, '/api/sdk/sessions', { method: 'POST', body: { projectPath } });
    if (created.status !== 201 || !created.body?.id || !created.body?.eventUrl) {
      throw fail(4, `创建会话返回 HTTP ${created.status}：${created.body?.error || '响应缺少 id 或 eventUrl'}`);
    }
    sessionId = created.body.id;
    pass(4, '创建会话', `id=${sessionId}`);

    // 5. 连接事件流并等待 ready
    socket = new WebSocket(toWebSocketUrl(base, created.body.eventUrl));
    const stream = createEventStream(socket);
    await stream.waitFor((message) => message.type === 'ready', READY_TIMEOUT_MS, 'ready');
    pass(5, 'WebSocket 已就绪');

    // 6. 发送第一条提示词
    const sent = await request(base, '/api/sdk/sessions/message', {
      method: 'POST',
      body: { id: sessionId, prompt: '只回复两个字母 OK，不要调用任何工具。' },
    });
    if (sent.status !== 202) {
      throw fail(6, `发送提示词返回 HTTP ${sent.status}：${sent.body?.error || '未知错误'}`);
    }
    pass(6, '发送第一条提示词');

    // 7. 等待 result.success；遇到 error / exit 立即失败，不空等超时
    const isFinalEvent = (message) => (
      (message.type === 'event' && (String(message.eventType || '').startsWith('result.') || message.eventType === 'error'))
      || message.type === 'error'
      || message.type === 'exit'
    );
    const finalEvent = await stream.waitFor(isFinalEvent, RESULT_TIMEOUT_MS, 'result.success');
    if (finalEvent.eventType !== 'result.success') {
      const reason = finalEvent.message || finalEvent.event?.result || finalEvent.eventType || finalEvent.type;
      throw fail(7, `会话未返回 result.success：${JSON.stringify(reason)}`);
    }
    if (!finalEvent.sessionId || !finalEvent.event) {
      throw fail(7, 'result.success 事件缺少 sessionId 或 event 字段');
    }
    pass(7, '收到 result.success', `sessionId=${finalEvent.sessionId}`);

    // 8. 发送长任务提示词后中断；这里只断言接口返回 200
    const pending = await request(base, '/api/sdk/sessions/message', {
      method: 'POST',
      body: { id: sessionId, prompt: '请等待 30 秒后再回复。' },
    });
    if (pending.status !== 202) {
      throw fail(8, `发送第二条提示词返回 HTTP ${pending.status}：${pending.body?.error || '未知错误'}`);
    }
    await sleep(INTERRUPT_DELAY_MS);
    const interrupted = await request(base, '/api/sdk/sessions/interrupt', {
      method: 'POST',
      body: { id: sessionId },
    });
    if (interrupted.status !== 200) {
      throw fail(8, `中断返回 HTTP ${interrupted.status}：${interrupted.body?.error || '未知错误'}`);
    }
    pass(8, '中断请求成功', `interrupted=${Boolean(interrupted.body?.interrupted)}`);

    // 9. 关闭会话
    const closed = await request(base, '/api/sdk/sessions/close', {
      method: 'POST',
      body: { id: sessionId },
    });
    if (closed.status !== 200) {
      throw fail(9, `关闭会话返回 HTTP ${closed.status}：${closed.body?.error || '未知错误'}`);
    }
    pass(9, '关闭会话');

    exitCode = 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exitCode = 1;
  } finally {
    // 先断开事件流，再清理会话；两步都保持幂等，失败只记录不覆盖退出码
    if (socket) {
      try {
        socket.close();
      } catch {
        // 连接可能已由服务端关闭
      }
    }
    if (sessionId) {
      try {
        const closed = await request(base, '/api/sdk/sessions/close', {
          method: 'POST',
          body: { id: sessionId },
        });
        if (closed.status !== 200) console.error(`[清理] 关闭会话返回 HTTP ${closed.status}`);
      } catch (error) {
        console.error(`[清理] 关闭会话失败：${error.message}`);
      }
    }
  }

  console.log(exitCode === 0 ? 'SDK 冒烟通过' : 'SDK 冒烟失败');
  process.exit(exitCode);
}

await main();
