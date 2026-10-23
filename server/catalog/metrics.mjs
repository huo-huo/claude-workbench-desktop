import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CLAUDE, USER_SETTINGS } from '../core/paths.mjs';
import { hash } from '../core/storage.mjs';
import { state } from '../core/app-state.mjs';
import { readSettings } from '../core/settings.mjs';
import { modelData } from '../channels/models.mjs';
import { claudeInstallInfo, updateCheckCache } from '../platform/claude.mjs';
import { hookRows } from './hooks.mjs';
import { skillRows } from './skills.mjs';
import { mcpRows } from './mcp.mjs';
import { pluginRows } from './plugins.mjs';
import { errorRows } from './errors.mjs';

const sessionMetricCache = new Map();
export function hookCommandBase(command) {
  const value = String(command || '');
  const quoted = value.match(/["']([^"']+)["']/)?.[1];
  const candidate = quoted || value.trim().split(/\s+/)[0];
  return path.basename(candidate || '').toLowerCase();
}
export function mcpToolId(toolName, rows) {
  const normalized = String(toolName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const matches = rows.filter(row => normalized.includes(String(row.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')));
  const enabled = matches.filter(row => row.enabled);
  const best = enabled.length ? enabled : matches;
  return best.length === 1 ? best[0].id : '';
}
export function toolSkillId(name, index) {
  const ids = index.get(String(name || '').trim().toLowerCase()) || [];
  return ids.length === 1 ? ids[0] : '';
}
export function slashSkillName(text) {
  const value = String(text || '');
  const tagged = value.match(/<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/i);
  if (tagged) return tagged[1].toLowerCase();
  return value.match(/^\s*\/([a-z0-9_:/-]+)(?:\s|$)/i)?.[1]?.toLowerCase() || '';
}
export async function sessionMetrics(hooks, skills, mcp) {
  const root = path.join(CLAUDE, 'projects');
  const files = [];
  try {
    for (const dir of fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory())) {
      const folder = path.join(root, dir.name);
      for (const name of fs.readdirSync(folder).filter(x => x.endsWith('.jsonl'))) {
        const full = path.join(folder, name), stat = fs.statSync(full);
        files.push({ full, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    }
  } catch {}
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const recent = files.slice(0, 30);
  const liveFiles = new Set(recent.map(f => f.full));
  for (const key of sessionMetricCache.keys()) if (!liveFiles.has(key)) sessionMetricCache.delete(key);

  const hookIndex = new Map(), skillIndex = new Map();
  for (const row of hooks) {
    if (!row.command) continue;
    const base = hookCommandBase(row.command);
    if (base) hookIndex.set(base, [...(hookIndex.get(base) || []), row.id]);
  }
  for (const row of skills) {
    const aliases = new Set([row.name, path.basename(path.dirname(row.file || ''))].filter(Boolean).map(x => String(x).toLowerCase()));
    for (const alias of aliases) skillIndex.set(alias, [...(skillIndex.get(alias) || []), row.id]);
  }

  const hookStats = new Map(), skillStats = new Map(), mcpStats = new Map();
  let parsedSessions = 0, stopHookSummaries = 0, matchedSkillTools = 0, matchedSlashSkills = 0, matchedMcpTools = 0, unmatchedMcpTools = 0;
  for (const file of recent) {
    const cached = sessionMetricCache.get(file.full);
    let summary = cached?.summary;
    let readStart = 0;
    if (cached && file.size >= cached.size && (file.size > cached.size || file.mtimeMs === cached.mtimeMs)) readStart = cached.size;
    else summary = null;
    if (!summary) summary = { hookRuns: [], hookFailures: [], toolEvents: [], slashSkills: [], stopHookSummaries: 0, pendingTools: new Map() };
    if (readStart < file.size) {
      try {
        const options = { end: file.size - 1 };
        if (readStart > 0) options.start = readStart;
        const reader = readline.createInterface({ input: fs.createReadStream(file.full, options), crlfDelay: Infinity });
        for await (const line of reader) {
          if (!line.includes('stop_hook_summary') && !line.includes('tool_use') && !line.includes('tool_result') && !line.includes('"type":"user"') && !line.includes('"type": "user"')) continue;
          try {
            const item = JSON.parse(line);
            if (item.subtype === 'stop_hook_summary') {
              summary.stopHookSummaries++;
              for (const info of item.hookInfos || []) if (info.command) summary.hookRuns.push({ command: String(info.command), durationMs: Number(info.durationMs) || 0 });
              for (const failure of item.hookErrors || []) summary.hookFailures.push({ command: String(failure.command || failure.hook || ''), detail: String(failure.error || failure.message || '') });
            }
            const blocks = Array.isArray(item.message?.content) ? item.message.content : [];
            if (item.type === 'assistant') for (const block of blocks) {
              if (block.type !== 'tool_use') continue;
              let kind = '', skillName = '', toolName = '';
              if (block.name === 'Skill' && block.input?.skill) {
                kind = 'skill'; skillName = String(block.input.skill).trim();
              } else if (String(block.name || '').startsWith('mcp__')) {
                kind = 'mcp'; toolName = String(block.name);
              }
              if (!kind) continue;
              const event = { kind, skillName, toolName, startedAt: item.timestamp || '', durationMs: null, failed: null };
              summary.toolEvents.push(event);
              if (block.id) summary.pendingTools.set(block.id, event);
            }
            if (item.type === 'user') for (const block of blocks) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const event = summary.pendingTools.get(block.tool_use_id);
                if (event) {
                  const startMs = Date.parse(event.startedAt || ''), endMs = Date.parse(item.timestamp || '');
                  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) event.durationMs = endMs - startMs;
                  event.failed = block.is_error === true;
                  summary.pendingTools.delete(block.tool_use_id);
                }
              }
              const text = typeof block === 'string' ? block : block.type === 'text' ? block.text : '';
              const command = slashSkillName(text);
              if (command) {
                summary.slashSkills.push(command);
              }
            }
          } catch {}
        }
      } catch {}
    }
    sessionMetricCache.set(file.full, { size: file.size, mtimeMs: file.mtimeMs, summary });
    parsedSessions++;
    stopHookSummaries += summary.stopHookSummaries || 0;
    for (const run of summary.hookRuns) {
      const ids = hookIndex.get(hookCommandBase(run.command)) || [];
      if (ids.length !== 1) continue;
      const stat = hookStats.get(ids[0]) || { calls: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0 };
      stat.calls++; stat.totalDurationMs += run.durationMs; stat.maxDurationMs = Math.max(stat.maxDurationMs, run.durationMs);
      hookStats.set(ids[0], stat);
    }
    for (const failure of summary.hookFailures) {
      const ids = hookIndex.get(hookCommandBase(failure.command)) || [];
      if (ids.length !== 1) continue;
      const stat = hookStats.get(ids[0]) || { calls: 0, failures: 0, totalDurationMs: 0, maxDurationMs: 0 };
      stat.failures++;
      hookStats.set(ids[0], stat);
    }
    for (const event of summary.toolEvents) {
      const targetId = event.kind === 'skill' ? toolSkillId(event.skillName, skillIndex) : mcpToolId(event.toolName, mcp);
      if (!targetId) { if (event.kind === 'mcp') unmatchedMcpTools++; continue; }
      const stats = event.kind === 'skill' ? skillStats : mcpStats;
      const stat = stats.get(targetId) || { calls: 0, toolCalls: 0, slashCommands: 0, failures: 0, totalDurationMs: 0, timedCalls: 0, maxDurationMs: 0, lastUsedAt: '' };
      stat.calls++; stat.toolCalls++;
      if (event.failed === true) stat.failures++;
      if (event.durationMs !== null) { stat.totalDurationMs += event.durationMs; stat.timedCalls++; stat.maxDurationMs = Math.max(stat.maxDurationMs, event.durationMs); }
      if (event.startedAt > stat.lastUsedAt) stat.lastUsedAt = event.startedAt;
      stats.set(targetId, stat);
      if (event.kind === 'skill') matchedSkillTools++; else matchedMcpTools++;
    }
    for (const name of summary.slashSkills) {
      const id = toolSkillId(name, skillIndex);
      if (!id) continue;
      const stat = skillStats.get(id) || { calls: 0, toolCalls: 0, slashCommands: 0, failures: 0, totalDurationMs: 0, timedCalls: 0, maxDurationMs: 0, lastUsedAt: '' };
      stat.calls++; stat.slashCommands++;
      skillStats.set(id, stat);
      matchedSlashSkills++;
    }
  }

  return {
    window: { sessions: parsedSessions, requestedSessions: recent.length, stopHookSummaries, label: '最近 ' + recent.length + ' 个完整会话日志', start: recent.length ? new Date(recent.at(-1).mtimeMs).toISOString() : '', end: recent.length ? new Date(recent[0].mtimeMs).toISOString() : '', skillToolCalls: matchedSkillTools, slashSkillCalls: matchedSlashSkills, mcpToolCalls: matchedMcpTools, unmatchedMcpTools },
    hooks: Object.fromEntries([...hookStats].map(([id, x]) => [id, { available: true, source: 'Claude stop_hook_summary', calls: x.calls, failures: x.failures, avgDurationMs: x.calls ? Math.round(x.totalDurationMs / x.calls) : 0, maxDurationMs: x.maxDurationMs }])),
    skills: Object.fromEntries([...skillStats].map(([id, x]) => [id, { calls: x.calls, toolCalls: x.toolCalls, slashCommands: x.slashCommands, failures: x.failures, avgDurationMs: x.timedCalls ? Math.round(x.totalDurationMs / x.timedCalls) : null, maxDurationMs: x.maxDurationMs, lastUsedAt: x.lastUsedAt }])),
    mcp: Object.fromEntries([...mcpStats].map(([id, x]) => [id, { calls: x.calls, failures: x.failures, avgDurationMs: x.timedCalls ? Math.round(x.totalDurationMs / x.timedCalls) : null, maxDurationMs: x.maxDurationMs, lastUsedAt: x.lastUsedAt }])),
  };
}
export async function overview(project = null) {
  const settings = readSettings(USER_SETTINGS);
  const errors = errorRows();
  const hooks = hookRows(project);
  const skills = skillRows(project);
  const mcp = mcpRows(project);
  const plugins = pluginRows(hooks, skills, mcp);
  const usage = await sessionMetrics(hooks, skills, mcp);
  const cli = claudeInstallInfo();
  return {
    scope: '全局',
    model: modelData(), claudeVersion: { ...cli, ...(updateCheckCache || {}) }, hooks: hooks.map(x => ({ ...x, usage: usage.hooks[x.id] || (x.event === 'Stop' && usage.window.stopHookSummaries > 0 ? { available: true, source: 'Claude stop_hook_summary', calls: 0, failures: 0, avgDurationMs: 0, maxDurationMs: 0 } : { available: false, source: '该 Hook 事件没有逐次运行日志', calls: null, failures: null, avgDurationMs: null, maxDurationMs: null }) })), skills: skills.map(x => ({ ...x, usage: usage.skills[x.id] || { calls: 0, toolCalls: 0, slashCommands: 0, failures: 0, avgDurationMs: null, maxDurationMs: 0, lastUsedAt: '' } })), mcp: mcp.map(x => ({ ...x, usage: usage.mcp[x.id] || { calls: 0, failures: 0, avgDurationMs: null, maxDurationMs: 0, lastUsedAt: '' } })), plugins, errors, usageWindow: usage.window,
    errorSignature: hash(errors.map(e => [e.category, e.message, e.count])),
    aiAnalysis: state().aiAnalysis || null,
    modelBenchmarks: state().modelBenchmarks || [],
    modelBenchmarkRun: state().modelBenchmarkRun || null,
    counts: {
      hooks: hooks.length, enabledHooks: hooks.filter(x => x.enabled).length,
      skills: skills.length, enabledSkills: skills.filter(x => x.enabled).length,
      personalSkills: skills.filter(x => x.sourceType === 'personal').length,
      pluginSkills: skills.filter(x => x.sourceType === 'plugin').length,
      legacyCommands: skills.filter(x => x.sourceType === 'legacy-command').length,
      personalSkills: skills.filter(x => x.sourceType === 'personal').length,
      pluginSkills: skills.filter(x => x.sourceType === 'plugin').length,
      legacyCommands: skills.filter(x => x.sourceType === 'legacy-command').length,
      mcp: mcp.length, enabledMcp: mcp.filter(x => x.enabled).length,
      errors: errors.reduce((sum, error) => sum + (error.count || 1), 0),
    },
    scanAt: new Date().toISOString(),
    version: '2.1.292',
    hooksDisabledGlobally: settings.disableAllHooks === true,
  };
}

