import { $ } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';
import { saveWorkspaceSettings } from './settings.mjs';
import { renderMarkdown } from './markdown.mjs';

// 可在工作台内预览的文本/代码扩展名；无扩展名交给后端二进制检测兜底
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.log', '.rst',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf', '.env',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.css', '.scss', '.less', '.html', '.htm',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.kt',
  '.sh', '.bash', '.ps1', '.bat', '.sql', '.gitignore', '.dockerignore', '.editorconfig',
]);

// Markdown 渲染模式适用的扩展名
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/** 判断扩展名是否属于可预览的文本类型 */
export function isPreviewableText(extension) {
  const ext = String(extension || '').toLowerCase();
  if (!ext) return true;
  return TEXT_EXTENSIONS.has(ext);
}

/** 判断文件名是否属于 Markdown，可切换渲染视图 */
export function isMarkdownName(name) {
  const fileName = String(name || '').split(/[\\/]/).pop() || '';
  const index = fileName.lastIndexOf('.');
  return index > 0 && MARKDOWN_EXTENSIONS.has(fileName.slice(index).toLowerCase());
}

// 查看器请求序号：每次打开自增，只有最新一次请求的响应/错误允许落地
let viewerRequestSeq = 0;

/** 文件大小展示：KB/MB 保留一位小数 */
function formatSize(size) {
  const bytes = Number(size) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 诊断上报：用原生 fetch 直发后端落桌面壳日志，避免与 api() 的错误处理互相纠缠 */
export function reportViewerDiag(event, detail) {
  try {
    fetch('/api/workspace/diagnostic-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...detail }),
    }).catch(() => { /* 诊断失败不影响主流程 */ });
  } catch { /* 忽略 */ }
}

/** 读取并展示文件内容；失败时保持面板关闭并提示后端错误原文 */
export async function openViewer(filePath) {
  if (!app.projectPath) {
    reportViewerDiag('blocked-no-project', { filePath });
    return;
  }
  // 同一文件读取中重复双击直接忽略，避免请求在后端排队堆积
  if (app.viewer.loading && app.viewer.path === filePath) {
    reportViewerDiag('blocked-loading', { filePath });
    return;
  }
  const seq = ++viewerRequestSeq;
  // 记录发起请求时的项目，用于丢弃切换项目后才返回的结果
  const projectPath = app.projectPath;
  // Markdown 默认展示渲染视图，可随时切回源码；其余文本固定源码视图
  app.viewer = { path: filePath, name: '', size: 0, modifiedAt: '', content: '', loading: true, render: 'source' };
  renderViewer();
  reportViewerDiag('start', { filePath, projectPath });
  const url = `/api/workspace/file?projectPath=${encodeURIComponent(app.projectPath)}&path=${encodeURIComponent(filePath)}`;
  try {
    const file = await api(url);
    // 期间用户可能已打开别的文件（含 A→B→A），非最新请求的结果直接丢弃
    if (seq !== viewerRequestSeq) { reportViewerDiag('dropped-stale', { filePath }); return; }
    // 期间已切换项目，旧项目的结果不得落到新项目上下文
    if (app.projectPath !== projectPath) { reportViewerDiag('dropped-project-switch', { filePath }); return; }
    const render = isMarkdownName(file.name) ? 'rendered' : 'source';
    app.viewer = { path: filePath, name: file.name || '', size: file.size || 0, modifiedAt: file.modifiedAt || '', content: file.content || '', loading: false, render };
    renderViewer();
    reportViewerDiag('done', { filePath, bytes: (file.content || '').length });
  } catch (error) {
    // 过期请求的失败不得关闭当前面板，也不提示旧文件的错误
    if (seq !== viewerRequestSeq) { reportViewerDiag('dropped-stale-error', { filePath }); return; }
    // 跨项目的失败同样丢弃，避免在新项目里提示旧项目错误
    if (app.projectPath !== projectPath) { reportViewerDiag('dropped-project-switch-error', { filePath }); return; }
    app.viewer = { path: '', name: '', size: 0, modifiedAt: '', content: '', loading: false, render: 'source' };
    renderViewer();
    toast(error.message);
    reportViewerDiag('error', { filePath, message: error.message });
  }
}

/** 关闭查看器并把焦点还给终端 */
export function closeViewer() {
  // 递增序号，作废进行中的读取请求，避免其返回后重新渲染并弹出面板
  viewerRequestSeq += 1;
  const wasOpen = Boolean(app.viewer.path);
  app.viewer = { path: '', name: '', size: 0, modifiedAt: '', content: '', loading: false, render: 'source' };
  renderViewer();
  if (wasOpen) app.terminal?.focus();
}

/** 切换长行自动换行；偏好随工作区设置持久化 */
export function toggleViewerWrap() {
  app.viewerWrap = !app.viewerWrap;
  saveWorkspaceSettings({ viewerWrap: app.viewerWrap });
  renderViewer();
}

/** Markdown 文件在渲染视图与源码视图之间切换 */
export function toggleViewerRender() {
  if (!app.viewer.path || app.viewer.loading) return;
  app.viewer.render = app.viewer.render === 'rendered' ? 'source' : 'rendered';
  renderViewer();
}

/** 按当前状态渲染面板；path 为空时隐藏面板 */
export function renderViewer() {
  const panel = $('#fileViewer');
  if (!panel) return;
  const active = Boolean(app.viewer.path);
  panel.hidden = !active;
  if (!active) return;
  $('#fileViewerName').textContent = app.viewer.loading ? '正在读取文件…' : (app.viewer.name || '文件');
  $('#fileViewerPath').textContent = app.viewer.path;
  $('#fileViewerSize').textContent = app.viewer.loading ? '' : formatSize(app.viewer.size);
  // 自动换行按钮：作用于源码视图；按下状态跟随持久化偏好
  const wrapButton = $('#toggleFileViewerWrap');
  wrapButton.setAttribute('aria-pressed', String(Boolean(app.viewerWrap)));
  // 渲染切换按钮：仅 Markdown 文件展示；按钮文案指向切换后的视图
  const renderButton = $('#toggleFileViewerRender');
  const markdown = !app.viewer.loading && isMarkdownName(app.viewer.name);
  renderButton.hidden = !markdown;
  if (markdown) {
    const rendered = app.viewer.render !== 'source';
    renderButton.textContent = rendered ? '源码' : '渲染';
    renderButton.setAttribute('aria-pressed', String(rendered));
    renderButton.title = rendered ? '查看 Markdown 源码' : '渲染 Markdown 排版';
  }
  const source = $('#fileViewerContent');
  const rendered = $('#fileViewerRendered');
  if (app.viewer.loading) {
    source.hidden = false;
    source.classList.toggle('wrap', Boolean(app.viewerWrap));
    source.textContent = '正在读取文件…';
    rendered.hidden = true;
    rendered.innerHTML = '';
  } else if (app.viewer.render !== 'source') {
    source.hidden = true;
    source.textContent = '';
    rendered.hidden = false;
    rendered.innerHTML = renderMarkdown(app.viewer.content);
  } else {
    source.hidden = false;
    source.classList.toggle('wrap', Boolean(app.viewerWrap));
    source.textContent = app.viewer.content;
    rendered.hidden = true;
    rendered.innerHTML = '';
  }
  reportViewerRenderState(panel);
}

/** 视觉快照上报：记录面板位置尺寸与遮挡物，远程定位"数据成功但看不见"类渲染差异 */
function reportViewerRenderState(panel) {
  try {
    requestAnimationFrame(() => {
      const rect = panel.getBoundingClientRect();
      const probeX = rect.left + rect.width / 2;
      const probeY = rect.top + Math.min(40, rect.height / 2);
      const top = probeY > 0 ? document.elementFromPoint(probeX, probeY) : null;
      // 网格行定义与各行实际高度：定位 1fr 终端行被其他行挤压的塌陷场景
      const column = panel.closest('.terminal-column');
      const rows = column ? getComputedStyle(column).gridTemplateRows : '';
      const rowHeights = column
        ? [...column.children].map(child => `${child.tagName}#${child.id || ''}.${String(child.className).split(' ')[0] || ''}:${Math.round(child.getBoundingClientRect().height)}`).join(' | ')
        : '';
      reportViewerDiag('rendered', {
        hidden: panel.hidden,
        rect: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        viewport: `${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio}`,
        display: getComputedStyle(panel).display,
        cover: top === panel || panel.contains(top) ? 'none' : (top ? `${top.tagName}#${top.id || ''}.${String(top.className).slice(0, 50)}` : 'outside-viewport'),
        rows,
        rowHeights: rowHeights.slice(0, 400),
      });
    });
  } catch { /* 快照失败不影响主流程 */ }
}
