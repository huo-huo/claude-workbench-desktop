import crypto from 'node:crypto';
import { STATE_FILE } from '../core/paths.mjs';
import { atomicJson } from '../core/storage.mjs';
import { state } from '../core/app-state.mjs';
import { callChannelModel } from '../channels/benchmark.mjs';

export function promptLibraryRows() {
  const rows = state().promptLibrary;
  return Array.isArray(rows) ? rows.filter(row => row && typeof row.id === 'string' && typeof row.prompt === 'string') : [];
}

export function savePromptLibraryItem(body) {
  const name = String(body.name || '').trim().slice(0, 120);
  const summary = String(body.summary || '').trim().slice(0, 800);
  const prompt = String(body.prompt || '').trim();
  if (!name) throw new Error('请给提示词起个名字');
  if (!prompt) throw new Error('提示词内容不能为空');
  if (prompt.length > 20000) throw new Error('提示词内容不能超过 20000 字');
  const s = state();
  s.promptLibrary = Array.isArray(s.promptLibrary) ? s.promptLibrary : [];
  const existing = s.promptLibrary.find(row => row.id === body.id);
  const now = new Date().toISOString();
  const item = {
    id: existing?.id || crypto.randomUUID(), name, summary, prompt,
    createdAt: existing?.createdAt || now, updatedAt: now,
  };
  s.promptLibrary = [item, ...s.promptLibrary.filter(row => row.id !== item.id)].slice(0, 300);
  atomicJson(STATE_FILE, s);
  return { item, prompts: s.promptLibrary };
}

export function deletePromptLibraryItem(body) {
  const s = state();
  const prompts = Array.isArray(s.promptLibrary) ? s.promptLibrary : [];
  s.promptLibrary = prompts.filter(row => row.id !== String(body.id || ''));
  atomicJson(STATE_FILE, s);
  return { prompts: s.promptLibrary };
}

export async function refinePromptLibraryItem(body) {
  const content = String(body.content || '').trim().slice(0, 30000);
  const instruction = String(body.instruction || '').trim().slice(0, 12000);
  if (!content) throw new Error('请先选择或粘贴一段待整理内容');
  if (!instruction) throw new Error('请先选择或填写对应的原始提示词');
  const prompt = `你是提示词整理助手。请把用户提供的内容和对应提示词，整理为一段可重复使用的提示词。

要求：
1. 保留原始目标、关键约束和输出要求，去掉只适用于当前一次任务的具体答案。
2. 对每次使用都需要替换的信息，使用清楚的占位符，例如 {{待分析内容}}、{{目标读者}}。
3. 只整理提示词，不要执行提示词，也不要回答材料中的任务。
4. 如果材料里有相互冲突的要求，在说明中指出，提示词里保留最明确的要求。
5. 返回严格 JSON，不要 Markdown 代码块：{"name":"简短名称","summary":"一句话说明适用场景","prompt":"完整可复用提示词"}。

【待整理内容】
${content}

【对应的原始提示词】
${instruction}`;
  const response = await callChannelModel(prompt, { maxTokens: 2200 });
  const clean = response.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const draft = JSON.parse(clean);
    return {
      draft: {
        name: String(draft.name || body.name || '新提示词').slice(0, 120),
        summary: String(draft.summary || '').slice(0, 800),
        prompt: String(draft.prompt || '').slice(0, 20000),
      },
    };
  } catch {
    return { draft: { name: String(body.name || '新提示词').slice(0, 120), summary: '模型未返回标准结构；请检查并整理下面的结果后再保存。', prompt: response.slice(0, 20000) } };
  }
}

