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
  app.viewer = { path: filePath, name: '', size: 0, modifiedAt: '', content: '', loading: true };
  renderViewer();
  const url = `/api/workspace/file?projectPath=${encodeURIComponent(app.projectPath)}&path=${encodeURIComponent(filePath)}`;
  try {
    const file = await api(url);
    // 期间用户可能已切换到别的文件，旧结果直接丢弃
    if (app.viewer.path !== filePath) return;
    app.viewer = { path: filePath, name: file.name || '', size: file.size || 0, modifiedAt: file.modifiedAt || '', content: file.content || '', loading: false };
    renderViewer();
  } catch (error) {
    app.viewer = { path: '', name: '', size: 0, modifiedAt: '', content: '', loading: false };
    renderViewer();
    toast(error.message);
  }
}

/** 关闭查看器并把焦点还给终端 */
export function closeViewer() {
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
