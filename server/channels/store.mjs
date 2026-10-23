import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { SECRETS_FILE, STATE_FILE, USER_SETTINGS } from '../core/paths.mjs';
import { atomicJson, safeReadJson } from '../core/storage.mjs';
import { normalizeFallbackChain, readSettings, writeSettings } from '../core/settings.mjs';
import { state } from '../core/app-state.mjs';

export function seedChannel() {
  const settings = readSettings(USER_SETTINGS);
  const env = settings.env || {};
  const models = [...new Set([settings.model, env.ANTHROPIC_MODEL, env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.CLAUDE_WORKBENCH_VISION_MODEL].filter(x => typeof x === 'string' && x.trim()))];
  const channel = {
    id: 'ctyun-codingplan', name: '天翼云 CodingPlan', protocol: 'anthropic-messages',
    baseUrl: env.ANTHROPIC_BASE_URL || '', messagesUrl: '', modelListUrl: '', models,
    modelSlots: {
      main: env.ANTHROPIC_MODEL || settings.model || '',
      opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
      sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
      haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
      vision: env.CLAUDE_WORKBENCH_VISION_MODEL || '',
      subagent: env.CLAUDE_CODE_SUBAGENT_MODEL || '',
      fallback: normalizeFallbackChain(settings.fallbackModel)[0] || '',
      fallbackChain: normalizeFallbackChain(settings.fallbackModel),
    },
    keySource: 'current-settings',
  };
  const s = state();
  s.channels = [channel];
  s.activeChannelId = channel.id;
  atomicJson(STATE_FILE, s);
  return s;
}

export function channelState() {
  const s = state();
  if (!Array.isArray(s.channels) || !s.channels.length) return seedChannel();
  return s;
}

export function channelSummary() {
  const s = channelState();
  const active = s.channels.find(c => c.id === s.activeChannelId) || s.channels[0];
  const settings = readSettings(USER_SETTINGS);
  const secrets = safeReadJson(SECRETS_FILE, {});
  const env = settings.env || {};
  return {
    activeId: active?.id || '',
    channels: s.channels.map(c => ({
      ...c,
      modelDetails: Object.fromEntries([...new Set([...(c.models || []), ...Object.values(c.modelSlots || {}).filter(Boolean)])].map(id => [id, c.modelDetails?.[id]]).filter(([, detail]) => detail)),
      ...(c.id === active?.id ? {
        baseUrl: env.ANTHROPIC_BASE_URL || c.baseUrl,
        modelSlots: { ...(c.modelSlots || {}), main: env.ANTHROPIC_MODEL || settings.model || '', opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '', sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '', haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '', vision: env.CLAUDE_WORKBENCH_VISION_MODEL || '', subagent: env.CLAUDE_CODE_SUBAGENT_MODEL || '', fallback: normalizeFallbackChain(settings.fallbackModel)[0] || '', fallbackChain: normalizeFallbackChain(settings.fallbackModel) },
      } : {}),
      active: c.id === active?.id,
      keyConfigured: Boolean(c.secretRef && secrets[c.secretRef]) || (c.id === active?.id && Boolean(env.ANTHROPIC_AUTH_TOKEN)),
    })),
  };
}

export function safeChannelUrl(value, label) {
  const urlValue = String(value || '').trim();
  if (!urlValue) return '';
  let parsed;
  try { parsed = new URL(urlValue); } catch { throw new Error(`${label} 地址格式不正确`); }
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password || [...parsed.searchParams.keys()].some(k => /key|token|secret|auth/i.test(k))) throw new Error(`${label} 请勿包含 Key 或认证参数`);
  return urlValue;
}

export function protectSecret(secret) {
  if (process.platform !== 'win32') throw new Error('当前系统不支持本机 DPAPI 密钥保护');
  const script = "$plain=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; $bytes=[Text.Encoding]::UTF8.GetBytes($plain); $protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($protected)";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: secret, encoding: 'utf8', windowsHide: true, timeout: 12000 });
  if (result.error || result.status !== 0 || !result.stdout.trim()) throw new Error('无法使用 Windows 用户凭据安全保存渠道 Key；请检查当前 Windows 用户的 DPAPI 服务。');
  return `dpapi:v1:${result.stdout.trim()}`;
}

export function unprotectSecret(ciphertext) {
  if (process.platform !== 'win32') throw new Error('当前系统不支持本机 DPAPI 密钥读取');
  const script = ciphertext.startsWith('dpapi:v1:')
    ? "$cipher=[Console]::In.ReadToEnd(); Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String($cipher); $plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Text.Encoding]::UTF8.GetString($plain)"
    : "$cipher=[Console]::In.ReadToEnd(); $secure=ConvertTo-SecureString -String $cipher; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }";
  const input = ciphertext.startsWith('dpapi:v1:') ? ciphertext.slice('dpapi:v1:'.length) : ciphertext;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input, encoding: 'utf8', windowsHide: true, timeout: 12000 });
  if (result.error || result.status !== 0) throw new Error('无法读取本机加密的渠道 Key');
  return result.stdout.trim();
}

export function saveChannel(body) {
  const s = channelState();
  const id = String(body.id || `channel-${crypto.randomBytes(5).toString('hex')}`).replace(/[^a-zA-Z0-9_-]/g, '-');
  const prior = s.channels.find(x => x.id === id) || {};
  let baseUrl = String(body.baseUrl || prior.baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('请填写完整的 HTTP/HTTPS Base URL');
  let parsedBase;
  try { parsedBase = new URL(baseUrl); } catch { throw new Error('Base URL 格式不正确'); }
  if (parsedBase.username || parsedBase.password || [...parsedBase.searchParams.keys()].some(k => /key|token|secret|auth/i.test(k))) throw new Error('请勿将 Key 写进 URL；请使用单独的 API Key 字段');
  const protocol = body.protocol === 'openai-completions' ? 'openai-completions' : 'anthropic-messages';
  const channel = {
    ...prior, id, name: String(body.name || prior.name || '新渠道').trim().slice(0, 80),
    protocol, baseUrl, messagesUrl: safeChannelUrl(body.messagesUrl || prior.messagesUrl || '', 'Messages URL'), modelListUrl: safeChannelUrl(body.modelListUrl || prior.modelListUrl || '', '模型列表 URL'),
    models: Array.isArray(body.models) ? body.models.filter(x => typeof x === 'string').slice(0, 500) : (prior.models || []),
    modelSlots: { ...(prior.modelSlots || {}), ...(body.modelSlots || {}) },
  };
  const wasActive = id === s.activeChannelId;
  if (wasActive && protocol !== 'anthropic-messages') throw new Error('当前 Claude Code 渠道必须使用 Anthropic Messages 兼容协议');
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    const secrets = safeReadJson(SECRETS_FILE, {});
    channel.secretRef = id;
    channel.keySource = 'dpapi';
    secrets[id] = protectSecret(body.apiKey.trim());
    atomicJson(SECRETS_FILE, secrets);
  }
  s.channels = s.channels.filter(x => x.id !== id).concat(channel);
  atomicJson(STATE_FILE, s);
  if (wasActive) activateChannel(id);
  return channelSummary();
}

export function channelApiKey(channel) {
  if (channel.secretRef) {
    const encrypted = safeReadJson(SECRETS_FILE, {})[channel.secretRef];
    if (encrypted) return unprotectSecret(encrypted);
  }
  const s = readSettings(USER_SETTINGS);
  if (channel.id === channelState().activeChannelId) return s.env?.ANTHROPIC_AUTH_TOKEN || '';
  return '';
}

export async function activateChannel(id) {
  const s = channelState();
  const target = s.channels.find(x => x.id === id);
  if (!target) throw new Error('找不到该渠道');
  if (target.protocol !== 'anthropic-messages') throw new Error('该渠道是 OpenAI 协议，Claude Code 不能直接使用；请配置它的 Anthropic 兼容入口。');
  const settings = readSettings(USER_SETTINGS);
  const previous = s.channels.find(x => x.id === s.activeChannelId);
  const secrets = safeReadJson(SECRETS_FILE, {});
  if (previous && !previous.secretRef && settings.env?.ANTHROPIC_AUTH_TOKEN) {
    secrets[previous.id] = protectSecret(settings.env.ANTHROPIC_AUTH_TOKEN);
    previous.secretRef = previous.id;
    previous.keySource = 'dpapi';
  }
  const key = channelApiKey(target) || (target.id === s.activeChannelId ? settings.env?.ANTHROPIC_AUTH_TOKEN : '');
  if (!key) throw new Error('先为该渠道保存专属 API Key；Key 会在本机加密保存，不会显示回页面。');
  settings.env ||= {};
  settings.env.ANTHROPIC_BASE_URL = target.baseUrl;
  settings.env.ANTHROPIC_AUTH_TOKEN = key;
  const slots = target.modelSlots || {};
  if (!slots.main) throw new Error('请先为该渠道设置主模型 ID，再切换为当前渠道。');
  settings.model = slots.main; settings.env.ANTHROPIC_MODEL = slots.main;
  for (const [slot, envName] of [['opus','ANTHROPIC_DEFAULT_OPUS_MODEL'],['sonnet','ANTHROPIC_DEFAULT_SONNET_MODEL'],['haiku','ANTHROPIC_DEFAULT_HAIKU_MODEL'],['vision','CLAUDE_WORKBENCH_VISION_MODEL'],['subagent','CLAUDE_CODE_SUBAGENT_MODEL']]) {
    if (slots[slot]) settings.env[envName] = slots[slot];
    else delete settings.env[envName];
  }
  if (target.messagesUrl) settings.env.CLAUDE_WORKBENCH_VISION_MESSAGES_URL = target.messagesUrl;
  else delete settings.env.CLAUDE_WORKBENCH_VISION_MESSAGES_URL;
  const fallbackChain = normalizeFallbackChain(slots.fallbackChain || slots.fallback);
  if (fallbackChain.length) {
    settings.fallbackModel = fallbackChain;
    settings.env.FALLBACK_FOR_ALL_PRIMARY_MODELS = '1';
  } else delete settings.fallbackModel;
  delete settings.env.ANTHROPIC_SMALL_FAST_MODEL;
  writeSettings(USER_SETTINGS, settings);
  if (Object.keys(secrets).length) atomicJson(SECRETS_FILE, secrets);
  s.activeChannelId = id;
  atomicJson(STATE_FILE, s);
  // 只返回激活结果；完整概览由路由层调用 overview 获取，避免渠道模块依赖 catalog
  return { activeChannelId: id };
}

export function currentChannel() {
  const channels = channelSummary();
  return channels.channels.find(c => c.id === channels.activeId) || channels.channels[0];
}
