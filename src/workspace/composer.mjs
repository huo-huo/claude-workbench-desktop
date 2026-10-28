import { $ } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';
import { fitTerminal, quoteWindowsPath } from './terminal.mjs';

/** 输入框自动高度上限，与样式中的 max-height 保持一致 */
const COMPOSER_MAX_HEIGHT = 180;

/** 按内容调整输入框高度，到上限后在框内滚动 */
export function autoSizeComposer() {
  const input = $('#composerInput');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
}

export function sendComposerToTerminal() {
  const text = $('#composerInput').value;
  const images = app.composerAttachments.map(item => `@${quoteWindowsPath(item.path)}`);
  const message = [text.trim(), images.length ? `${images.length === 1 ? '请分析这张图片：' : '请分析这些图片：'}\n${images.join('\n')}` : ''].filter(Boolean).join('\n\n');
  if (!message) return;
  if (!app.activeSession || app.socket?.readyState !== WebSocket.OPEN || !app.terminal) {
    toast('先新建或继续一段对话，再发送输入内容');
    return;
  }
  app.terminal.paste(message);
  app.socket.send(JSON.stringify({ type: 'input', data: '\r' }));
  $('#composerInput').value = '';
  app.composerAttachments = [];
  renderComposerAttachments();
  autoSizeComposer();
  app.terminal.focus();
  toast('已发送到 Claude Code');
}

export function insertComposerText(value) {
  const input = $('#composerInput');
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.setRangeText(String(value || ''), start, end, 'end');
  input.focus();
  autoSizeComposer();
}

export function renderComposerAttachments() {
  const list = $('#composerAttachments');
  list.replaceChildren();
  list.hidden = app.composerAttachments.length === 0;
  app.composerAttachments.forEach((item, index) => {
    const chip = document.createElement('span');
    chip.className = 'composer-attachment';
    const name = document.createElement('span');
    name.textContent = `▧ ${item.name}`;
    name.title = item.path;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.setAttribute('aria-label', `移除图片 ${item.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      app.composerAttachments.splice(index, 1);
      renderComposerAttachments();
    });
    chip.append(name, remove);
    list.append(chip);
  });
}

export function addComposerImagePath(imagePath, name = '') {
  const path = String(imagePath || '').trim();
  if (!path) return;
  if (app.composerAttachments.some(item => item.path.toLowerCase() === path.toLowerCase())) return;
  const fallbackName = path.split(/[\\/]/).pop() || '图片';
  app.composerAttachments.push({ path, name: name || fallbackName });
  renderComposerAttachments();
}

export async function uploadComposerImage(file) {
  const mime = String(file?.type || '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime)) {
    throw new Error('图片请使用 PNG、JPG、GIF 或 WebP 格式');
  }
  const response = await fetch('/api/workspace/image-upload', {
    method: 'POST',
    headers: { 'Content-Type': mime },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `图片添加失败（${response.status}）`);
  addComposerImagePath(result.imagePath, file.name || result.name);
}

export async function addComposerImageFiles(files) {
  const imageFiles = [...(files || [])].filter(file => String(file.type || '').startsWith('image/'));
  if (!imageFiles.length) return toast('请选择或拖入图片文件');
  for (const file of imageFiles) {
    try { await uploadComposerImage(file); }
    catch (error) { toast(error.message); }
  }
  if (imageFiles.length) $('#composerInput').focus();
}

export async function pasteIntoComposer(event) {
  event.preventDefault();
  const transfer = event.clipboardData;
  const imageFile = [...(transfer?.items || [])]
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .find(Boolean);
  if (imageFile) {
    try { await uploadComposerImage(imageFile); toast('图片已添加；点击“发送到 Claude”发送'); }
    catch (error) { toast(error.message); }
    return;
  }
  const text = transfer?.getData('text/plain') || '';
  if (text) {
    insertComposerText(text);
    return;
  }
  try {
    const payload = await api('/api/workspace/clipboard', { method: 'POST', body: {} });
    if (payload.imagePath) addComposerImagePath(payload.imagePath, '剪贴板图片');
    if (payload.text) insertComposerText(payload.text);
    if (payload.files?.length) insertComposerText(payload.files.map(quoteWindowsPath).join(' '));
    if (!payload.imagePath && !payload.text && !payload.files?.length) toast('剪贴板里没有可粘贴的文字或图片');
    else if (payload.imagePath) toast('图片已添加；点击“发送到 Claude”发送');
  } catch (error) { toast(error.message); }
}

export function handleComposerDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  $('#terminalComposer').classList.remove('is-dragging');
  const transfer = event.dataTransfer;
  if (!transfer) return;
  const internalPath = transfer.getData('application/x-claude-workbench-file');
  if (internalPath) {
    if (/\.(png|jpe?g|gif|webp)$/i.test(internalPath)) addComposerImagePath(internalPath);
    else {
      insertComposerText(quoteWindowsPath(internalPath));
      toast('文件路径已放入输入框；点击“发送到 Claude”发送');
    }
    return;
  }
  const files = [...(transfer.files || [])];
  if (files.length) {
    addComposerImageFiles(files);
    return;
  }
  const uriList = transfer.getData('text/uri-list').split(/\r?\n/).find(value => value && !value.startsWith('#')) || '';
  const plain = transfer.getData('text/plain') || uriList;
  if (/\.(png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(plain)) addComposerImagePath(plain.replace(/^file:\/*/i, '').replaceAll('/', '\\'));
  else if (plain) insertComposerText(plain);
}


export function toggleComposer() {
  app.composerVisible = !app.composerVisible;
  $('#terminalComposer').hidden = !app.composerVisible;
  $('#toggleComposer').setAttribute('aria-expanded', String(app.composerVisible));
  if (app.composerVisible) requestAnimationFrame(() => { autoSizeComposer(); $('#composerInput').focus(); fitTerminal(); });
  else requestAnimationFrame(() => fitTerminal());
}

