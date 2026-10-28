import { $ } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';

// 可在工作台内预览的文本/代码扩展名；无扩展名交给后端二进制检测兜底
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.log', '.rst',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.xml', '.ini', '.cfg', '.conf', '.env',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.css', '.scss', '.less', '.html', '.htm',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.kt',
  '.sh', '.bash', '.ps1', '.bat', '.sql', '.gitignore', '.dockerignore', '.editorconfig',
]);

/** 判断扩展名是否属于可预览的文本类型 */
export function isPreviewableText(extension) {
  const ext = String(extension || '').toLowerCase();
  if (!ext) return true;
  return TEXT_EXTENSIONS.has(ext);
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

/** 读取并展示文件内容；失败时保持面板关闭并提示后端错误原文 */
export async function openViewer(filePath) {
  if (!app.projectPath) return;
  const seq = ++viewerRequestSeq;
  // 记录发起请求时的项目，用于丢弃切换项目后才返回的结果
  const projectPath = app.projectPath;
  app.viewer = { path: filePath, name: '', size: 0, modifiedAt: '', content: '', loading: true };
  renderViewer();
  const url = `/api/workspace/file?projectPath=${encodeURIComponent(app.projectPath)}&path=${encodeURIComponent(filePath)}`;
  try {
    const file = await api(url);
    // 期间用户可能已打开别的文件（含 A→B→A），非最新请求的结果直接丢弃
    if (seq !== viewerRequestSeq) return;
    // 期间已切换项目，旧项目的结果不得落到新项目上下文
    if (app.projectPath !== projectPath) return;
    app.viewer = { path: filePath, name: file.name || '', size: file.size || 0, modifiedAt: file.modifiedAt || '', content: file.content || '', loading: false };
    renderViewer();
  } catch (error) {
    // 过期请求的失败不得关闭当前面板，也不提示旧文件的错误
    if (seq !== viewerRequestSeq) return;
    // 跨项目的失败同样丢弃，避免在新项目里提示旧项目错误
    if (app.projectPath !== projectPath) return;
    app.viewer = { path: '', name: '', size: 0, modifiedAt: '', content: '', loading: false };
    renderViewer();
    toast(error.message);
  }
}

/** 关闭查看器并把焦点还给终端 */
export function closeViewer() {
  // 递增序号，作废进行中的读取请求，避免其返回后重新渲染并弹出面板
  viewerRequestSeq += 1;
  const wasOpen = Boolean(app.viewer.path);
  app.viewer = { path: '', name: '', size: 0, modifiedAt: '', content: '', loading: false };
  renderViewer();
  if (wasOpen) app.terminal?.focus();
}

/** 按当前状态渲染面板；path 为空时隐藏面板 */
export function renderViewer() {
  const panel = $('#fileViewer');
  if (!panel) return;
  const active = Boolean(app.viewer.path);
  panel.hidden = !active;
  if (!active) return;
  $('#fileViewerName').textContent = app.viewer.name || '正在读取文件…';
  $('#fileViewerPath').textContent = app.viewer.path;
  $('#fileViewerSize').textContent = app.viewer.loading ? '' : formatSize(app.viewer.size);
  $('#fileViewerContent').textContent = app.viewer.loading ? '正在读取文件…' : app.viewer.content;
}
