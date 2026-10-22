/**
 * Claude Agent SDK 运行时。
 *
 * 本模块承担 SDK 会话生命周期与事件分发：健康检查、创建会话、发送提示词、
 * 事件订阅与回放、中断、关闭，以及独立的会话记录持久化。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** 会话允许自动放行的只读工具；其余工具一律拒绝 */
const ALLOWED_TOOLS = new Set(['Read', 'Glob', 'Grep']);
/** 允许透传给 SDK 的权限模式；其余模式（含 bypassPermissions）一律回退 default */
const ALLOWED_PERMISSION_MODES = new Set(['default', 'plan']);
/** 已结束的会话状态：不可再发送提示词 */
const FINISHED_STATUSES = new Set(['exited', 'failed', 'closed']);
/** 每个会话保留的最近事件条数 */
const MAX_EVENTS = 100;
/** 会话记录文件最多保留的条数 */
const MAX_RECORDS = 200;

/**
 * 构造带 HTTP 状态码的错误，供路由层直接透传。
 */
function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * 构造 SDK 流式输入模式下的用户消息。
 * session_id 留空，由 SDK 在初始化后回填。
 */
function userMessage(content) {
  return { type: 'user', session_id: '', message: { role: 'user', content }, parent_tool_use_id: null };
}

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
 * 创建 SDK 运行时。
 *
 * @param {object} [options] 依赖注入项
 * @param {(projectPath: string) => string} [options.resolveProject] 项目路径校验并返回规范路径
 * @param {() => { path: string, source: string }} [options.resolveExecutable] 运行时可执行文件解析
 * @param {() => object} [options.buildChannelEnv] 渠道环境构造
 * @param {string} [options.sessionFile] 会话记录文件路径
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
  /** SDK 模块加载 Promise 缓存，避免并发或重复加载 */
  let sdkPromise = null;
  /** 会话记录文件：默认位于 ~/.claude，测试通过注入临时路径隔离 */
  const recordsFile = sessionFile || path.join(os.homedir(), '.claude', 'workbench-sdk-sessions.json');

  /**
   * 读取会话记录；文件缺失或损坏时按空记录回退，不抛错。
   */
  function readSessionRecords() {
    try {
      const parsed = JSON.parse(fs.readFileSync(recordsFile, 'utf8'));
      return Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    } catch {
      return [];
    }
  }

  /**
   * 原子写入会话记录：先写临时文件再 rename，避免半截文件。
   */
  function writeSessionRecords(records) {
    try {
      fs.mkdirSync(path.dirname(recordsFile), { recursive: true });
      const temp = `${recordsFile}.${process.pid}.tmp`;
      fs.writeFileSync(temp, `${JSON.stringify({ sessions: records }, null, 2)}\n`, 'utf8');
      fs.renameSync(temp, recordsFile);
    } catch {
      // 记录写入失败不影响会话本身，仅丢失可恢复的元数据
    }
  }

  /**
   * 持久化单个会话记录：按 lastUsedAt 保留最新 MAX_RECORDS 条。
   */
  function persistSession(session) {
    const record = {
      id: session.id,
      sessionId: session.sessionId,
      projectPath: session.projectPath,
      status: session.status,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
    };
    const records = readSessionRecords().filter((item) => item?.id !== session.id);
    // 新记录置于最前，保证同一毫秒内创建的多条会话裁剪时优先保留最新
    records.unshift(record);
    records.sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')));
    writeSessionRecords(records.slice(0, MAX_RECORDS));
  }

  /**
   * 移除指定会话的记录；会话创建失败回滚时调用，避免残留无效记录。
   */
  function removeSessionRecord(id) {
    const records = readSessionRecords().filter((item) => item?.id !== id);
    writeSessionRecords(records);
  }

  /**
   * 读取已安装 SDK 包的版本号；读取失败时返回 null。
   */
  function readSdkVersion() {
    try {
      // SDK 的 exports 未暴露 ./package.json，先解析包入口再读取同目录的 package.json
      const entry = require.resolve('@anthropic-ai/claude-agent-sdk');
      const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8'));
      return manifest.version || null;
    } catch {
      return null;
    }
  }

  /**
   * 健康检查：返回 SDK 是否可用以及运行时信息。
   *
   * 运行时解析顺序与设计一致：env 显式覆盖 → installed 已安装 CLI → bundled 自带运行时。
   * SDK 动态加载可能失败，此方法不抛错，统一把原因写入 error 字段。
   */
  async function health() {
    const result = {
      available: false,
      sdkVersion: null,
      runtimePath: '',
      runtimeSource: 'bundled',
      nodeVersion: process.version,
      error: null,
    };

    // 解析运行时路径；解析异常时按 SDK 自带运行时兜底
    let resolved = { path: '', source: 'bundled' };
    try {
      if (typeof resolveExecutable === 'function') resolved = resolveExecutable() || resolved;
    } catch {
      resolved = { path: '', source: 'bundled' };
    }

    const runtimePath = String(resolved.path || '');
    result.runtimePath = runtimePath;
    result.runtimeSource = runtimePath ? (resolved.source || 'bundled') : 'bundled';

    // 显式指定的运行时不存在时直接判定不可用，避免带着坏路径继续加载
    if (result.runtimeSource === 'env' && !fs.existsSync(runtimePath)) {
      result.error = `指定的 SDK 运行时不存在：${runtimePath}`;
      return result;
    }

    // 已安装 CLI 在解析后消失时按 SDK 自带运行时兜底
    if (result.runtimeSource === 'installed' && !fs.existsSync(runtimePath)) {
      result.runtimePath = '';
      result.runtimeSource = 'bundled';
    }

    if (typeof loadSdk !== 'function') {
      result.error = '未注入 SDK 加载函数 loadSdk，Claude Agent SDK 不可用';
      return result;
    }

    try {
      // 缓存加载 Promise：loadSdk 可能同步抛错或返回 Promise，统一 await 处理
      sdkPromise = sdkPromise ?? Promise.resolve().then(() => loadSdk());
      const sdk = await sdkPromise;
      if (!sdk || typeof sdk.query !== 'function') {
        throw new Error('Claude Agent SDK 缺少 query 导出');
      }
      result.available = true;
      result.sdkVersion = readSdkVersion();
    } catch (error) {
      // 失败原因写入 error，由调用方决定降级行为
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  /**
   * 权限回调：仅放行只读工具，其余返回拒绝并说明原因。
   * 放行时必须原样回传 input，避免 SDK 侧丢失工具参数。
   */
  async function canUseTool(toolName, input) {
    if (ALLOWED_TOOLS.has(toolName)) {
      return { behavior: 'allow', updatedInput: input };
    }
    return {
      behavior: 'deny',
      message: `本次 SDK 会话仅允许 Read、Glob、Grep，已拒绝工具：${toolName}`,
    };
  }

  /**
   * 更新会话状态与最近使用时间，并同步写入会话记录。
   */
  function setStatus(session, status) {
    session.status = status;
    session.lastUsedAt = new Date().toISOString();
    persistSession(session);
  }

  /**
   * 按 id 查找会话，不存在时统一抛 404。
   */
  function requireSession(id) {
    const session = sessions.get(String(id || ''));
    if (!session) throw httpError(404, '会话不存在');
    return session;
  }

  /**
   * 向所有订阅者广播消息；单个订阅者回调异常不影响其他订阅者。
   */
  function broadcast(session, message) {
    for (const listener of [...session.subscribers]) {
      try {
        listener(message);
      } catch {
        // 订阅者自身异常只影响自己，继续保持会话运行
      }
    }
  }

  /**
   * 包装并记录一条 SDK 事件，同时实时广播；缓冲只保留最近 MAX_EVENTS 条。
   */
  function appendEvent(session, message) {
    const eventType = message?.subtype ? `${message.type}.${message.subtype}` : String(message?.type ?? '');
    const event = { type: 'event', sessionId: session.id, eventType, event: message };
    // 单独保留首条 system.init：前端重连时即使它已被挤出缓冲也能拿到初始化信息
    if (eventType === 'system.init' && !session.initEvent) session.initEvent = event;
    session.events.push(event);
    if (session.events.length > MAX_EVENTS) {
      session.events.splice(0, session.events.length - MAX_EVENTS);
    }
    broadcast(session, event);
  }

  /**
   * 后台消费 SDK 消息流：驱动状态机并分发事件。
   * 正常结束置 exited；异常置 failed；关闭会话后不再广播。
   */
  async function consume(session, queryResult) {
    try {
      for await (const message of queryResult) {
        if (session.status === 'closed') break;

        if (message?.type === 'system' && message.subtype === 'init') {
          // SDK 初始化完成后回填真实会话标识
          session.sessionId = message.session_id || session.sessionId;
          setStatus(session, 'running');
        } else if (message?.type === 'result') {
          setStatus(session, 'idle');
        }

        appendEvent(session, message);
      }

      if (session.status !== 'closed') {
        setStatus(session, 'exited');
        broadcast(session, { type: 'exit', sessionId: session.id });
      }
    } catch (error) {
      // abort 导致的退出由 close() 负责，不再重复广播
      if (session.status === 'closed') return;

      setStatus(session, 'failed');
      broadcast(session, {
        type: 'error',
        sessionId: session.id,
        message: error instanceof Error ? error.message : String(error),
      });
      broadcast(session, { type: 'exit', sessionId: session.id });
    }
  }

  /**
   * 关闭单个会话：关闭输入队列、终止运行时、置 closed 并通知订阅者。
   * 重复关闭保持幂等。
   */
  async function closeSession(id) {
    const session = requireSession(id);
    if (session.status === 'closed') return { closed: true };

    try {
      session.inputQueue.close();
    } catch {
      // 输入队列关闭失败不应阻断后续清理
    }
    try {
      session.abortController.abort();
    } catch {
      // 重复 abort 或运行时已结束都视为已清理
    }

    setStatus(session, 'closed');
    broadcast(session, { type: 'exit', sessionId: session.id, reason: 'closed' });
    session.subscribers.clear();
    return { closed: true };
  }

  return {
    health,

    async createSession(options = {}) {
      // 先确认 SDK 可用，不可用时统一返回 503
      const status = await health();
      if (!status.available) {
        throw httpError(503, status.error || 'Claude Agent SDK 不可用');
      }

      // 路径校验失败沿用其自带状态码，缺省按 400 处理
      let canonicalPath;
      try {
        if (typeof resolveProject !== 'function') {
          throw httpError(500, '未注入项目路径校验函数 resolveProject');
        }
        canonicalPath = resolveProject(options.projectPath);
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        failure.statusCode = Number(failure.statusCode) || 400;
        throw failure;
      }

      const now = new Date().toISOString();
      const session = {
        id: crypto.randomUUID(),
        sessionId: '',
        projectPath: canonicalPath,
        status: 'starting',
        createdAt: now,
        lastUsedAt: now,
        inputQueue: createInputQueue(),
        abortController: new AbortController(),
        query: null,
        events: [],
        /** 首条 system.init 事件；即使被缓冲挤出也保留用于回放 */
        initEvent: null,
        /** 是否正在中断；用于阻止并发的中断调用 */
        interrupting: false,
        subscribers: new Set(),
      };
      sessions.set(session.id, session);
      // 创建即写入独立会话记录，便于服务重启后追溯
      persistSession(session);

      try {
        // 健康检查已加载并缓存 SDK，此处直接复用
        const sdk = await sdkPromise;

        // 等待 SDK 加载期间会话可能已被 close()/shutdown() 关闭，此时不应再启动查询
        if (session.status === 'closed') throw httpError(409, '会话已结束，无法启动');

        const sdkOptions = {
          cwd: canonicalPath,
          abortController: session.abortController,
          env: { ...process.env, ...(typeof buildChannelEnv === 'function' ? buildChannelEnv() : {}) },
          // 仅透传白名单内的权限模式，避免接受可能绕过权限确认的取值
          permissionMode: ALLOWED_PERMISSION_MODES.has(options.permissionMode) ? options.permissionMode : 'default',
          canUseTool,
          includePartialMessages: false,
        };
        if (options.model) sdkOptions.model = options.model;

        // 仅在使用用户已安装 CLI 时显式指定可执行文件，bundled 交给 SDK 自行解析
        let executable = { path: '', source: 'bundled' };
        try {
          if (typeof resolveExecutable === 'function') executable = resolveExecutable() || executable;
        } catch {
          executable = { path: '', source: 'bundled' };
        }
        if (executable.path && executable.source !== 'bundled') {
          sdkOptions.pathToClaudeCodeExecutable = executable.path;
        }

        // query() 同步返回异步迭代器，不 await
        session.query = sdk.query({ prompt: session.inputQueue, options: sdkOptions });

        // 初始提示词直接进入输入队列，由 SDK 按流式输入消费
        if (typeof options.prompt === 'string' && options.prompt.trim()) {
          session.inputQueue.push(userMessage(options.prompt));
        }

        // 后台消费消息流，不阻塞创建接口
        void consume(session, session.query);

        return {
          id: session.id,
          sessionId: session.sessionId,
          projectPath: session.projectPath,
          status: session.status,
          eventUrl: `/api/sdk/events?session=${session.id}`,
        };
      } catch (error) {
        // 创建失败回滚：删除会话与记录，避免留下无法使用的僵死会话
        sessions.delete(session.id);
        removeSessionRecord(session.id);
        const failure = error instanceof Error ? error : new Error(String(error));
        // 业务错误保留原状态码，未知异常统一按 500 处理
        failure.statusCode = Number(failure.statusCode) || 500;
        throw failure;
      }
    },

    send(id, prompt) {
      const session = requireSession(id);
      // exited/failed/closed 均视为会话已结束，不再接受新消息
      if (FINISHED_STATUSES.has(session.status)) throw httpError(409, '会话已结束');
      if (typeof prompt !== 'string' || !prompt.trim()) throw httpError(400, '提示词必须是非空字符串');

      session.inputQueue.push(userMessage(prompt));
      setStatus(session, 'running');
      return { accepted: true, status: session.status };
    },

    async interrupt(id) {
      const session = requireSession(id);
      // 仅运行中的会话需要中断；其他状态直接返回无动作
      if (session.status !== 'running' || !session.query) return { interrupted: false };
      // 并发保护：同一会话已有中断在进行时直接返回，避免重复调用 SDK
      if (session.interrupting) return { interrupted: false };

      session.interrupting = true;
      try {
        await session.query.interrupt();
        setStatus(session, 'idle');
        // 记录并广播中断事件，便于前端同步展示中断结果
        appendEvent(session, { type: 'interrupt' });
        return { interrupted: true };
      } finally {
        session.interrupting = false;
      }
    },

    close: closeSession,

    /**
     * 查询会话对象；不存在时返回 null。
     */
    get(id) {
      return sessions.get(id) ?? null;
    },

    /**
     * 订阅会话事件：先发送 ready，再同步回放缓冲，最后加入实时订阅集合。
     * 返回取消订阅函数；取消只移除监听器，不影响会话本身。
     */
    subscribe(id, listener) {
      const session = sessions.get(String(id || ''));
      if (!session || session.status === 'closed') throw httpError(409, '会话不存在或已关闭');
      if (typeof listener !== 'function') throw httpError(400, '订阅回调必须是函数');

      // 回放 init 与当前缓冲；init 仍在缓冲中时不重复发送
      const replay = session.initEvent && !session.events.includes(session.initEvent)
        ? [session.initEvent, ...session.events]
        : session.events;

      listener({ type: 'ready', sessionId: session.id, status: session.status, replay: replay.length });
      for (const event of replay) listener(event);
      session.subscribers.add(listener);

      return () => {
        session.subscribers.delete(listener);
      };
    },

    /**
     * 关闭全部会话，供服务退出时调用；单个会话失败不影响其余会话。
     */
    async shutdown() {
      for (const session of [...sessions.values()]) {
        try {
          await closeSession(session.id);
        } catch {
          // shutdown 绝不抛错，保证进程退出流程可继续
        }
      }
    },
  };
}
