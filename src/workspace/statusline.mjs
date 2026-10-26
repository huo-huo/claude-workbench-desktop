import { $, escapeHtml } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';

/** 上次渲染的会话 ID，切换会话后强制重绘一次 */
let renderedForSession = '';

/** 最近一次服务端状态，供配置面板读取启用标志 */
let lastState = null;

/** 状态栏显示单元清单：key 对应持久化配置，row 区分第一行（会话状态）与第二行（配置/会话计数） */
const STATUSLINE_ITEMS = [
  { key: 'connection', label: '连接状态（运行中）', row: 1 },
  { key: 'cliLabel', label: '本机 Claude Code CLI 标签', row: 1 },
  { key: 'model', label: '模型名', row: 1 },
  { key: 'context', label: '上下文用量', row: 1 },
  { key: 'branch', label: 'git 分支', row: 1 },
  { key: 'todo', label: '待办进度', row: 1 },
  { key: 'cost', label: '成本', row: 1 },
  { key: 'tokens', label: 'Token 统计', row: 1 },
  { key: 'duration', label: '会话耗时', row: 1 },
  { key: 'lines', label: '行数变更', row: 1 },
  { key: 'claudeMd', label: 'CLAUDE.md 计数', row: 2 },
  { key: 'rules', label: '规则计数', row: 2 },
  { key: 'mcpConfig', label: 'MCPs（配置）', row: 2 },
  { key: 'hooks', label: 'Hooks', row: 2 },
  { key: 'sessionSkills', label: '✓ Skills（会话）', row: 2 },
  { key: 'sessionMcp', label: '✓ MCPs（会话）', row: 2 },
];

const CONFIG_STORAGE_KEY = 'claude-workbench-statusline-config';
const FONT_RANGE = { min: 8, max: 14, default: 8 };

/** 读取持久化配置；缺省全部显示、字号 8px */
function loadStatuslineConfig() {
  const fallback = { fontSize: FONT_RANGE.default, items: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || '');
    if (!raw || typeof raw !== 'object') return fallback;
    return { fontSize: Number(raw.fontSize) || FONT_RANGE.default, items: raw.items && typeof raw.items === 'object' ? raw.items : {} };
  } catch {
    return fallback;
  }
}

/** 持久化配置；写入失败静默（配置仍在当前会话生效） */
function saveStatuslineConfig(config) {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch { /* 忽略写入异常 */ }
}

/** 某个显示单元是否启用；未配置过默认显示 */
function itemEnabled(config, key) {
  return config.items[key] !== false;
}

/** 应用字体大小到状态栏区域 */
function applyFontSize(size) {
  const clamped = Math.max(FONT_RANGE.min, Math.min(FONT_RANGE.max, size));
  document.querySelector('.terminal-footer')?.style.setProperty('font-size', `${clamped}px`);
  return clamped;
}

/** 上下文用量的分级配色：>=80 红、>=50 黄，其余绿（与 claude-hud 一致） */
function contextTone(percentage) {
  if (percentage >= 80) return 'is-high';
  if (percentage >= 50) return 'is-mid';
  return 'is-low';
}

/** token 数格式化：1234 -> 1.2k，1234567 -> 1.23M */
function formatTokens(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** 毫秒时长格式化：4830000 -> 1h20m，142000 -> 2m22s */
function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** 上下文进度条：10 格 █░，按百分比填充 */
function contextBar(percentage) {
  const filled = Math.max(0, Math.min(10, Math.round(percentage / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/** 从转发 JSON 的 context_window 兼容多种字段名取 token 数 */
function contextTokens(status) {
  if (typeof status.context?.usedTokens === 'number') return status.context.usedTokens;
  const window = status.context_window || {};
  return [window.used_tokens, window.total_input_tokens, window.input_tokens, window.total_tokens_used]
    .find(value => typeof value === 'number');
}

/** 上下文窗口总容量：转发数据提供时显示 used/total */
function contextTotal(status) {
  const window = status.context_window || {};
  return [window.total_tokens, window.window_tokens, window.max_tokens].find(value => typeof value === 'number' && value > 0);
}

/** 思考等级符号（与 claude-hud 一致） */
const EFFORT_SYMBOLS = { low: '○', medium: '◔', high: '◑', xhigh: '◕', max: '●' };

/** 解析转发 JSON 的 effort：兼容字符串与 { level } 对象两种格式；无效返回空 */
function resolveEffort(effort) {
  const level = typeof effort === 'string' && effort ? effort
    : (effort && typeof effort === 'object' && !Array.isArray(effort) && typeof effort.level === 'string' ? effort.level : '');
  if (!level) return null;
  const normalized = level.toLowerCase().trim();
  return { level: normalized, symbol: EFFORT_SYMBOLS[normalized] || '' };
}

/** 把一条状态渲染为带样式的片段列表；字段缺失或对应单元被禁用时省略 */
function statuslineParts(status, config) {
  const parts = [];
  const model = status.model?.display_name;
  if (model && itemEnabled(config, 'model')) {
    const effort = resolveEffort(status.effort);
    const suffix = effort ? ` ${effort.symbol ? escapeHtml(effort.symbol) + ' ' : ''}${escapeHtml(effort.level)}` : '';
    parts.push(`<button type="button" class="statusline-item statusline-model statusline-model-clickable" data-model-action="1" title="点击切换模型或思考等级">[${escapeHtml(model)}${suffix}]</button>`);
  }

  const percentage = typeof status.context?.usedPercentage === 'number'
    ? status.context.usedPercentage
    : (typeof status.context_window?.used_percentage === 'number' ? status.context_window.used_percentage : undefined);
  const usedTokens = contextTokens(status);
  if ((percentage !== undefined || usedTokens !== undefined) && itemEnabled(config, 'context')) {
    // 有百分比和已用 token 时反推窗口总量（与 claude-hud 的 used/total 展示一致）
    const inferredTotal = percentage > 0 && usedTokens > 0 ? Math.round(usedTokens / (percentage / 100)) : undefined;
    const totalTokens = contextTotal(status) || inferredTotal;
    const scale = totalTokens ? `/${formatTokens(totalTokens)}` : '';
    const detail = usedTokens !== undefined ? ` (${formatTokens(usedTokens)}${scale})` : '';
    const bar = percentage !== undefined ? contextBar(percentage) : '';
    const text = percentage !== undefined ? ` ${Math.round(percentage)}%` : '';
    const tone = percentage !== undefined ? ` ${contextTone(percentage)}` : '';
    const title = `上下文窗口占用${percentage !== undefined ? `：${Math.round(percentage)}%` : ''}${usedTokens !== undefined ? `，已用 ${usedTokens} tokens` : ''}`;
    parts.push(`<span class="statusline-item statusline-context${tone}" title="${escapeHtml(title)}">${escapeHtml(`${bar}${text}${detail}`)}</span>`);
  }

  if (status.gitBranch && itemEnabled(config, 'branch')) parts.push(`<span class="statusline-item" title="当前分支">git:(${escapeHtml(status.gitBranch)})</span>`);
  if (status.todo && itemEnabled(config, 'todo')) parts.push(`<span class="statusline-item" title="待办进度">✓ todo ${status.todo.completed}/${status.todo.total}</span>`);
  if (typeof status.cost === 'number' && itemEnabled(config, 'cost')) parts.push(`<span class="statusline-item" title="本会话累计成本">$${status.cost.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}</span>`);

  // 词元累计统计（与 claude-hud 的 Token 项同口径，来自 transcript 累计）
  const tokens = status.tokens;
  if (tokens && (tokens.input || tokens.output || tokens.cache) && itemEnabled(config, 'tokens')) {
    // 图标：↑ 输入、↓ 输出、⚡ 缓存
    const detail = `↑${formatTokens(tokens.input)} ↓${formatTokens(tokens.output)} ⚡${formatTokens(tokens.cache)}`;
    const title = `Token 累计：输入 ${tokens.input}，输出 ${tokens.output}，缓存 ${tokens.cache}`;
    parts.push(`<span class="statusline-item" title="${escapeHtml(title)}">Token ${formatTokens(tokens.input + tokens.output + tokens.cache)} (${escapeHtml(detail)})</span>`);
  }

  // 会话累计耗时（Claude Code 的 total_duration_ms，与 claude-hud 的 ⏱️ 同源）
  const durationMs = status.cost_detail?.total_duration_ms;
  if (typeof durationMs === 'number' && durationMs > 0 && itemEnabled(config, 'duration')) {
    parts.push(`<span class="statusline-item" title="会话累计耗时">⏱️ ${escapeHtml(formatDuration(durationMs))}</span>`);
  }
  const linesAdded = status.cost_detail?.total_lines_added;
  const linesRemoved = status.cost_detail?.total_lines_removed;
  if ((typeof linesAdded === 'number' || typeof linesRemoved === 'number') && itemEnabled(config, 'lines')) {
    const added = typeof linesAdded === 'number' ? `+${linesAdded}` : '';
    const removed = typeof linesRemoved === 'number' ? `−${linesRemoved}` : '';
    const joined = [added, removed].filter(Boolean).join(' ');
    parts.push(`<span class="statusline-item" title="代码行变更">± ${escapeHtml(joined)}</span>`);
  }
  return parts;
}

/** 按服务端返回渲染状态栏；拉取失败时保留上次内容 */
function renderStatusline(state) {
  lastState = state;
  const config = loadStatuslineConfig();
  // 连接状态与 CLI 标签是 footer 的原有元素，显示与否同样由配置控制
  $('#terminalState').hidden = !itemEnabled(config, 'connection');
  $('#terminalCliLabel').hidden = !itemEnabled(config, 'cliLabel');
  const bar = $('#statuslineBar');
  if (!state.enabled) {
    bar.hidden = true;
    bar.innerHTML = '';
    renderConfigStats(null, config);
    return;
  }
  bar.hidden = false;
  if (!state.status) {
    // 启用中但还没有可用状态：区分未连接会话与已连接但暂无转发数据两种情形
    bar.innerHTML = app.activeSession
      ? '<span class="statusline-placeholder">暂无状态数据；会话有活动后自动更新</span>'
      : '<span class="statusline-placeholder">未连接会话；新建或打开对话后显示状态</span>';
  } else {
    const parts = statuslineParts(state.status, config);
    bar.innerHTML = parts.length ? parts.join('<span class="statusline-sep">·</span>') : '<span class="statusline-placeholder">所有显示项均已关闭或状态字段缺失</span>';
  }
  renderConfigStats(state, config);
}

/**
 * 渲染第二行：配置计数（CLAUDE.md/规则/钩子/MCPs）+ 会话口径（✓ Skills/✓ MCPs，
 * 来自 transcript 中实际调用过的工具，与 claude-hud 同口径）；每项可点击查看详情，
 * 显示与否由持久化配置控制。
 */
function renderConfigStats(state, config) {
  const host = $('#statuslineConfig');
  const stats = state?.configStats;
  if (!stats) {
    host.hidden = true;
    host.innerHTML = '';
    return;
  }
  host.hidden = false;
  const status = state.status || {};
  const items = [
    { key: 'claudeMd', setting: 'claudeMd', label: `${stats.claudeMd.count} CLAUDE.md`, title: 'CLAUDE.md 记忆文件', subtitle: '全局与项目各变体计入', detail: { 类型: '记忆文件', 说明: '~/.claude/CLAUDE.md、项目 CLAUDE.md / CLAUDE.local.md 及 .claude/ 下变体' } },
    { key: 'rules', setting: 'rules', label: `${stats.rules.count} 规则`, title: '规则文件', subtitle: '~/.claude/rules 与项目 .claude/rules 递归统计', detail: { 类型: 'Markdown 规则', 说明: '两个 rules 目录下的全部 .md 文件' } },
    { key: 'mcpConfig', setting: 'mcpConfig', label: `${stats.mcp.count} MCPs`, title: 'MCP 服务器（配置）', subtitle: '全局 settings、~/.claude.json 与项目 .mcp.json 的并集', names: stats.mcp.names },
    { key: 'hooks', setting: 'hooks', label: `${stats.hooks.count} Hooks`, title: 'Hook 事件类型', subtitle: 'settings.json 中配置的 hook 事件、匹配器与命令', hookGroups: stats.hooks.groups || [] },
    { key: 'sessionSkills', setting: 'sessionSkills', label: `✓ Skills (${status.sessionSkills?.length || 0})`, title: '本会话调用过的技能', subtitle: '当前会话 transcript 中实际调用过的 Skill 工具', names: status.sessionSkills || [] },
    { key: 'sessionMcp', setting: 'sessionMcp', label: `✓ MCPs (${status.sessionMcpServers?.length || 0})`, title: '本会话调用过的 MCP 服务器', subtitle: '当前会话 transcript 中实际调用过的 mcp__ 工具', names: status.sessionMcpServers || [] },
  ].filter(item => itemEnabled(config, item.setting));
  host.innerHTML = items.map(item =>
    `<button type="button" class="statusline-config-item" data-config-key="${item.key}" title="${escapeHtml(item.title)}">${escapeHtml(item.label)}</button>`
  ).join('<span class="statusline-sep">│</span>');
  host.hidden = !items.length;
  host.dataset.payload = JSON.stringify(items);
}

/** 打开配置详情面板；item 为 renderConfigStats 中保存的条目 */
function openConfigDetail(item) {
  const backdrop = $('#statuslineDetailBackdrop');
  $('#statuslineDetailTitle').textContent = item.title;
  $('#statuslineDetailSubtitle').textContent = item.subtitle || '';
  const body = $('#statuslineDetailBody');
  if (item.hookGroups) {
    // 钩子详情：事件类型 → 匹配器 → 命令清单
    body.innerHTML = item.hookGroups.map(group => `
      <div class="statusline-detail-line statusline-detail-event">${escapeHtml(group.event)}</div>
      ${group.matchers.map(matcher => `
        <div class="statusline-detail-line statusline-detail-nested">matcher: ${escapeHtml(matcher.matcher)}</div>
        ${matcher.commands.map(command => `<div class="statusline-detail-line statusline-detail-nested statusline-detail-command">↳ ${escapeHtml(command)}</div>`).join('') || '<div class="statusline-detail-line statusline-detail-nested statusline-placeholder">（无命令）</div>'}
      `).join('')}
    `).join('');
  } else if (item.names?.length) {
    body.innerHTML = item.names.map(name => `<div class="statusline-detail-line">${escapeHtml(name)}</div>`).join('');
  } else {
    body.innerHTML = Object.entries(item.detail || {}).map(([key, value]) => `<div class="statusline-detail-line"><b>${escapeHtml(key)}</b>：${escapeHtml(value)}</div>`).join('');
  }
  if (!body.innerHTML) body.innerHTML = '<div class="statusline-detail-line statusline-placeholder">暂无内容</div>';
  backdrop.hidden = false;
}

/** 关闭配置详情面板 */
export function closeConfigDetail() {
  $('#statuslineDetailBackdrop').hidden = true;
}

/** 打开状态栏配置面板并渲染当前配置 */
export function openStatuslineSettings() {
  const config = loadStatuslineConfig();
  $('#statuslineFontSize').textContent = `${config.fontSize}px`;
  $('#settingWrapper').checked = Boolean(lastState?.enabled);
  $('#settingWrapper').disabled = !lastState;
  const toggles = $('#statuslineItemToggles');
  toggles.innerHTML = STATUSLINE_ITEMS.map(item =>
    `<label class="statusline-setting-row"><span class="statusline-setting-label">${escapeHtml(item.label)}<small>${item.row === 1 ? '第一行 · 会话状态' : '第二行 · 配置与会话'}</small></span><input type="checkbox" class="switch" data-item-toggle="${item.key}" ${itemEnabled(config, item.key) ? 'checked' : ''}></label>`
  ).join('');
  $('#statuslineSettingsBackdrop').hidden = false;
}

/** 关闭状态栏配置面板 */
export function closeStatuslineSettings() {
  $('#statuslineSettingsBackdrop').hidden = true;
}

/** 拉取当前激活会话的状态栏数据并渲染；失败静默保留上次内容 */
export async function refreshStatusline() {
  if (app.workspace.hidden) return;
  const sessionId = app.activeSession?.id || '';
  try {
    // 无激活会话时仍拉取启用标志，保证配置入口在进入工作站后即可见
    const state = await api(sessionId ? `/api/statusline/state?id=${encodeURIComponent(sessionId)}` : '/api/statusline/state');
    // 响应返回时若已切换会话则丢弃，避免旧会话状态闪烁
    if (sessionId && app.activeSession?.id !== sessionId && sessionId !== renderedForSession) return;
    renderedForSession = sessionId;
    renderStatusline(state);
  } catch {
    // 网络失败保留上次内容，不打断用户
  }
}

/** 打开模型/思考等级切换面板；候选来自用户 settings 的 modelPicker，切换通过注入 CLI 命令 */
function openSwitchPanel() {
  if (!app.activeSession) {
    toast('先打开一个对话会话再切换模型');
    return;
  }
  const state = lastState;
  const backdrop = $('#statuslineSwitchBackdrop');
  const list = $('#statuslineSwitchBody');
  const meta = state?.modelOptions || {};
  const options = Array.isArray(meta.options) ? meta.options : [];
  const currentModel = state?.status?.model?.display_name || '';
  const currentEffort = resolveEffort(state?.status?.effort)?.level || '';
  const modelRows = options.length
    ? options.map(option =>
        `<button type="button" class="statusline-switch-option${option.label === currentModel || option.model === currentModel ? ' is-current' : ''}" data-switch-model="${escapeHtml(option.model)}"><strong>${escapeHtml(option.label)}</strong><small>${escapeHtml(option.model)}</small></button>`
      ).join('')
    : '<div class="statusline-detail-line statusline-placeholder">settings.json 中没有配置 modelPicker.options，无法提供候选</div>';
  const effortLevels = ['low', 'medium', 'high', 'xhigh', 'max'];
  const effortRows = effortLevels.map(level =>
    `<button type="button" class="statusline-switch-option${level === currentEffort ? ' is-current' : ''}" data-switch-effort="${level}"><strong>${EFFORT_SYMBOLS[level] || ''} ${level}</strong><small>/effort ${level}</small></button>`
  ).join('');
  const envWarning = meta.effortLockedByEnv
    ? `<p class="statusline-switch-warning">⚠ settings.json 的 env 中设置了 CLAUDE_CODE_EFFORT_LEVEL=${escapeHtml(meta.effortLockedValue || '')}，环境变量优先级最高——思考等级切换不会生效。需要从 settings.json 的 env 中移除该键。</p>`
    : '';
  list.innerHTML = `${envWarning}<div class="statusline-switch-group"><h3>模型</h3>${modelRows}</div><div class="statusline-switch-group"><h3>思考等级</h3>${effortRows}</div><p class="statusline-placeholder">切换会向当前会话终端注入 /model 或 /effort 命令并立即执行</p>`;
  backdrop.hidden = false;
}

/** 关闭模型/思考等级切换面板 */
export function closeSwitchPanel() {
  $('#statuslineSwitchBackdrop').hidden = true;
}

/** 向激活会话注入切换命令 */
async function sendSwitch(payload) {
  if (!app.activeSession) return toast('当前没有激活的会话');
  try {
    const result = await api('/api/statusline/switch', { method: 'POST', body: { id: app.activeSession.id, ...payload } });
    toast(`已向终端发送：${result.sent}`);
    closeSwitchPanel();
  } catch (error) {
    toast(error.message);
  }
}

// 状态栏点击与键盘绑定（模块加载时执行一次）
document.addEventListener('click', event => {
  if (event.target.closest?.('[data-model-action]')) {
    openSwitchPanel();
    return;
  }
  const modelOption = event.target.closest?.('[data-switch-model]');
  if (modelOption) {
    sendSwitch({ model: modelOption.dataset.switchModel });
    return;
  }
  const effortOption = event.target.closest?.('[data-switch-effort]');
  if (effortOption) {
    sendSwitch({ effort: effortOption.dataset.switchEffort });
    return;
  }
  const switchBackdrop = event.target.closest?.('#statuslineSwitchBackdrop');
  if (switchBackdrop && (event.target === switchBackdrop || event.target.closest?.('#closeStatuslineSwitch'))) closeSwitchPanel();
  const item = event.target.closest?.('.statusline-config-item');
  if (item) {
    const payload = JSON.parse(item.closest('#statuslineConfig').dataset.payload || '[]');
    const entry = payload.find(data => data.key === item.dataset.configKey);
    if (entry) openConfigDetail(entry);
    return;
  }
  const detailBackdrop = event.target.closest?.('#statuslineDetailBackdrop');
  if (detailBackdrop && (event.target === detailBackdrop || event.target.closest?.('#closeStatuslineDetail'))) closeConfigDetail();
  const settingsBackdrop = event.target.closest?.('#statuslineSettingsBackdrop');
  if (settingsBackdrop && (event.target === settingsBackdrop || event.target.closest?.('#closeStatuslineSettings'))) closeStatuslineSettings();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!$('#statuslineDetailBackdrop').hidden) closeConfigDetail();
  if (!$('#statuslineSettingsBackdrop').hidden) closeStatuslineSettings();
  if (!$('#statuslineSwitchBackdrop').hidden) closeSwitchPanel();
});

// 显示项开关：切换即持久化并立即重绘
document.addEventListener('change', event => {
  const key = event.target?.dataset?.itemToggle;
  if (!key) return;
  const config = loadStatuslineConfig();
  config.items[key] = event.target.checked;
  saveStatuslineConfig(config);
  if (lastState) renderStatusline(lastState);
});

// 字体大小步进
document.addEventListener('click', event => {
  const dir = event.target.closest?.('#statuslineFontMinus') ? -1 : event.target.closest?.('#statuslineFontPlus') ? 1 : 0;
  if (!dir) return;
  const config = loadStatuslineConfig();
  config.fontSize = Math.max(FONT_RANGE.min, Math.min(FONT_RANGE.max, config.fontSize + dir));
  saveStatuslineConfig(config);
  applyFontSize(config.fontSize);
  $('#statuslineFontSize').textContent = `${config.fontSize}px`;
});

/** 启用/禁用 statusLine 包装并立即刷新状态栏（配置面板内的包装开关） */
export async function setWrapperEnabled(enable) {
  try {
    await api(enable ? '/api/statusline/enable' : '/api/statusline/disable', {
      method: 'POST',
      body: { port: Number(location.port) || 4173 },
    });
    toast(enable ? 'statusLine 包装已启用；终端内原状态栏由软件状态栏替代显示' : 'statusLine 包装已禁用，终端内已恢复原命令');
  } catch (error) {
    toast(error.message);
  }
  await refreshStatusline();
}

// 包装开关在配置面板中切换
document.addEventListener('change', event => {
  if (event.target?.id !== 'settingWrapper') return;
  setWrapperEnabled(event.target.checked);
});

// 初始化时应用持久化的字体大小
applyFontSize(loadStatuslineConfig().fontSize);
