import fs from 'node:fs';
import path from 'node:path';
import { STATE_FILE, USER_SETTINGS } from '../core/paths.mjs';
import { atomicJson, hash, safeReadJson } from '../core/storage.mjs';
import { readSettings, writeSettings, projectSettings } from '../core/settings.mjs';
import { state } from '../core/app-state.mjs';
import { redacted } from '../core/redact.mjs';
import { cachedCard } from '../prompts/cache.mjs';
import { installedPlugins } from './plugins.mjs';

export function hookRows(project) {
  const output = [];
  const sources = [{ scope: 'user', file: USER_SETTINGS }, ...(project ? projectSettings(project) : [])];
  const disabled = state().disabledHooks;
  for (const source of sources) {
    const config = readSettings(source.file);
    const hooks = config.hooks || {};
    for (const [event, groups] of Object.entries(hooks)) {
      for (const group of Array.isArray(groups) ? groups : []) {
        for (const handler of group.hooks || []) {
          const id = hash({ scope: source.scope, file: source.file, event, matcher: group.matcher || '', handler });
          const command = handler.command || handler.url || handler.prompt || handler.agent || handler.type || 'hook';
          output.push({
            id, kind: 'hook', enabled: true, scope: source.scope, file: source.file,
            event, matcher: group.matcher || '*', type: handler.type || 'unknown',
            command: redacted(String(command).replace(/\s+/g, ' ').slice(0, 240)),
            title: commandLabel(command),
            description: group.description || handler.description || describeHook(event, group.matcher || '*'),
            recommendation: hookRecommendation(event, commandLabel(command)),
            cost: hookCadence(event),
            flowSteps: [`${event} 触发`, `匹配 ${group.matcher || '*'}`, `${commandLabel(command)} 执行`, '返回结果 / 继续 Claude'],
            generatedCard: cachedCard(id, source.file),
          });
        }
      }
    }
  }
  for (const [id, saved] of Object.entries(disabled)) {
    if (!saved || !saved.event || !['user','plugin'].includes(saved.meta?.scope) || output.some(row => row.id === id)) continue;
    output.push({ ...saved.meta, id, enabled: false, kind: 'hook' });
  }
  for (const plugin of installedPlugins()) {
    const file = path.join(plugin.installPath, 'hooks', 'hooks.json');
    if (!fs.existsSync(file)) continue;
    const hooks = safeReadJson(file, {}).hooks || {};
    for (const [event, groups] of Object.entries(hooks)) for (const group of Array.isArray(groups) ? groups : []) for (const handler of group.hooks || []) {
      const id = hash({ scope: 'plugin', pluginId: plugin.id, file, event, matcher: group.matcher || '', handler });
      const description = group.description || `此 Hook 随 ${plugin.id} 插件启停。关闭它会同时关闭该插件的技能和工具。`;
      const isGateGuard = /gateguard/i.test(description) || /gateguard-fact-force/i.test(handler.command || '');
      const hookTitle = isGateGuard ? (/fact-forcing gate/i.test(description) ? 'ECC GateGuard · Fact-forcing gate' : 'ECC GateGuard · Bash preflight') : plugin.id.split('@')[0];
      output.push({ id, kind: 'hook', enabled: plugin.enabled, scope: 'plugin', pluginId: plugin.id, file, event, matcher: group.matcher || '*', type: handler.type || 'unknown', command: redacted(String(handler.command || handler.type || 'plugin hook').replace(/\s+/g, ' ').slice(0, 240)), title: hookTitle, searchAliases: isGateGuard ? ['GateGuard', 'ECC GateGuard', 'gateguard-fact-force'] : [], description, recommendation: '插件内 Hook：是否必要取决于插件整体用途。', cost: hookCadence(event), flowSteps: [`${event} 触发`, `匹配 ${group.matcher || '*'}`, `${plugin.id} 处理事件`, '工具 / 会话继续'], generatedCard: cachedCard(id, file), plugin: true });
    }
  }
  return output;
}

export function describeHook(event, matcher) {
  const names = {
    SessionStart: 'Claude Code 会话开始时运行。常用于准备上下文或启动辅助服务。',
    UserPromptSubmit: '每次提交问题前运行。可能改写输入、注入信息或做检查。',
    PreToolUse: `Claude 调用 ${matcher} 工具前运行。可拦截命令或做前置检查。`,
    PostToolUse: `Claude 调用 ${matcher} 工具成功后运行。常用于格式化、检查或记录结果。`,
    PostToolUseFailure: '工具执行失败后运行。常用于整理错误或自动恢复。',
    Stop: 'Claude 每次完成一轮回复时运行。',
    StopFailure: '模型请求失败结束时运行。',
    SubagentStart: '子代理启动时运行。',
    SubagentStop: '子代理结束时运行。',
    PermissionRequest: 'Claude 需要权限时运行。',
    Notification: 'Claude Code 需要通知你时运行。',
    PreCompact: '上下文压缩前运行。',
  };
  return names[event] || `${event} 时运行的自动动作。查看命令和脚本可以确认具体用途。`;
}

export function hookCadence(event) {
  if (['PreToolUse', 'PostToolUse', 'PostToolUseFailure'].includes(event)) return '每次工具调用';
  if (['UserPromptSubmit', 'Stop', 'StopFailure'].includes(event)) return '每轮对话';
  return '按事件触发';
}

export function commandLabel(command) {
  const part = String(command).split(/\s+/).find(value => /\.(?:m?js|cjs|py|ps1|sh|cmd|bat)["']?$/i.test(value));
  return path.basename((part || String(command).split(/\s+/)[0] || 'hook').replace(/["']/g, ''));
}

export function hookRecommendation(event, title) {
  const t = title.toLowerCase();
  if (t.includes('block-dangerous') || t.includes('safety')) return '建议保留：拦截危险操作，关闭会减少保护。';
  if (t.includes('format')) return '通常保留：修改代码后自动整理格式。';
  if (t.includes('typecheck') || t.includes('test')) return '按需保留：自动检查质量，项目大时可能增加等待。';
  if (t.includes('notify') || t.includes('meow') || t.includes('woof')) return '可选：只负责提醒或提示音。';
  if (t.includes('memory')) return '按需保留：会话开始时读取记忆服务；服务不可用时可能拖慢启动。';
  if (t.includes('completion-guard')) return '谨慎关闭：可能负责阻止未完成的回复直接结束。';
  if (t.includes('image-strip')) return '按需保留：处理图片输入，可能帮助控制图片内容和上下文。';
  if (['PreToolUse','PostToolUse','PostToolUseFailure'].includes(event)) return '按需检查：工具调用时都会触发，脚本慢会增加等待。';
  return '查看脚本后决定：当前信息不足以判断它是否必要。';
}


export function toggleHook(body, project) {
  const id = String(body.id || '');
  const enabled = Boolean(body.enabled);
  const pluginEntry = hookRows(project).find(x => x.id === id && x.plugin);
  if (pluginEntry) {
    const settings = readSettings(USER_SETTINGS);
    settings.enabledPlugins ||= {};
    settings.enabledPlugins[pluginEntry.pluginId] = enabled;
    writeSettings(USER_SETTINGS, settings);
    return;
  }
  const disabled = state().disabledHooks;
  if (!enabled) {
    const entry = hookRows(project).find(x => x.id === id && x.enabled);
    if (!entry) throw new Error('Hook not found or already disabled');
    const settings = readSettings(entry.file);
    const groups = settings.hooks?.[entry.event];
    const group = groups?.find(g => (g.matcher || '*') === entry.matcher && (g.hooks || []).some(h => hash({ scope: entry.scope, file: entry.file, event: entry.event, matcher: g.matcher || '', handler: h }) === id));
    if (!group) throw new Error('Hook changed since the list was loaded');
    const index = group.hooks.findIndex(h => hash({ scope: entry.scope, file: entry.file, event: entry.event, matcher: group.matcher || '', handler: h }) === id);
    const [handler] = group.hooks.splice(index, 1);
    disabled[id] = { event: entry.event, matcher: group.matcher || '', handler, groupMeta: Object.fromEntries(Object.entries(group).filter(([k]) => k !== 'hooks')), meta: { ...entry, enabled: false } };
    if (!group.hooks.length) {
      const gi = groups.indexOf(group); groups.splice(gi, 1);
      if (!groups.length) delete settings.hooks[entry.event];
    }
    if (!Object.keys(settings.hooks || {}).length) delete settings.hooks;
    writeSettings(entry.file, settings);
    atomicJson(STATE_FILE, { ...state(), disabledHooks: disabled });
  } else {
    const saved = disabled[id];
    if (!saved) throw new Error('No preserved hook data found');
    const file = saved.meta.file;
    const settings = readSettings(file);
    settings.hooks ||= {};
    settings.hooks[saved.event] ||= [];
    let group = settings.hooks[saved.event].find(g => (g.matcher || '*') === saved.matcher);
    if (!group) { group = { ...saved.groupMeta, matcher: saved.matcher, hooks: [] }; settings.hooks[saved.event].push(group); }
    if (!group.hooks.some(h => JSON.stringify(h) === JSON.stringify(saved.handler))) group.hooks.push(saved.handler);
    writeSettings(file, settings);
    delete disabled[id];
    atomicJson(STATE_FILE, { ...state(), disabledHooks: disabled });
  }
}
