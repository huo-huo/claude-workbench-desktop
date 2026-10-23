// 管理页 DOM 基础工具：HTML 转义、Toast、时间格式化、POST 请求与模型名显示（自 index.html 内联脚本逐字迁移）
import { getToastTimer, setToastTimer } from '../state.mjs';

// 当前项目标识占位（原内联脚本顶层定义，供 actions/translate 的请求参数使用）
export const activeProject=()=>'';

const modelLabels={
  'deepseek-v4-flash-0731-oc':'DeepSeek V4 Flash 0731','deepseek-v4-pro-0813-oc':'DeepSeek V4 Pro 0813',
  'qwen-3.6-flash-oc':'Qwen 3.6 Flash','kimi-k3-oc':'Kimi K3','glm-5.1-oc':'GLM 5.1'
};
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const labelModel=id=>modelLabels[id]||id||'未设置';
export function toast(message){const el=document.querySelector('#toast');el.textContent=message;el.classList.add('show');clearTimeout(getToastTimer());setToastTimer(setTimeout(()=>el.classList.remove('show'),3000))}
window.workbenchToast=toast;
export function displayTime(value){try{return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value))}catch{return value}}
export function displayDateTime(value){try{return new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))}catch{return value||'未知'}}
export async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw new Error(result.error||'保存失败');return result}
