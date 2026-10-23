import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../core/paths.mjs';
import { hash, safeReadJson } from '../core/storage.mjs';
import { state } from '../core/app-state.mjs';
import { redacted } from '../core/redact.mjs';
import { readCachedSkillTranslation } from '../prompts/cache.mjs';
import { hookRows } from './hooks.mjs';
import { skillRows } from './skills.mjs';
import { mcpRows } from './mcp.mjs';

export function fileDetail(id, project) {
  const rows = [...hookRows(project), ...skillRows(project), ...mcpRows(project)];
  const row = rows.find(x => x.id === id) || Object.values(state().disabledHooks).find(x => x.meta?.id === id)?.meta;
  if (!row) throw new Error('Item not found');
  const safeFile = row.file && fs.existsSync(row.file) ? row.file : null;
  let content = '';
  let originalContent = '';
  const translation = row.kind === 'skill' && safeFile ? readCachedSkillTranslation(id, safeFile) : null;
  if (row.kind === 'skill' && safeFile) {
    originalContent = redacted(fs.readFileSync(safeFile, 'utf8').slice(0, 60000));
    content = translation?.content || originalContent;
  }
  else if (row.kind === 'hook') {
    const saved = state().disabledHooks[id];
    let handler = saved?.handler || null;
    if (!handler && safeFile) {
      const config = safeReadJson(safeFile, {});
      const groups = config.hooks?.[row.event] || {};
      for (const group of Array.isArray(groups) ? groups : []) {
        if ((group.matcher || '*') !== row.matcher) continue;
        handler = (group.hooks || []).find(h => hash({ scope: row.scope, file: row.file, event: row.event, matcher: group.matcher || '', handler: h }) === id);
        if (handler) break;
      }
    }
    const command = handler?.command || handler?.url || handler?.prompt || '';
    const lines = [`event: ${row.event}`, `matcher: ${row.matcher}`, `type: ${row.type}`, `command: ${redacted(command)}`];
    const scriptMatch = command.match(/"([^"\r\n]+\.(?:m?js|cjs|py|ps1|sh|cmd|bat))"|([^\s"']+\.(?:m?js|cjs|py|ps1|sh|cmd|bat))/i);
    let script = scriptMatch?.[1] || scriptMatch?.[2] || '';
    if (script && command.includes('${CLAUDE_PLUGIN_ROOT}')) script = script.replaceAll('${CLAUDE_PLUGIN_ROOT}', path.dirname(path.dirname(row.file)));
    if (script && command.includes('${CLAUDE_PROJECT_DIR}') && project) script = script.replaceAll('${CLAUDE_PROJECT_DIR}', project);
    if (script && !path.isAbsolute(script)) script = path.resolve(project || HOME, script);
    if (script && fs.existsSync(script) && fs.statSync(script).isFile()) {
      try { lines.push('', `script file: ${script}`, '', redacted(fs.readFileSync(script, 'utf8').slice(0, 30000))); } catch {}
    }
    content = redacted(lines.join('\n'));
  }
  else if (row.kind === 'mcp' && safeFile) {
    const cfg = row.plugin ? safeReadJson(safeFile, {}).mcpServers?.[row.name] : row.scope === 'user' ? safeReadJson(safeFile, {}).mcpServers?.[row.name]
      : (safeReadJson(safeFile, {}).projects?.[project]?.mcpServers?.[row.name] || safeReadJson(safeFile, {}).mcpServers?.[row.name]);
    content = redacted(JSON.stringify(cfg || { name: row.name }, null, 2));
  }
  return { ...row, translation: translation ? { displayName: translation.displayName, description: translation.description, translatedAt: translation.translatedAt } : null, translationAvailable: Boolean(translation), originalContent: translation ? originalContent : '', content: content || '这个配置由插件或 Claude Code 内部提供，当前版本不展示源文件内容。' };
}
