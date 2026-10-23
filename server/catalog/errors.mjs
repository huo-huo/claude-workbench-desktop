import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE, STATE_FILE } from '../core/paths.mjs';
import { atomicJson, hash } from '../core/storage.mjs';
import { tailLines } from '../core/logs.mjs';
import { state } from '../core/app-state.mjs';
import { redacted } from '../core/redact.mjs';
import { callChannelModel } from '../channels/benchmark.mjs';

export async function analyzeErrors() {
  const errors = errorRows();
  if (!errors.length) throw new Error('最近历史记录中没有识别到可分析的报错');
  const sample = errors.slice(0, 20).map((e, i) => `${i + 1}. 最近时间=${e.timestamp}，次数=${e.count}，分类=${e.category}，摘要=${redacted(e.message)}`).join('\n');
  const prompt = `你是 Claude Code 本地配置故障分析助手。请根据以下最近报错摘要，归并高频问题，按发生次数排序，说明每类问题的证据、最可能原因、置信度和可执行的解决步骤。若涉及协议/模型渠道，区分 Anthropic Messages 与 OpenAI Chat Completions。不要建议先删配置或输出任何密钥；如果需要实际网络请求或可能扣额度，标记“需要用户确认”，不要自行发起。用中文简洁输出。\n\n最近报错摘要：\n${sample}`;
  const result = { analysis: await callChannelModel(prompt, { maxTokens: 1800 }), analyzedAt: new Date().toISOString(), sampleCount: errors.length, errorSignature: hash(errors.map(e => [e.category, e.message, e.count])) };
  const s = state(); s.aiAnalysis = result; atomicJson(STATE_FILE, s);
  return result;
}


let errorRowsCache = { signature: '', rows: null };
export function errorRows() {
  const root = path.join(CLAUDE, 'projects');
  const files = [];
  try {
    for (const dir of fs.readdirSync(root, { withFileTypes: true }).filter(x => x.isDirectory())) {
      const folder = path.join(root, dir.name);
      for (const f of fs.readdirSync(folder).filter(x => x.endsWith('.jsonl'))) {
        const full = path.join(folder, f);
        const stat = fs.statSync(full);
        files.push({ full, mtime: stat.mtimeMs, size: stat.size });
      }
    }
  } catch {}
  files.sort((a, b) => b.mtime - a.mtime);
  const recentFiles = files.slice(0, 30);
  const signature = recentFiles.map(x => x.full + ':' + x.mtime + ':' + x.size).join('|');
  if (errorRowsCache.signature === signature && errorRowsCache.rows) return errorRowsCache.rows.map(x => ({ ...x }));
  const errors = [];
  const seen = new Set();
  for (const file of recentFiles) {
    let lines = [];
    try { lines = tailLines(file.full); } catch { continue; }
    for (const line of lines) {
      if (!/API Error|API returned|HTTP \d{3}|StreamNoEventsError|ECONN|ETIMEDOUT|timed out|Error:/i.test(line)) continue;
      try {
        const row = JSON.parse(line);
        const pieces = [];
        function walk(v, depth = 0) {
          if (depth > 5 || pieces.join('').length > 1000) return;
          if (typeof v === 'string') { if (/API Error|API returned|HTTP \d{3}|StreamNoEventsError|ECONN|ETIMEDOUT|timed out|Error:/i.test(v)) pieces.push(v); }
          else if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
          else if (v && typeof v === 'object') Object.values(v).forEach(x => walk(x, depth + 1));
        }
        walk(row);
        if (!pieces.length) continue;
        const combined = pieces.join(' ').replace(/\s+/g, ' ');
        const marker = combined.search(/API Error|API returned|HTTP \d{3}|StreamNoEventsError|ECONN|ETIMEDOUT|timed out|Error:/i);
        const raw = redacted(combined.slice(Math.max(0, marker - 24), Math.max(0, marker - 24) + 360)).slice(0, 320);
        const timestamp = row.timestamp || row.time || new Date(file.mtime).toISOString();
        const key = `${timestamp.slice(0, 16)}:${raw.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const code = raw.match(/HTTP\s+(\d{3})/i)?.[1] || raw.match(/API Error:\s*(\d{3})/i)?.[1] || '';
        errors.push({ id: hash({ timestamp, raw }), timestamp, code, category: code ? `HTTP ${code}` : /timeout|ETIMEDOUT|StreamNoEventsError/i.test(raw) ? '超时/流中断' : '请求错误', message: raw, file: path.basename(file.full) });
      } catch {}
    }
  }
  const grouped = new Map();
  for (const error of errors) {
    const normalized = error.message.replace(/request[- ]?id\s*[:=]?\s*[A-Za-z0-9_-]+/gi, 'request-id <id>').replace(/req[_ -]?\w{8,}/gi, 'req <id>');
    const key = `${error.category}:${normalized}`;
    const prior = grouped.get(key);
    if (prior) {
      prior.count += 1;
      if (error.timestamp > prior.timestamp) prior.timestamp = error.timestamp;
    } else grouped.set(key, { ...error, message: normalized, count: 1 });
  }
  const rows = [...grouped.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 250);
  errorRowsCache = { signature, rows };
  return rows.map(x => ({ ...x }));
}
