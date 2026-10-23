// 管理页插件卡片页：pluginCardsPage 渲染器（自 index.html 内联脚本逐字迁移）
import { state } from '../state.mjs';
import { esc } from '../core/dom.mjs';
import { filteredRows, toolbar } from '../common/cards.mjs';
import { titleBlock } from './dashboard.mjs';

export function pluginCardsPage(){
  const all=state.data.plugins||[],rows=filteredRows(all),enabled=all.filter(x=>x.enabled).length;
  const cards=rows.map(x=>{const c=x.components||{};return '<article class="logic-card"><div class="logic-head"><div><h3>'+esc(x.name)+'</h3><div class="logic-sub">'+esc(x.id)+' · '+esc(x.version||'版本未知')+' · '+esc(x.scope||'user')+'</div></div><span class="state '+(x.enabled?'on':'off')+'">'+(x.enabled?'已启用':'已关闭')+'</span></div><p>'+esc(x.description||'暂无插件说明。')+'</p><div class="status-row"><span>'+esc(x.marketplace||'本地来源')+'</span><span>安装时间 '+esc(x.installedAt||'未知')+'</span></div><div class="flowline"><div class="flowstep"><b>SKILLS</b>'+c.skills+' 个</div><div class="flowstep"><b>HOOKS</b>'+c.hooks+' 个</div><div class="flowstep"><b>MCP</b>'+c.mcp+' 个</div><div class="flowstep"><b>AGENTS</b>'+c.agents+' 个</div><div class="flowstep"><b>COMMANDS</b>'+c.commands+' 个</div>'+(c.lsp?'<div class="flowstep"><b>LSP</b>已配置</div>':'')+'</div><div class="logic-meta">插件目录：<span class="mono">'+esc(x.installPath)+'</span></div><div class="channel-actions"><input class="switch" type="checkbox" data-toggle="plugin" data-id="'+esc(x.id)+'" '+(x.enabled?'checked':'')+' aria-label="切换插件 '+esc(x.name)+'"><span class="subtle">这是整包开关；不会删除插件文件</span></div></article>'}).join('');
  return titleBlock('plugins')+'<div class="status-row"><b>'+enabled+' / '+all.length+'</b> 个插件已启用。插件是组件包，可能同时提供 Skill、Hook、MCP、Agent 或命令。</div>'+toolbar(all.length)+'<div class="notice neutral"><i class="markdot"></i><div><strong>注意影响范围</strong>　关闭插件会一起停用它提供的组件；不会删除安装文件。Meta-Kim 的用户级 Hooks 和 meta-kim-runtime MCP 是独立配置，不属于插件包。</div></div><div class="card-grid">'+(cards||'<div class="empty">没有匹配的插件</div>')+'</div>';
}
