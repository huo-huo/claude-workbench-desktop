import fs from 'node:fs';
import path from 'node:path';
import { CLAUDE, USER_SETTINGS } from '../core/paths.mjs';
import { safeReadJson } from '../core/storage.mjs';
import { readSettings, writeSettings } from '../core/settings.mjs';

export function installedPlugins() {
  const records = safeReadJson(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), {}).plugins || {};
  const enabled = readSettings(USER_SETTINGS).enabledPlugins || {};
  return Object.entries(records).map(([id, installs]) => {
    const item = Array.isArray(installs) ? installs[0] : installs;
    return { id, installPath: item?.installPath, version: item?.version || '', installedAt: item?.installedAt || '', scope: item?.scope || 'user', enabled: enabled[id] === true };
  }).filter(x => x.installPath && fs.existsSync(x.installPath));
}

export function pluginRows(hooks, skills, mcp) {
  return installedPlugins().map(plugin => {
    const manifestFile = path.join(plugin.installPath, '.claude-plugin', 'plugin.json');
    const manifest = safeReadJson(manifestFile, safeReadJson(path.join(plugin.installPath, 'plugin.json'), {}));
    let agentCount = 0, commandCount = 0;
    try { agentCount = fs.readdirSync(path.join(plugin.installPath, 'agents')).filter(x => x.endsWith('.md')).length; } catch {}
    try { commandCount = fs.readdirSync(path.join(plugin.installPath, 'commands')).filter(x => x.endsWith('.md')).length; } catch {}
    return {
      id: plugin.id, name: manifest.name || plugin.id.split('@')[0], marketplace: plugin.id.split('@').slice(1).join('@'),
      version: manifest.version || plugin.version, installedAt: plugin.installedAt, scope: plugin.scope,
      enabled: plugin.enabled, description: manifest.description || '已安装的 Claude Code 插件；可包含 Skills、Hooks、MCP、Agents 或命令。',
      installPath: plugin.installPath,
      components: {
        skills: skills.filter(x => x.pluginId === plugin.id).length,
        hooks: hooks.filter(x => x.pluginId === plugin.id).length,
        mcp: mcp.filter(x => x.pluginId === plugin.id).length,
        agents: agentCount, commands: commandCount,
        lsp: fs.existsSync(path.join(plugin.installPath, '.lsp.json')),
      },
    };
  });
}


/** 切换插件整包开关；只写入 enabledPlugins，不删除插件文件 */
export function togglePlugin(body) {
  const id = String(body.id || '');
  if (!installedPlugins().some(plugin => plugin.id === id)) throw new Error('找不到该插件');
  const settings = readSettings(USER_SETTINGS);
  settings.enabledPlugins ||= {};
  settings.enabledPlugins[id] = Boolean(body.enabled);
  writeSettings(USER_SETTINGS, settings);
}
