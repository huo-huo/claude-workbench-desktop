import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 与 claude-hud config-reader 相同的配置口径：全局 ~/.claude + ~/.claude.json + 项目目录 */

/** 递归统计目录下的 .md 文件数；带回环与规模防护 */
function countMarkdownFiles(dir, state = { visited: new Set(), entries: 0 }, depth = 0) {
  if (depth > 8 || state.entries > 10000) return 0;
  let count = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    state.entries += 1;
    if (state.entries > 10000) break;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += countMarkdownFiles(full, state, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      count += 1;
    }
  }
  return count;
}

/** 读取 JSON 配置；缺失或损坏时返回空对象 */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/** 读取 JSON 文件中的 mcpServers 名称集合 */
function mcpNames(file, into) {
  const config = readJson(file);
  const servers = config.mcpServers;
  if (servers && typeof servers === 'object') {
    for (const name of Object.keys(servers)) into.add(name);
  }
}

/** 收集 settings 中 hooks 的详细结构：事件类型 → 匹配器 → 命令清单 */
function hookDetail(file, into) {
  const config = readJson(file);
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object') return;
  for (const [event, matchers] of Object.entries(hooks)) {
    const list = into.get(event) || [];
    if (Array.isArray(matchers)) {
      for (const matcher of matchers) {
        const commands = Array.isArray(matcher?.hooks)
          ? matcher.hooks.filter(item => typeof item?.command === 'string' && item.command).map(item => item.command)
          : [];
        list.push({ matcher: typeof matcher?.matcher === 'string' && matcher.matcher ? matcher.matcher : '*', commands });
      }
    }
    into.set(event, list);
  }
}

/**
 * 收集 Claude Code 配置统计（与 claude-hud 第二行同口径）。
 * @param {string} projectPath 当前项目目录；提供时同时统计项目级配置
 * @param {{ claudeDir?: string, claudeJson?: string }} [options] 注入配置目录，供测试使用
 */
export function collectConfigStats(projectPath, options = {}) {
  const claudeDir = options.claudeDir || path.join(os.homedir(), '.claude');
  const claudeJson = options.claudeJson || path.join(os.homedir(), '.claude.json');

  // CLAUDE.md：全局一份 + 项目各变体
  let claudeMd = fs.existsSync(path.join(claudeDir, 'CLAUDE.md')) ? 1 : 0;
  if (projectPath) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md', path.join('.claude', 'CLAUDE.md'), path.join('.claude', 'CLAUDE.local.md')]) {
      if (fs.existsSync(path.join(projectPath, name))) claudeMd += 1;
    }
  }

  // 规则：全局与项目的 rules 目录递归 .md
  let rules = countMarkdownFiles(path.join(claudeDir, 'rules'));
  if (projectPath) rules += countMarkdownFiles(path.join(projectPath, '.claude', 'rules'));

  // 钩子：settings 的事件类型与详细结构（全局 + 项目）
  const hookSet = new Map();
  hookDetail(path.join(claudeDir, 'settings.json'), hookSet);
  if (projectPath) hookDetail(path.join(projectPath, '.claude', 'settings.json'), hookSet);

  // MCP：全局 settings、~/.claude.json 与项目 .mcp.json 的服务器名并集（配置口径；
  // 会话口径的「✓ MCPs」由 enrich 从 transcript 收集）
  const mcpSet = new Set();
  mcpNames(path.join(claudeDir, 'settings.json'), mcpSet);
  mcpNames(claudeJson, mcpSet);
  if (projectPath) mcpNames(path.join(projectPath, '.mcp.json'), mcpSet);

  return {
    claudeMd: { count: claudeMd },
    rules: { count: rules },
    hooks: {
      count: hookSet.size,
      names: [...hookSet.keys()].sort(),
      // 每个事件类型下的匹配器与命令清单，供详情面板展示
      groups: [...hookSet.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([event, matchers]) => ({ event, matchers })),
    },
    mcp: { count: mcpSet.size, names: [...mcpSet].sort() },
  };
}
