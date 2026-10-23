import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE, USER_SETTINGS } from '../core/paths.mjs';
import { hash } from '../core/storage.mjs';
import { readSettings, writeSettings } from '../core/settings.mjs';
import { cachedCard, cachedSkillTranslation, skillTranslationStore } from '../prompts/cache.mjs';
import { installedPlugins } from './plugins.mjs';

export function skillRoots(project) {
  return [{ scope: 'user', root: path.join(CLAUDE, 'skills'), settings: USER_SETTINGS }, ...(project ? [{ scope: 'project', root: path.join(project, '.claude', 'skills'), settings: path.join(project, '.claude', 'settings.local.json') }] : [])];
}

export function recursiveSkillFiles(root) {
  const found = [];
  const skip = new Set(['node_modules', '.git', '.venv', 'vendor']);
  const visited = new Set();
  function walk(dir, depth = 0) {
    if (depth > 10) return;
    let real;
    try { real = fs.realpathSync(dir); } catch { return; }
    if (visited.has(real)) return;
    visited.add(real);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') found.push(path.join(dir, entry.name));
      else if (entry.isDirectory() && !skip.has(entry.name.toLowerCase())) walk(path.join(dir, entry.name), depth + 1);
      else if (entry.isSymbolicLink()) {
        const target = path.join(dir, entry.name);
        try {
          const stats = fs.statSync(target);
          if (stats.isDirectory() && !skip.has(entry.name.toLowerCase())) walk(target, depth + 1);
          else if (stats.isFile() && entry.name.toLowerCase() === 'skill.md') found.push(target);
        } catch {}
      }
    }
  }
  walk(root);
  return found;
}

export function recursiveMarkdownFiles(root) {
  const found = [];
  function walk(dir, depth = 0) {
    if (depth > 10) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(path.join(dir, entry.name));
      else if (entry.isDirectory() && !['node_modules','.git','.venv','vendor'].includes(entry.name.toLowerCase())) walk(path.join(dir, entry.name), depth + 1);
    }
  }
  walk(root);
  return found;
}

export function skillSteps(content) {
  return String(content || '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^(?:#{1,3}\s+|(?:\d+\.|[-*])\s+)/.test(line))
    .map(line => line.replace(/^#{1,3}\s+|^(?:\d+\.|[-*])\s+/, '').replace(/[`*_#]/g, '').trim())
    .filter(Boolean).slice(0, 5).map(x => x.slice(0, 60));
}

export function readFrontmatter(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    const fm = m?.[1] || '';
    const field = key => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.replace(/^['"]|['"]$/g, '') || '';
    const bool = (value, fallback) => /^(true|yes|on|1)$/i.test(value) ? true : /^(false|no|off|0)$/i.test(value) ? false : fallback;
    return { name: field('name'), description: field('description'), disableModelInvocation: bool(field('disable-model-invocation'), false), userInvocable: bool(field('user-invocable'), true), context: field('context'), content: text };
  } catch { return { name: '', description: '', content: '' }; }
}

export function skillReviewFlags(meta) {
  const text = String(meta.content || ''), frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
  const flags = [];
  if (!meta.description) flags.push('缺少触发说明');
  if (/^allowed-tools\s*:/mi.test(frontmatter)) flags.push('配置了免确认工具');
  if (/^hooks\s*:/mi.test(frontmatter)) flags.push('会注册会话 Hook');
  if (/!`[^`]+`/m.test(text)) flags.push('包含动态命令');
  if (/^context\s*:\s*fork\s*$/mi.test(frontmatter)) flags.push('使用子代理上下文');
  if (text.split(/\r?\n/).length > 500) flags.push('说明文件较长');
  return flags;
}

export function skillRows(project) {
  const output = [];
  const translations = skillTranslationStore();
  for (const source of skillRoots(project)) {
    for (const file of recursiveSkillFiles(source.root)) {
      const fm = readFrontmatter(file);
      const relativeName = path.relative(source.root, path.dirname(file)).split(path.sep).join('/');
      const name = fm.name || relativeName;
      const settings = readSettings(source.settings);
      const projectOverride = project ? readSettings(path.join(project, '.claude', 'settings.json')).skillOverrides?.[name] : '';
      const override = settings.skillOverrides?.[name] || settings.skillOverrides?.[relativeName] || projectOverride || 'on';
      const id = hash({ file, name, scope: source.scope });
      output.push({ id, kind: 'skill', name, file, scope: source.scope, enabled: override !== 'off', invocation: override, invocationMode: fm.disableModelInvocation ? '手动触发' : (fm.userInvocable ? '可手动或自动触发' : '按模型判断自动触发'), modelCallable: !fm.disableModelInvocation, userInvocable: fm.userInvocable, reviewFlags: skillReviewFlags(fm), description: fm.description || '技能文件没有 description；打开详情查看具体指令。', lineCount: fm.content ? fm.content.split(/\r?\n/).length : 0, steps: skillSteps(fm.content), generatedCard: cachedCard(id, file), translation: cachedSkillTranslation(id, file, translations), plugin: false, sourceType: 'personal' });
    }
  }
  for (const plugin of installedPlugins()) {
    const skillsDir = path.join(plugin.installPath, 'skills');
    let dirs = [];
    try { dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter(x => x.isDirectory()); } catch {}
    for (const dir of dirs) {
      const file = path.join(skillsDir, dir.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      const fm = readFrontmatter(file);
      const name = fm.name || dir.name;
      const id = hash({ file, name, pluginId: plugin.id });
      output.push({ id, kind: 'skill', name: `${plugin.id.split('@')[0]}:${name}`, file, scope: 'plugin', pluginId: plugin.id, enabled: plugin.enabled, invocationMode: fm.disableModelInvocation ? '手动触发' : (fm.userInvocable ? '可手动或自动触发' : '按模型判断自动触发'), modelCallable: !fm.disableModelInvocation, userInvocable: fm.userInvocable, reviewFlags: skillReviewFlags(fm), description: fm.description || '插件技能。查看详情了解具体指令。', lineCount: fm.content.split(/\r?\n/).length, steps: skillSteps(fm.content), generatedCard: cachedCard(id, file), translation: cachedSkillTranslation(id, file, translations), plugin: true, sourceType: 'plugin' });
    }
  }
  const commandRoot = path.join(CLAUDE, 'commands');
  for (const file of recursiveMarkdownFiles(commandRoot)) {
    const fm = readFrontmatter(file);
    const relativeName = path.relative(commandRoot, file).replace(/\\/g, '/').replace(/\.md$/i, '');
    const name = fm.name || relativeName;
    const settings = readSettings(USER_SETTINGS);
    const override = settings.skillOverrides?.[name] || 'on';
    const id = hash({ file, name, sourceType: 'legacy-command' });
    output.push({ id, kind: 'skill', name, file, scope: 'user', enabled: override !== 'off', invocation: override, invocationMode: fm.disableModelInvocation ? '手动触发' : (fm.userInvocable ? '可手动或自动触发' : '按模型判断自动触发'), modelCallable: !fm.disableModelInvocation, userInvocable: fm.userInvocable, reviewFlags: skillReviewFlags(fm), description: fm.description || '旧格式命令文件，Claude Code 仍会将它作为可调用技能使用。', lineCount: fm.content.split(/\r?\n/).length, steps: skillSteps(fm.content), generatedCard: cachedCard(id, file), translation: cachedSkillTranslation(id, file, translations), plugin: false, sourceType: 'legacy-command' });
  }
  const names = new Map();
  for (const row of output) {
    const key = row.name.toLowerCase();
    names.set(key, (names.get(key) || 0) + 1);
  }
  for (const row of output) if ((names.get(row.name.toLowerCase()) || 0) > 1) {
    row.reviewFlags ||= [];
    row.reviewFlags.push('存在同名配置；来源或文件内容不同，需先比较再决定是否停用');
  }
  return output;
}


export function toggleSkill(body, project) {
  const row = skillRows(project).find(x => x.id === body.id);
  if (!row) throw new Error('Skill not found');
  if (row.plugin) {
    const settings = readSettings(USER_SETTINGS);
    settings.enabledPlugins ||= {};
    settings.enabledPlugins[row.pluginId] = Boolean(body.enabled);
    writeSettings(USER_SETTINGS, settings);
    return;
  }
  const target = row.scope === 'user' ? USER_SETTINGS : path.join(project, '.claude', 'settings.local.json');
  const settings = readSettings(target);
  settings.skillOverrides ||= {};
  if (body.enabled && row.scope === 'project' && readSettings(path.join(project, '.claude', 'settings.json')).skillOverrides?.[row.name] === 'off') settings.skillOverrides[row.name] = 'on';
  else if (body.enabled) delete settings.skillOverrides[row.name];
  else settings.skillOverrides[row.name] = 'off';
  if (!Object.keys(settings.skillOverrides).length) delete settings.skillOverrides;
  writeSettings(target, settings);
}
