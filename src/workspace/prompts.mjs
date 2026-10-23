import { $ } from './core/dom.mjs';
import { api, toast } from './core/api.mjs';
import { app } from './state.mjs';
import { insertComposerText, toggleComposer } from './composer.mjs';

export function setPromptManagerTab(tab) {
  const showLibrary = tab === 'library';
  $('#promptRefinePanel').hidden = showLibrary;
  $('#promptLibraryPanel').hidden = !showLibrary;
  document.querySelectorAll('[data-prompt-tab]').forEach(button => button.classList.toggle('active', button.dataset.promptTab === tab));
}

export function renderPromptLibrary() {
  const count = $('#promptLibraryCount');
  const list = $('#promptLibraryList');
  const select = $('#promptTemplateSelect');
  count.textContent = String(app.promptLibraryItems.length);
  const selectedId = select.value;
  select.replaceChildren(new Option('选择库里的提示词，或直接在下面填写', ''));
  for (const item of app.promptLibraryItems) {
    const option = new Option(item.name, item.id);
    select.append(option);
  }
  if (app.promptLibraryItems.some(item => item.id === selectedId)) select.value = selectedId;
  list.replaceChildren();
  if (!app.promptLibraryItems.length) {
    const empty = document.createElement('div');
    empty.className = 'prompt-library-empty';
    empty.textContent = '提示词库还是空的。整理并保存后，可以在这里一键插入输入框。';
    list.append(empty);
    return;
  }
  for (const item of app.promptLibraryItems) {
    const card = document.createElement('article');
    card.className = 'prompt-library-card';
    const details = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = item.name;
    const summary = document.createElement('p');
    summary.textContent = item.summary || item.prompt.slice(0, 170);
    const updated = document.createElement('small');
    updated.textContent = `更新于 ${item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '未知时间'}`;
    details.append(title, summary, updated);
    const actions = document.createElement('div');
    actions.className = 'prompt-library-card-actions';
    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'btn insert';
    insert.textContent = '插入输入框';
    insert.title = '把提示词放入 CLI 输入框；检查后再发送';
    insert.addEventListener('click', () => insertPromptIntoComposer(item));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => editPromptLibraryItem(item));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn';
    remove.textContent = '删除';
    remove.addEventListener('click', () => deletePromptLibraryItem(item));
    actions.append(insert, edit, remove);
    card.append(details, actions);
    list.append(card);
  }
}

export async function loadPromptLibrary() {
  const result = await api('/api/prompt-library');
  app.promptLibraryItems = Array.isArray(result.prompts) ? result.prompts : [];
  renderPromptLibrary();
}

export function openPromptManager() {
  $('#promptManagerBackdrop').hidden = false;
  setPromptManagerTab('refine');
  const selection = app.terminal?.getSelection()?.trim() || '';
  if (selection && !$('#promptSourceContent').value.trim()) $('#promptSourceContent').value = selection;
  loadPromptLibrary().catch(error => toast(error.message));
  requestAnimationFrame(() => $('#promptSourceContent').focus());
}

export function closePromptManager() {
  $('#promptManagerBackdrop').hidden = true;
}

export function editPromptLibraryItem(item) {
  app.promptEditingId = item.id;
  $('#promptDraftName').value = item.name || '';
  $('#promptDraftSummary').value = item.summary || '';
  $('#promptDraftText').value = item.prompt || '';
  $('#promptEditingState').textContent = `正在编辑：${item.name}`;
  setPromptManagerTab('refine');
  requestAnimationFrame(() => $('#promptDraftName').focus());
}

export function insertPromptIntoComposer(item) {
  if (!app.composerVisible) toggleComposer();
  const current = $('#composerInput').value;
  insertComposerText(`${current.trim() ? '\n\n' : ''}${item.prompt}`);
  closePromptManager();
  toast('提示词已插入输入框；检查后点击“发送到 Claude”');
}

export async function analyzePromptDraft() {
  const content = $('#promptSourceContent').value.trim();
  const instruction = $('#promptSourceInstruction').value.trim();
  if (!content) return toast('先粘贴内容，或从终端取用选中的文字');
  if (!instruction) return toast('先选择一个已有提示词，或填写对应的原始提示词');
  const button = $('#analyzePrompt');
  button.disabled = true;
  button.textContent = '梳理中…';
  $('#promptAnalyzeState').textContent = '正在调用当前渠道的主模型…';
  try {
    const result = await api('/api/prompt-library/refine', {
      method: 'POST',
      body: { content, instruction, name: $('#promptDraftName').value.trim() },
    });
    $('#promptDraftName').value = result.draft?.name || '新提示词';
    $('#promptDraftSummary').value = result.draft?.summary || '';
    $('#promptDraftText').value = result.draft?.prompt || '';
    app.promptEditingId = '';
    $('#promptEditingState').textContent = '请检查并修改上方结果，确认后再保存';
    $('#promptAnalyzeState').textContent = '梳理完成；结果尚未保存';
    toast('提示词已梳理，请检查后保存');
  } catch (error) {
    $('#promptAnalyzeState').textContent = '梳理失败';
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'AI 梳理';
  }
}

export async function savePromptDraft() {
  const button = $('#savePromptDraft');
  button.disabled = true;
  try {
    const result = await api('/api/prompt-library/save', {
      method: 'POST',
      body: {
        id: app.promptEditingId,
        name: $('#promptDraftName').value,
        summary: $('#promptDraftSummary').value,
        prompt: $('#promptDraftText').value,
      },
    });
    app.promptLibraryItems = result.prompts || [];
    const saved = result.item;
    app.promptEditingId = saved.id;
    renderPromptLibrary();
    setPromptManagerTab('library');
    $('#promptAnalyzeState').textContent = '已保存到本机提示词库';
    toast('提示词已保存；可从列表插入当前对话');
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}

export function resetPromptDraft() {
  app.promptEditingId = '';
  $('#promptSourceContent').value = '';
  $('#promptSourceInstruction').value = '';
  $('#promptTemplateSelect').value = '';
  $('#promptDraftName').value = '';
  $('#promptDraftSummary').value = '';
  $('#promptDraftText').value = '';
  $('#promptEditingState').textContent = '';
  $('#promptAnalyzeState').textContent = '使用当前渠道的主模型';
}

export async function deletePromptLibraryItem(item) {
  if (!confirm(`确定从本机提示词库删除“${item.name}”吗？`)) return;
  try {
    const result = await api('/api/prompt-library/delete', { method: 'POST', body: { id: item.id } });
    app.promptLibraryItems = result.prompts || [];
    renderPromptLibrary();
    if (app.promptEditingId === item.id) resetPromptDraft();
    toast('提示词已从本机库中删除');
  } catch (error) { toast(error.message); }
}

