// 管理页版本管理页：versionPage 渲染器与 wireVersions 事件绑定（自 index.html 内联脚本逐字迁移）
// 注：versionPage 内部有局部变量 const state（检查结果文案），故页面状态对象以 pageState 别名导入
import { state as pageState } from '../state.mjs';
import { esc, displayDateTime, post, toast } from '../core/dom.mjs';
import { titleBlock } from './dashboard.mjs';
import { render, setPage } from '../index.mjs';

export function versionPage(){
  const v=pageState.data.claudeVersion||{},checked=v.checkedAt?displayDateTime(v.checkedAt):'尚未检查';
  const state=!v.checkedAt?'请先检查更新':v.updateAvailable?'发现新版本':'当前已是最新版本';
  return titleBlock('versions')+
    '<div class="metric-grid"><article class="metric-card"><small>当前版本</small><strong>'+esc(v.version||v.installedVersion||'未知')+'</strong><span>'+esc(v.installMethod||'未识别安装方式')+'</span></article><article class="metric-card"><small>检查结果</small><strong>'+esc(state)+'</strong><span>最近检查：'+esc(checked)+'</span></article><article class="metric-card"><small>可升级到</small><strong>'+esc(v.latestVersion||'—')+'</strong><span>来源：WinGet 官方软件源</span></article></div>'+
    '<div class="notice neutral"><i class="markdot"></i><div><strong>升级会更新本机 Claude Code</strong>　请先保存工作。安装后建议重启 Claude Code 会话，让新版本生效。检查更新只读取 WinGet 版本信息；只有你点击“升级”并再次确认时才会安装。</div></div>'+
    '<div class="form-actions"><button class="btn dark" id="checkClaudeUpdate">检查更新</button><button class="btn" id="upgradeClaudeCode" '+(v.updateAvailable&&v.canUpdate?'':'disabled')+'>升级 Claude Code</button><a class="tool-link" href="https://code.claude.com/docs/en/changelog" target="_blank" rel="noopener">查看官方更新说明</a></div>'+
    (v.message?'<div class="status-row">'+esc(v.message)+'</div>':'')+
    (v.upgradedAt?'<div class="status-row">上次升级完成：'+esc(displayDateTime(v.upgradedAt))+' · '+esc(v.message||'')+'</div>':'')+
    '<div class="section-label"><h2>插件版本</h2><span>'+((pageState.data.plugins||[]).length)+' 个已安装</span></div><div class="status-row">各插件当前版本可在插件页查看。插件升级与 Claude Code 升级分开管理，不会随本页操作一起升级。</div><button class="btn flat" id="openPluginVersions">查看插件版本</button>';
}
export function wireVersions(){
  document.querySelector('#checkClaudeUpdate')?.addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;b.textContent='检查中…';try{pageState.data.claudeVersion=await post('/api/updates/check',{});render();toast(pageState.data.claudeVersion.updateAvailable?'发现新版本 '+pageState.data.claudeVersion.latestVersion:'当前已是最新版本')}catch(err){b.disabled=false;b.textContent='检查失败';toast(err.message)}});
  document.querySelector('#upgradeClaudeCode')?.addEventListener('click',async e=>{const b=e.currentTarget,v=pageState.data.claudeVersion;if(!confirm('确认通过 WinGet 将 Claude Code 从 '+v.version+' 升级到 '+v.latestVersion+'？请先保存正在进行的工作。'))return;b.disabled=true;b.textContent='升级中…';try{pageState.data.claudeVersion=await post('/api/updates/upgrade',{});pageState.data=await (await fetch('/api/state')).json();render();toast(pageState.data.claudeVersion.message||'升级完成')}catch(err){b.disabled=false;b.textContent='升级失败';toast(err.message)}});
  document.querySelector('#openPluginVersions')?.addEventListener('click',()=>setPage('plugins'));
}
