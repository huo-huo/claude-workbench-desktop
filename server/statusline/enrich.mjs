import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Claude Code todos 目录：文件名形如 <sessionId>-agent-<agentId>.json */
const TODOS_DIR = () => path.join(os.homedir(), '.claude', 'todos');

/**
 * 从 todos 条目数组统计完成进度。
 * 兼容两种存储格式：纯数组，或 { todos: [...] } 包裹对象。
 */
function countTodos(content) {
  const parsed = JSON.parse(content);
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.todos) ? parsed.todos : null;
  if (!items) return null;
  const total = items.length;
  if (!total) return null;
  const completed = items.filter(item => item && item.status === 'completed').length;
  return { completed, total };
}

/** transcript 解析结果缓存：文件未变化时避免每几秒重读大文件 */
const transcriptCache = new Map();

/**
 * 从 transcript 逐行解析：累计词元统计（输入/输出/缓存）、成本，
 * 取最后一条 assistant 的完整 usage 作为当前上下文快照，
 * 并收集会话中实际调用过的 Skill 与 MCP 服务器（与 claude-hud 的 ✓ 行同口径）。
 * 损坏行跳过；文件未变化时复用上次解析结果。
 * @param {string} transcriptPath 会话记录文件
 * @param {string} [expectedSessionId] 期望的会话 ID；提供时跳过行内 sessionId 不符的条目（resume 会话的文件可能混入其他会话段）
 */
function readTranscriptStats(transcriptPath, expectedSessionId) {
  let stat;
  try {
    stat = fs.statSync(transcriptPath);
  } catch {
    return {};
  }
  const cacheKey = `${transcriptPath}|${expectedSessionId || ''}`;
  const cached = transcriptCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.stats;

  const raw = fs.readFileSync(transcriptPath, 'utf8');
  let cost = 0;
  let hasCost = false;
  let snapshot;
  const totals = { input: 0, output: 0, cache: 0 };
  const skillSet = new Set();
  const mcpServerSet = new Set();
  // 与 claude-hud 相同的去重：Claude Code 会把同一 API 响应重复写入 transcript 2-3 次，
  // 有 message.id 时按 ID 累计增量（streaming 中 usage 逐步增长），无 ID 时按连续 usage 指纹去重
  const usageByMessageId = new Map();
  const USAGE_MAP_MAX = 500;
  let lastUsageKey;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    // 按 sessionId 过滤：行内带 sessionId 且与当前会话不符的条目不计入（resume 合并场景）
    if (expectedSessionId && typeof entry?.sessionId === 'string' && entry.sessionId && entry.sessionId !== expectedSessionId) continue;
    const content = entry?.message?.content;
    // 会话口径：tool_use 中实际调用过的 Skill 与 mcp__server__ 工具
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_use' || !block.name) continue;
        if (block.name === 'Skill') {
          const skill = String(block.input?.skill || '').trim();
          if (skill) skillSet.add(skill);
        } else if (block.name.startsWith('mcp__')) {
          const server = block.name.slice(5).split('__')[0];
          if (server) mcpServerSet.add(server);
        }
      }
    }
    const usage = entry?.message?.usage;
    if (entry?.type === 'assistant' && usage && typeof usage === 'object') {
      // 与 claude-hud 同口径：当前上下文 = 输入 + 输出 + 缓存写入 + 缓存读取
      const current = {
        input: Number(usage.input_tokens || 0),
        output: Number(usage.output_tokens || 0),
        cacheWrite: Number(usage.cache_creation_input_tokens || 0),
        cacheRead: Number(usage.cache_read_input_tokens || 0),
      };
      snapshot = current;
      const messageId = typeof entry.message.id === 'string' && entry.message.id ? entry.message.id : null;
      if (messageId) {
        lastUsageKey = undefined;
        if (!usageByMessageId.has(messageId) && usageByMessageId.size >= USAGE_MAP_MAX) {
          usageByMessageId.delete(usageByMessageId.keys().next().value);
        }
        const prior = usageByMessageId.get(messageId) || { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
        totals.input += Math.max(0, current.input - prior.input);
        totals.output += Math.max(0, current.output - prior.output);
        totals.cache += Math.max(0, current.cacheWrite - prior.cacheWrite) + Math.max(0, current.cacheRead - prior.cacheRead);
        usageByMessageId.set(messageId, {
          input: Math.max(prior.input, current.input),
          output: Math.max(prior.output, current.output),
          cacheWrite: Math.max(prior.cacheWrite, current.cacheWrite),
          cacheRead: Math.max(prior.cacheRead, current.cacheRead),
        });
      } else {
        const usageKey = `${current.input}|${current.output}|${current.cacheWrite}|${current.cacheRead}`;
        if (usageKey !== lastUsageKey) {
          lastUsageKey = usageKey;
          totals.input += current.input;
          totals.output += current.output;
          totals.cache += current.cacheWrite + current.cacheRead;
        }
      }
    } else {
      lastUsageKey = undefined;
    }
    if (typeof entry?.costUSD === 'number') {
      cost += entry.costUSD;
      hasCost = true;
    }
  }
  const stats = {};
  if (totals.input || totals.output || totals.cache) stats.totals = totals;
  if (snapshot) {
    stats.usedTokens = snapshot.input + snapshot.output + snapshot.cacheWrite + snapshot.cacheRead;
  }
  if (hasCost) stats.cost = Math.round(cost * 1e6) / 1e6;
  if (skillSet.size) stats.skills = [...skillSet].sort();
  if (mcpServerSet.size) stats.mcpServers = [...mcpServerSet].sort();

  // 缓存上限防护：只保留最近的 8 个 transcript
  if (transcriptCache.size > 8) {
    const oldest = transcriptCache.keys().next().value;
    transcriptCache.delete(oldest);
  }
  transcriptCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, stats });
  return stats;
}

/** 从转发 JSON 的 context_window.current_usage 计算当前上下文 token 数（与 claude-hud 同口径） */
function contextTokensFromWindow(window) {
  const usage = window?.current_usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const input = Number(usage.input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const cacheWrite = Number(usage.cache_creation_input_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const total = input + output + cacheWrite + cacheRead;
  return total > 0 ? total : undefined;
}

/**
 * 补齐 statusLine 转发数据中缺失的会话状态；只读解析，任何失败都省略对应字段。
 * @param {unknown} data 转发的原始 JSON（需含 session_id）
 * @param {{ todosDir?: string }} [options] 注入 todos 目录，供测试使用
 * @returns {object} 补充字段（如 { todo: { completed, total } }），无可用数据时为空对象
 */
export function enrichStatusline(data, options = {}) {
  const extra = {};
  const sessionId = data && typeof data === 'object' ? String(data.session_id || '') : '';
  if (!sessionId) return extra;

  // todo 进度：取该会话 agent todos 文件中修改时间最新的一份
  try {
    const dir = options.todosDir || TODOS_DIR();
    const prefix = `${sessionId}-agent-`;
    const candidates = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(name => name.startsWith(prefix) && name.endsWith('.json')).map(name => {
          const full = path.join(dir, name);
          return { full, mtime: fs.statSync(full).mtimeMs };
        })
      : [];
    candidates.sort((a, b) => b.mtime - a.mtime);
    if (candidates[0]) {
      const todo = countTodos(fs.readFileSync(candidates[0].full, 'utf8'));
      if (todo) extra.todo = todo;
    }
  } catch {
    // todos 解析失败省略对应项，不影响其他状态
  }

  // 上下文与成本：优先用转发 JSON 自带字段（与 claude-hud 同口径），缺失时回退解析 transcript
  const contextWindow = data?.context_window;
  const forwardedCost = data?.cost?.total_cost_usd;
  const currentTokens = contextTokensFromWindow(contextWindow);
  if (contextWindow && typeof contextWindow === 'object') {
    const context = {};
    if (typeof contextWindow.used_percentage === 'number') context.usedPercentage = contextWindow.used_percentage;
    if (currentTokens !== undefined) context.usedTokens = currentTokens;
    if (Object.keys(context).length) extra.context = context;
  }
  if (typeof forwardedCost === 'number') {
    extra.cost = forwardedCost;
  }

  // transcript 始终解析一次（带缓存）：词元累计与会话口径的 Skills/MCPs 只能从这里获得
  const transcriptPath = typeof data?.transcript_path === 'string' ? data.transcript_path : '';
  if (transcriptPath) {
    try {
      const stats = readTranscriptStats(transcriptPath, sessionId);
      if (extra.context === undefined && stats.usedTokens !== undefined) extra.context = { usedTokens: stats.usedTokens };
      if (extra.cost === undefined && stats.cost !== undefined) extra.cost = stats.cost;
      if (stats.totals) extra.tokens = stats.totals;
      // 会话口径：当前会话实际调用过的 Skill 与 MCP 服务器
      if (stats.skills) extra.sessionSkills = stats.skills;
      if (stats.mcpServers) extra.sessionMcpServers = stats.mcpServers;
    } catch {
      // transcript 缺失或损坏时省略，不影响其他状态
    }
  }

  return extra;
}
