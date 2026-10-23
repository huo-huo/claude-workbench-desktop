import path from 'node:path';
import { HOME, USER_SETTINGS } from '../core/paths.mjs';
import { hash, safeReadJson } from '../core/storage.mjs';
import { readSettings, writeSettings, projectSettings } from '../core/settings.mjs';
import { cachedCard } from '../prompts/cache.mjs';
import { installedPlugins } from './plugins.mjs';

export function mcpRows(project) {
  const rows = [];
  const claudeJsonFile = path.join(HOME, '.claude.json');
  const claudeJson = safeReadJson(claudeJsonFile, {});
  const disabledUser = new Set(readSettings(USER_SETTINGS).disabledMcpServers || []);
  const userServers = claudeJson.mcpServers || {};
  for (const [name, config] of Object.entries(userServers)) {
    const id = hash({ file: claudeJsonFile, scope: 'user', name });
    rows.push({ id, kind: 'mcp', name, file: claudeJsonFile, scope: 'user', transport: config.type || (config.url ? 'http' : 'stdio'), enabled: !disabledUser.has(name), description: mcpDescription(name), recommendation: mcpRecommendation(name), flowSteps: ['Claude Code 启动', `${name} MCP 连接`, '读取工具与资源定义', 'Claude 按需调用工具'], generatedCard: cachedCard(id, claudeJsonFile) });
  }
  const localServers = project ? claudeJson.projects?.[project]?.mcpServers || {} : {};
  for (const [name, config] of Object.entries(localServers)) {
    const files = projectSettings(project);
    const disabled = new Set(files.flatMap(x => readSettings(x.file).disabledMcpServers || []));
    const id = hash({ file: claudeJsonFile, scope: 'local', project, name });
    rows.push({ id, kind: 'mcp', name, file: claudeJsonFile, scope: 'project', project, transport: config.type || (config.url ? 'http' : 'stdio'), enabled: !disabled.has(name), description: mcpDescription(name), recommendation: mcpRecommendation(name), flowSteps: ['Claude Code 启动', `${name} MCP 连接`, '读取工具与资源定义', 'Claude 按需调用工具'], generatedCard: cachedCard(id, claudeJsonFile) });
  }
  const projectMcpFile = project ? path.join(project, '.mcp.json') : '';
  const projectMcp = projectMcpFile ? safeReadJson(projectMcpFile, {}).mcpServers || {} : {};
  const projectDisabled = new Set(project ? projectSettings(project).flatMap(x => readSettings(x.file).disabledMcpServers || []) : []);
  for (const [name, config] of Object.entries(projectMcp)) {
    const id = hash({ file: projectMcpFile, scope: 'project-file', project, name });
    rows.push({ id, kind: 'mcp', name, file: projectMcpFile, scope: 'project', project, transport: config.type || (config.url ? 'http' : 'stdio'), enabled: !projectDisabled.has(name), description: mcpDescription(name), recommendation: mcpRecommendation(name), flowSteps: ['Claude Code 启动', `${name} MCP 连接`, '读取工具与资源定义', 'Claude 按需调用工具'], generatedCard: cachedCard(id, projectMcpFile) });
  }
  for (const plugin of installedPlugins()) {
    const file = path.join(plugin.installPath, '.mcp.json');
    const servers = safeReadJson(file, {}).mcpServers || {};
    for (const [name, config] of Object.entries(servers)) {
      const id = hash({ file, scope: 'plugin', pluginId: plugin.id, name });
      rows.push({ id, kind: 'mcp', name, file, scope: 'plugin', pluginId: plugin.id, transport: config.type || (config.url ? 'http' : 'stdio'), enabled: plugin.enabled, description: `${mcpDescription(name)} 来自 ${plugin.id} 插件；切换会启停整个插件。`, recommendation: mcpRecommendation(name), flowSteps: ['插件启用', `${name} MCP 连接`, '注册工具与资源', 'Claude 按需调用'], generatedCard: cachedCard(id, file), plugin: true });
    }
  }
  return rows;
}

export function mcpDescription(name) {
  const n = name.toLowerCase();
  if (n.includes('figma')) return '让 Claude 读取 Figma 设计文件或相关资源。';
  if (n.includes('playwright')) return '让 Claude 操作浏览器、查看页面和执行自动化交互。';
  if (n.includes('memory')) return '提供跨会话记忆或检索能力。';
  return '连接一个外部工具或数据源。详情里可查看连接方式；密钥会隐藏。';
}

export function mcpRecommendation(name) {
  const n = name.toLowerCase();
  if (n.includes('playwright')) return '建议按需开启：浏览器工具面较大，只有需要网页检查或自动化时启用。';
  if (n.includes('figma')) return '做 UI 或读取设计稿时开启；其他任务可关闭。';
  if (n.includes('memory')) return '需要跨会话记忆时开启；服务不可用时检查连接，避免启动钩子反复等待。';
  return '按实际任务开启；检查此服务器能访问哪些外部数据和工具。';
}


export function toggleMcp(body, project) {
  const row = mcpRows(project).find(x => x.id === body.id);
  if (!row) throw new Error('MCP server not found');
  if (row.plugin) {
    const settings = readSettings(USER_SETTINGS);
    settings.enabledPlugins ||= {};
    settings.enabledPlugins[row.pluginId] = Boolean(body.enabled);
    writeSettings(USER_SETTINGS, settings);
    return;
  }
  const settingsFile = row.scope === 'user' ? USER_SETTINGS : path.join(project, '.claude', 'settings.local.json');
  const settings = readSettings(settingsFile);
  const disabled = new Set(settings.disabledMcpServers || []);
  if (body.enabled) disabled.delete(row.name); else disabled.add(row.name);
  if (disabled.size) settings.disabledMcpServers = [...disabled]; else delete settings.disabledMcpServers;
  writeSettings(settingsFile, settings);
}
