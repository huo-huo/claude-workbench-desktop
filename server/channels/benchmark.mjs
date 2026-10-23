import crypto from 'node:crypto';
import { STATE_FILE, USER_SETTINGS } from '../core/paths.mjs';
import { atomicJson } from '../core/storage.mjs';
import { readSettings } from '../core/settings.mjs';
import { redacted } from '../core/redact.mjs';
import { state } from '../core/app-state.mjs';
import { channelApiKey, channelState, currentChannel } from './store.mjs';

export async function benchmarkModelRequest(body) {
  const channel = channelState().channels.find(x => x.id === body.channelId);
  const model = String(body.model || '').trim();
  if (!channel) throw new Error('找不到该模型渠道');
  if (!model || model.length > 200 || /[\r\n]/.test(model)) throw new Error('请选择有效的模型 ID');
  if (channel.protocol !== 'anthropic-messages') throw new Error('此渠道使用 OpenAI 协议，不能验证 Claude Code 的 Anthropic Messages 适配情况。');
  const key = channelApiKey(channel);
  if (!key) throw new Error('先为此渠道保存 API Key，或将它设为当前渠道。');
  const base = channel.baseUrl.replace(/\/+$/, '');
  const url = channel.messagesUrl || (/\/v1\/messages$/i.test(base) ? base : `${base}/v1/messages`);
  const started = performance.now();
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 96, stream: true, messages: [{ role: 'user', content: 'Write a concise paragraph of about 40 words explaining how to organize a small software project. Do not use a list.' }] }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`模型请求失败（HTTP ${response.status}）：${redacted(bodyText.slice(0, 500) || '渠道未返回可读错误')}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) throw new Error(`渠道返回 ${contentType || '未知响应格式'}，没有提供流式响应；Claude Code 的流式适配无法确认。`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', firstTextAt = null, textChars = 0, outputTokens = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split(/\r?\n\r?\n/);
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const dataLine = chunk.split(/\r?\n/).find(line => line.startsWith('data:'));
        if (!dataLine) continue;
        const raw = dataLine.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let event; try { event = JSON.parse(raw); } catch { continue; }
        const deltaText = event.type === 'content_block_delta' ? event.delta?.text : event.choices?.[0]?.delta?.content;
        if (typeof deltaText === 'string' && deltaText) { firstTextAt ??= performance.now(); textChars += deltaText.length; }
        const usage = event.usage || event.message_delta?.usage;
        const tokens = usage?.output_tokens ?? usage?.completion_tokens;
        if (Number.isFinite(tokens)) outputTokens = tokens;
      }
    }
  } finally { reader.releaseLock(); }
  const totalMs = Math.round(performance.now() - started);
  if (firstTextAt === null) throw new Error('请求成功但没有收到任何文本流事件；这与 Claude Code 的流式请求失败现象相似。');
  const estimatedTokens = outputTokens ?? Math.max(1, Math.ceil(textChars / 3));
  const result = {
    id: crypto.randomBytes(8).toString('hex'), channelId: channel.id, channelName: channel.name, model,
    testedAt: new Date().toISOString(), firstTokenMs: Math.round(firstTextAt - started), totalMs,
    outputTokens: outputTokens ?? estimatedTokens, tokenCountEstimated: outputTokens == null,
    tokensPerSecond: Number((estimatedTokens / Math.max((totalMs - (firstTextAt - started)) / 1000, 0.1)).toFixed(2)),
    adapter: 'Anthropic Messages SSE', compatible: true, status: 'available', benchmarkVersion: 2,
  };
  saveBenchmarkResult(result);
  return result;
}

export function saveBenchmarkResult(result) {
  const s = state();
  s.modelBenchmarks = [result, ...(s.modelBenchmarks || []).filter(x => !(x.channelId === result.channelId && x.model === result.model))].slice(0, 300);
  atomicJson(STATE_FILE, s);
}

export async function benchmarkModel(body) {
  try { return await benchmarkModelRequest(body); }
  catch (error) {
    const channel = channelState().channels.find(x => x.id === body.channelId);
    const result = {
      id: crypto.randomBytes(8).toString('hex'), channelId: String(body.channelId || ''), channelName: channel?.name || '',
      model: String(body.model || '').slice(0, 200), testedAt: new Date().toISOString(), compatible: false, benchmarkVersion: 2,
      status: 'unavailable', error: redacted(error.message || '模型请求失败').slice(0, 500),
    };
    saveBenchmarkResult(result);
    return result;
  }
}

export function updateModelBenchmarkRun(body) {
  const s = state();
  const now = new Date().toISOString();
  if (body.action === 'start') {
    const models = Array.isArray(body.models) ? [...new Set(body.models.map(x => String(x).slice(0, 200)))].slice(0, 100) : [];
    s.modelBenchmarkRun = { id: crypto.randomBytes(8).toString('hex'), channelId: String(body.channelId || ''), channelName: channelState().channels.find(c => c.id === body.channelId)?.name || '', status: 'running', models, total: models.length, completed: 0, available: 0, unavailable: 0, currentModel: models[0] || '', startedAt: now, finishedAt: '' };
  } else {
    const run = s.modelBenchmarkRun;
    if (!run || run.id !== body.runId) throw new Error('测速任务已过期；请重新开始。');
    if (body.action === 'progress') {
      run.completed = Math.min(run.total, Number(body.completed) || 0);
      run.available = Math.min(run.completed, Number(body.available) || 0);
      run.unavailable = Math.max(0, run.completed - run.available);
      run.currentModel = String(body.currentModel || '').slice(0, 200);
    } else if (body.action === 'finish') {
      run.completed = run.total; run.available = Math.min(run.total, Number(body.available) || 0);
      run.unavailable = Math.max(0, run.total - run.available); run.currentModel = '';
      run.status = 'complete'; run.finishedAt = now;
    } else throw new Error('未知测速状态');
  }
  atomicJson(STATE_FILE, s);
  return s.modelBenchmarkRun;
}

export async function callChannelModel(prompt, { maxTokens = 1400, model = '' } = {}) {
  const channel = currentChannel();
  if (!channel) throw new Error('还没有配置模型渠道');
  const activeModel = model || channel.modelSlots?.main || readSettings(USER_SETTINGS).env?.ANTHROPIC_MODEL;
  if (!activeModel) throw new Error('当前渠道没有主模型 ID');
  const key = channelApiKey(channel);
  if (!key) throw new Error('当前渠道没有可用的 Key；请先在渠道设置页保存。');
  const base = channel.baseUrl.replace(/\/+$/, '');
  let url, headers, payload;
  if (channel.protocol === 'anthropic-messages') {
    url = channel.messagesUrl || (/\/v1\/messages$/i.test(base) ? base : `${base}/v1/messages`);
    headers = { 'content-type': 'application/json', 'x-api-key': key, authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01' };
    payload = { model: activeModel, max_tokens: maxTokens, stream: false, messages: [{ role: 'user', content: prompt }] };
  } else {
    url = /\/chat\/completions$/i.test(base) ? base : /\/v1$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
    headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
    payload = { model: activeModel, max_tokens: maxTokens, stream: false, messages: [{ role: 'user', content: prompt }] };
  }
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(45000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI 请求失败（HTTP ${response.status}）：${redacted(body?.error?.message || body?.message || '渠道未返回可读错误。')}`);
  if (channel.protocol === 'anthropic-messages') {
    const text = (body.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
    if (!text) throw new Error('渠道返回了 HTTP 成功，但没有 Anthropic 文本内容；请检查该渠道的协议分支。');
    return text;
  }
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new Error('渠道返回了 HTTP 成功，但没有 OpenAI Chat Completions 内容。');
  return String(text);
}
