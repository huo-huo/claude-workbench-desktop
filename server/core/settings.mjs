import path from 'node:path';
import { atomicJson, safeReadJson } from './storage.mjs';

/** 读取全局 settings.json；文件缺失时返回空对象 */
export function readSettings(file) { return safeReadJson(file, {}); }

/** 原子写入 settings.json */
export function writeSettings(file, settings) { atomicJson(file, settings); }

/** 规范化备用模型链：数组或分隔字符串转为去重后的最多 3 项 */
export function normalizeFallbackChain(value) {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\r\n,;]+/) : [];
  return [...new Set(values.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 3);
}

/** 项目级 settings 文件来源（与用户级 settings.json 并列） */
export function projectSettings(project) {
  return [
    { scope: 'project', file: path.join(project, '.claude', 'settings.json') },
    { scope: 'project-local', file: path.join(project, '.claude', 'settings.local.json') },
  ];
}
