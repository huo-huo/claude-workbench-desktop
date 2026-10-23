import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE, STATE_FILE, USER_SETTINGS } from '../core/paths.mjs';
import { atomicJson } from '../core/storage.mjs';
import { normalizeFallbackChain, readSettings, writeSettings } from '../core/settings.mjs';
import { tailLines } from '../core/logs.mjs';
import { redacted } from '../core/redact.mjs';
import { channelApiKey, channelState, channelSummary, safeChannelUrl } from './store.mjs';

export function projectChoices() {
  const found = new Map();
  const cwd = process.cwd();
  found.set(path.resolve(cwd).toLowerCase(), { id: path.resolve(cwd), name: path.basename(cwd), current: true });
  const roots = path.join(CLAUDE, 'projects');
  try {
    for (const dir of fs.readdirSync(roots, { withFileTypes: true }).filter(x => x.isDirectory())) {
      const full = path.join(roots, dir.name);
      for (const file of fs.readdirSync(full).filter(x => x.endsWith('.jsonl')).slice(-5)) {
        try {
          for (const line of tailLines(path.join(full, file), 96 * 1024, 60)) {
            const record = JSON.parse(line);
            const project = record.cwd || record.projectPath;
            if (!project || !path.isAbsolute(project) || !fs.existsSync(project)) continue;
            const key = path.resolve(project).toLowerCase();
            if (!found.has(key)) found.set(key, { id: path.resolve(project), name: path.basename(project), current: false });
            break;
          }
        } catch {}
      }
    }
  } catch {}
  return [...found.values()].sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
}

export function selectedProject(id) {
  const projects = projectChoices();
  const resolved = id ? path.resolve(id) : projects[0]?.id;
  const match = projects.find(p => p.id.toLowerCase() === resolved?.toLowerCase());
  if (!match) throw new Error('Unknown project');
  return match.id;
}

export function modelData() {
  const settings = readSettings(USER_SETTINGS);
  const env = settings.env || {};
  const channels = channelSummary();
  const active = channels.channels.find(c => c.id === channels.activeId) || channels.channels[0];
  const slots = active?.modelSlots || {};
  const configured = new Set([
    settings.model, env.ANTHROPIC_MODEL, settings.fallbackModel, ...(active?.models || []),
    env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.CLAUDE_WORKBENCH_VISION_MODEL, env.ANTHROPIC_SMALL_FAST_MODEL,
    env.CLAUDE_CODE_SUBAGENT_MODEL,
  ].flat().filter(x => typeof x === 'string' && x.trim()));
  return {
    roles: {
      main: env.ANTHROPIC_MODEL || settings.model || slots.main || '',
      opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || slots.opus || '',
      sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || slots.sonnet || '',
      haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || slots.haiku || '',
      vision: env.CLAUDE_WORKBENCH_VISION_MODEL || slots.vision || '',
      subagent: env.CLAUDE_CODE_SUBAGENT_MODEL || slots.subagent || '',
      fallback: normalizeFallbackChain(settings.fallbackModel).join(', ') || normalizeFallbackChain(slots.fallbackChain || slots.fallback).join(', '),
    },
    defaults: {
      saved: settings.model || '',
      environment: env.ANTHROPIC_MODEL || '',
      fallback: normalizeFallbackChain(settings.fallbackModel).join(', '),
      opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
      sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
      haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
      vision: env.CLAUDE_WORKBENCH_VISION_MODEL || '',
      smallFast: env.ANTHROPIC_SMALL_FAST_MODEL || '',
      baseUrl: redacted(env.ANTHROPIC_BASE_URL || ''),
    },
    choices: [...configured].sort(),
    channels,
    nativeRouting: { main: true, opus: true, sonnet: true, haiku: true, subagent: true },
  };
}

export function modelListUrl(channel) {
  if (channel.modelListUrl) return channel.modelListUrl;
  let base = channel.baseUrl.replace(/\/+$/, '');
  if (/\/models$/i.test(base)) return base;
  if (/\/chat\/completions$/i.test(base)) return base.replace(/\/chat\/completions$/i, '/models');
  if (/\/v1$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

export async function fetchChannelModels(channel, key) {
  if (!key) throw new Error('请先填写此渠道的 API Key。');
  const headers = channel.protocol === 'anthropic-messages'
    ? { 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' }
    : { Authorization: `Bearer ${key}` };
  const response = await fetch(modelListUrl(channel), { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`模型列表读取失败（HTTP ${response.status}）：${redacted(body?.error?.message || body?.message || '该渠道可能不开放模型列表接口，可手动填写模型 ID。')}`);
  const list = body.data || body.models || body.model_list || [];
  const models = list.map(x => typeof x === 'string' ? x : x?.id || x?.name).filter(x => typeof x === 'string' && x.trim());
  if (!models.length) throw new Error('渠道返回成功，但没有可识别的模型列表；可以手动填写模型 ID。');
  const fields = [...new Set(list.filter(x => x && typeof x === 'object').flatMap(x => Object.keys(x)).filter(k => !/key|token|secret|auth/i.test(k)))].sort();
  const modelListSchema = { itemTypes: [...new Set(list.map(x => Array.isArray(x) ? 'array' : typeof x))], fields, hasContextField: fields.some(k => /context|position/i.test(k)) };
  const modelDetails = {};
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const modelId = item.id || item.name;
    const contextWindow = findChannelContextWindow(item);
    if (modelId && contextWindow) modelDetails[modelId] = { contextWindow: Number(contextWindow), contextSource: '渠道模型列表' };
  }
  return { models: [...new Set(models)], modelDetails, modelListSchema };
}

export function findChannelContextWindow(model) {
  const seen = new Set();
  const queue = [{ value: model, depth: 0 }];
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 4) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'number' && Number.isFinite(child) && child > 0 && /context|position/i.test(key) && !/output|response/i.test(key)) return child;
      if (child && typeof child === 'object' && /meta|limit|architecture|capabilit|context/i.test(key)) queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

export async function pullChannelModels(id) {
  const s = channelState();
  const channel = s.channels.find(x => x.id === id);
  if (!channel) throw new Error('找不到该渠道');
  const fetched = await fetchChannelModels(channel, channelApiKey(channel));
  channel.models = fetched.models;
  channel.modelDetails = fetched.modelDetails;
  channel.modelListSchema = fetched.modelListSchema;
  channel.modelsFetchedAt = new Date().toISOString();
  atomicJson(STATE_FILE, s);
  return channelSummary();
}

export async function pullDraftChannelModels(body) {
  const existing = body.id ? channelState().channels.find(x => x.id === body.id) : null;
  const channel = {
    ...(existing || {}),
    protocol: body.protocol === 'openai-completions' ? 'openai-completions' : 'anthropic-messages',
    baseUrl: safeChannelUrl(body.baseUrl, 'Base URL').replace(/\/+$/, ''),
    modelListUrl: safeChannelUrl(body.modelListUrl || '', '模型列表 URL'),
  };
  if (!channel.baseUrl) throw new Error('请先填写渠道 Base URL');
  const key = String(body.apiKey || '').trim() || (existing ? channelApiKey(existing) : '');
  return { ...await fetchChannelModels(channel, key), fetchedAt: new Date().toISOString() };
}

export function setChannelFallbacks(body) {
  const s = channelState();
  const channel = s.channels.find(x => x.id === body.channelId);
  if (!channel) throw new Error('找不到模型渠道');
  const requested = Array.isArray(body.models) ? body.models : [];
  if (requested.length > 3) throw new Error('Claude Code 最多支持 3 个备用模型');
  const chain = normalizeFallbackChain(requested);
  const known = new Set([...(channel.models || []), ...Object.values(channel.modelSlots || {}).filter(Boolean)]);
  const testedAvailable = new Set((s.modelBenchmarks || []).filter(x => x.channelId === channel.id && x.status === 'available' && x.benchmarkVersion === 2).map(x => x.model));
  for (const model of chain) {
    if (!known.has(model)) throw new Error(`模型 ${model} 不在此渠道模型列表中`);
    if (!testedAvailable.has(model)) throw new Error(`模型 ${model} 尚未通过最近的测速，不能加入自动备用链`);
  }
  channel.modelSlots ||= {};
  channel.modelSlots.fallbackChain = chain;
  channel.modelSlots.fallback = chain[0] || '';
  if (s.activeChannelId === channel.id) {
    const settings = readSettings(USER_SETTINGS);
    settings.env ||= {};
    if (chain.length) {
      settings.fallbackModel = chain;
      settings.env.FALLBACK_FOR_ALL_PRIMARY_MODELS = '1';
    } else delete settings.fallbackModel;
    writeSettings(USER_SETTINGS, settings);
  }
  atomicJson(STATE_FILE, s);
}

export function saveModels(body) {
  const settings = readSettings(USER_SETTINGS);
  settings.env ||= {};
  const roles = body.roles || {};
  const mappings = [
    ['main', 'ANTHROPIC_MODEL', true], ['opus', 'ANTHROPIC_DEFAULT_OPUS_MODEL'],
    ['sonnet', 'ANTHROPIC_DEFAULT_SONNET_MODEL'], ['haiku', 'ANTHROPIC_DEFAULT_HAIKU_MODEL'],
    ['subagent', 'CLAUDE_CODE_SUBAGENT_MODEL'], ['vision', 'CLAUDE_WORKBENCH_VISION_MODEL'],
  ];
  for (const [slot, envName, isMain] of mappings) {
    if (typeof roles[slot] !== 'string') continue;
    const value = roles[slot].trim();
    if (value) settings.env[envName] = value; else delete settings.env[envName];
    if (isMain && value) settings.model = value;
  }
  const fallbackChain = typeof roles.fallback === 'string' ? normalizeFallbackChain(roles.fallback) : null;
  if (fallbackChain) {
    if (fallbackChain.length) {
      settings.fallbackModel = fallbackChain;
      settings.env.FALLBACK_FOR_ALL_PRIMARY_MODELS = '1';
    } else delete settings.fallbackModel;
  }
  delete settings.env.ANTHROPIC_SMALL_FAST_MODEL;
  const s = channelState();
  const active = s.channels.find(c => c.id === s.activeChannelId) || s.channels[0];
  if (active) {
    active.modelSlots ||= {};
    for (const [slot] of mappings) if (typeof roles[slot] === 'string') active.modelSlots[slot] = roles[slot].trim();
    if (fallbackChain) {
      active.modelSlots.fallbackChain = fallbackChain;
      active.modelSlots.fallback = fallbackChain[0] || '';
    }
    active.models = [...new Set([...(active.models || []), ...Object.values(active.modelSlots).filter(Boolean)])];
  }
  writeSettings(USER_SETTINGS, settings);
  atomicJson(STATE_FILE, s);
}
