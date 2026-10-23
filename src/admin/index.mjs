// 管理页入口：状态加载、页面切换、渲染循环与全局事件绑定（自 index.html 内联脚本逐字迁移）
import { state } from './state.mjs';
import { esc, toast, displayTime } from './core/dom.mjs';
import { pageInfo, dashboardPage } from './pages/dashboard.mjs';
import { channelModelPage, wireChannels } from './pages/models.mjs';
import { hookCardsPage } from './pages/hooks.mjs';
import { skillCardsPage } from './pages/skills.mjs';
import { mcpCardsPage } from './pages/mcp.mjs';
import { pluginCardsPage } from './pages/plugins.mjs';
import { versionPage, wireVersions } from './pages/versions.mjs';
import { errorPage } from './pages/errors.mjs';
import { diagnosisPage, wireDiagnosis } from './pages/diagnosis.mjs';
import { wireFilters, wireToggles, wireDetails, wireCards } from './common/actions.mjs';

const page=document.querySelector('#page');
export async function loadState(keepPosition=false){
  const scrollY=keepPosition?window.scrollY:0;
  const r=await fetch('/api/state');if(!r.ok)throw new Error('读取失败');state.data=await r.json();
  document.querySelector('#scanTime').textContent='扫描 '+displayTime(state.data.scanAt);
  document.querySelector('#hooksCount').textContent=state.data.counts.hooks;
  document.querySelector('#skillsCount').textContent=state.data.counts.personalSkills||state.data.counts.skills;
  document.querySelector('#mcpCount').textContent=state.data.counts.mcp;document.querySelector('#pluginsCount').textContent=(state.data.plugins||[]).length;
  document.querySelector('#errorsCount').textContent=state.data.counts.errors;
  render();if(keepPosition)window.scrollTo(0,scrollY);
}
export function setPage(name){state.currentPage=name;document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===name));document.querySelector('#crumb').textContent=pageInfo[name][0];state.query='';state.listPage=0;render()}
window.setWorkbenchPage=setPage;
export function render(){if(!state.data)return;const renderers={dashboard:dashboardPage,models:channelModelPage,hooks:hookCardsPage,skills:skillCardsPage,mcp:mcpCardsPage,plugins:pluginCardsPage,versions:versionPage,errors:errorPage,diagnosis:diagnosisPage};page.innerHTML=renderers[state.currentPage]();wireFilters();wireToggles();wireDetails();wireCards();if(state.currentPage==='models')wireChannels();if(state.currentPage==='diagnosis')wireDiagnosis();if(state.currentPage==='versions')wireVersions()}
document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>{state.statusFilter='all';setPage(b.dataset.page)});
document.querySelector('#refresh').onclick=()=>loadState().then(()=>toast('已重新扫描')).catch(e=>toast(e.message));
document.querySelector('#drawerClose').onclick=()=>document.querySelector('#drawerBackdrop').classList.remove('open');
document.querySelector('#drawerBackdrop').onclick=e=>{if(e.target.id==='drawerBackdrop')e.currentTarget.classList.remove('open')};
loadState().catch(e=>{page.innerHTML=`<div class="loading">无法读取 Claude Code 配置：${esc(e.message)}<br><br>请用 node server.mjs 启动本地工作台。</div>`});
setInterval(()=>{const active=document.activeElement;if(document.hidden||state.channelFormVisible||document.querySelector('#drawerBackdrop')?.classList.contains('open')||active?.matches?.('input,textarea,select'))return;loadState(true).catch(()=>{})},60000);
