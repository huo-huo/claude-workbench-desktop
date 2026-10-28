import { hideWorkspaceProject, listWorkspaceProjects, readWorkspacePreferences, recordWorkspaceProject, safeWorkspaceRoot, writeWorkspacePreferences } from '../workspace/state.mjs';
import { listWorkspaceSessions, removeWorkspaceSession, removeWorkspaceSessionsBatch, renameWorkspaceSession, pinWorkspaceSession, archiveWorkspaceSession } from '../workspace/sessions.mjs';
import { workspaceAsset, workspaceFileText, workspaceTree } from '../workspace/files.mjs';
import { openWorkspaceFile, readWorkspaceClipboard, recycleWorkspaceItem, revealWorkspaceFile, selectWorkspaceFolder } from '../workspace/native.mjs';
import { createWorkspaceSession, workspaceTerminals } from '../terminal/sessions.mjs';
import { sdkRuntime } from '../sdk/bridge.mjs';
import { PORT } from '../core/paths.mjs';
import { handleStatuslineReport } from '../statusline/report.mjs';
import { handleStatuslineState, handleStatuslineSwitch } from '../statusline/state.mjs';
import { enableStatusline, disableStatusline } from '../statusline/toggle.mjs';
import { checkClaudeUpdate, upgradeClaudeCode } from '../platform/claude.mjs';
import { activateChannel, saveChannel } from '../channels/store.mjs';
import { pullChannelModels, pullDraftChannelModels, saveModels, setChannelFallbacks } from '../channels/models.mjs';
import { benchmarkModel, updateModelBenchmarkRun } from '../channels/benchmark.mjs';
import { overview } from '../catalog/metrics.mjs';
import { fileDetail } from '../catalog/detail.mjs';
import { toggleHook } from '../catalog/hooks.mjs';
import { toggleSkill } from '../catalog/skills.mjs';
import { toggleMcp } from '../catalog/mcp.mjs';
import { togglePlugin } from '../catalog/plugins.mjs';
import { analyzeErrors } from '../catalog/errors.mjs';
import { generateCard, generateCardsBatch, translateSkillFile } from '../prompts/cards.mjs';
import { deletePromptLibraryItem, promptLibraryRows, refinePromptLibraryItem, savePromptLibraryItem } from '../prompts/library.mjs';

// GET handler 接收 URL，返回 { status, body, type? }
export const GET_ROUTES = new Map([
  ['/api/workspace/projects', () => ({ status: 200, body: { projects: listWorkspaceProjects() } })],
  ['/api/workspace/preferences', () => ({ status: 200, body: { preferences: readWorkspacePreferences() } })],
  ['/api/workspace/sessions', url => ({ status: 200, body: { sessions: listWorkspaceSessions(url.searchParams.get('projectPath'), { archived: url.searchParams.get('archived') === '1' }) } })],
  ['/api/workspace/files', url => ({ status: 200, body: workspaceTree(safeWorkspaceRoot(url.searchParams.get('projectPath')), url.searchParams.get('path') || '.') })],
  ['/api/workspace/file', url => ({ status: 200, body: workspaceFileText(safeWorkspaceRoot(url.searchParams.get('projectPath')), url.searchParams.get('path')) })],
  ['/api/workspace/asset', url => {
    const asset = workspaceAsset(url.searchParams.get('projectPath'), url.searchParams.get('path'));
    // 图片等二进制资源直接返回原始缓冲与 MIME
    return { status: 200, body: asset.body, type: asset.mime };
  }],
  ['/api/prompt-library', () => ({ status: 200, body: { prompts: promptLibraryRows() } })],
  ['/api/state', async () => ({ status: 200, body: await overview(null) })],
  ['/api/sdk/health', async () => {
    // SDK 可用返回 200，不可用降级为 503；响应体结构由运行时统一定义
    const info = await sdkRuntime.health();
    return { status: info.available ? 200 : 503, body: info };
  }],
  ['/api/channel-models', async url => ({ status: 200, body: await pullChannelModels(url.searchParams.get('id')) })],
  ['/api/detail', url => ({ status: 200, body: fileDetail(url.searchParams.get('id'), null) })],
  ['/api/statusline/state', url => handleStatuslineState(url)],
]);

// POST handler 接收已解析的 body；返回 undefined 表示沿用原有“操作成功后返回 overview”的响应
export const POST_ROUTES = new Map([
  ['/api/sdk/sessions', async body => ({ status: 201, body: await sdkRuntime.createSession(body) })],
  ['/api/sdk/sessions/message', body => ({ status: 202, body: sdkRuntime.send(body.id, body.prompt) })],
  ['/api/sdk/sessions/interrupt', async body => ({ status: 200, body: await sdkRuntime.interrupt(body.id) })],
  ['/api/sdk/sessions/close', async body => ({ status: 200, body: await sdkRuntime.close(body.id) })],
  ['/api/statusline/report', body => handleStatuslineReport(body)],
  ['/api/statusline/switch', body => handleStatuslineSwitch(body)],
  // port 由前端按实际访问端口传入，保证包装器转发到正确的服务实例
  ['/api/statusline/enable', body => enableStatusline({ port: Number(body?.port) || PORT })],
  ['/api/statusline/disable', () => disableStatusline()],
  ['/api/prompt-library/refine', async body => ({ status: 200, body: await refinePromptLibraryItem(body) })],
  ['/api/prompt-library/save', body => ({ status: 200, body: savePromptLibraryItem(body) })],
  ['/api/prompt-library/delete', body => ({ status: 200, body: deletePromptLibraryItem(body) })],
  ['/api/workspace/open-file', body => ({ status: 200, body: openWorkspaceFile(body.projectPath, body.path) })],
  ['/api/workspace/reveal-file', async body => ({ status: 200, body: await revealWorkspaceFile(body.projectPath, body.path) })],
  ['/api/workspace/recycle', async body => ({ status: 200, body: await recycleWorkspaceItem(body.projectPath, body.path) })],
  ['/api/workspace/clipboard', async () => ({ status: 200, body: await readWorkspaceClipboard() })],
  ['/api/workspace/select-folder', () => {
    const selected = selectWorkspaceFolder();
    return { status: 200, body: { projectPath: selected ? recordWorkspaceProject(selected) : '' } };
  }],
  ['/api/workspace/project/hide', body => ({ status: 200, body: hideWorkspaceProject(body.path) })],
  ['/api/workspace/preferences', body => {
    // 非法字段由 normalizePreferences 抛错，路由层统一转成 400
    try {
      return { status: 200, body: { preferences: writeWorkspacePreferences(body) } };
    } catch (error) {
      return { status: 400, body: { error: error.message } };
    }
  }],
  ['/api/workspace/session', body => ({ status: 200, body: createWorkspaceSession(body) })],
  ['/api/workspace/session/remove', body => ({ status: 200, body: removeWorkspaceSession(body.id) })],
  ['/api/workspace/sessions/remove-batch', body => ({ status: 200, body: removeWorkspaceSessionsBatch(body.ids) })],
  ['/api/workspace/session/rename', body => ({ status: 200, body: renameWorkspaceSession(body.id, body.customName) })],
  ['/api/workspace/session/pin', body => ({ status: 200, body: pinWorkspaceSession(body.id, body.pinned !== false) })],
  ['/api/workspace/session/archive', body => ({ status: 200, body: archiveWorkspaceSession(body.id, body.archived !== false) })],
  ['/api/workspace/session/stop', body => {
    const terminal = workspaceTerminals.get(String(body.id || ''));
    if (terminal) terminal.proc.write('\u0003');
    return { status: 200, body: { stopped: Boolean(terminal) } };
  }],
  ['/api/updates/check', async () => ({ status: 200, body: await checkClaudeUpdate() })],
  ['/api/updates/upgrade', async () => ({ status: 200, body: await upgradeClaudeCode() })],
  ['/api/toggle-hook', body => { toggleHook(body, null); }],
  ['/api/toggle-skill', body => { toggleSkill(body, null); }],
  ['/api/toggle-mcp', body => { toggleMcp(body, null); }],
  ['/api/toggle-plugin', body => { togglePlugin(body); }],
  ['/api/set-channel-fallbacks', body => { setChannelFallbacks(body); }],
  ['/api/model-benchmark', async body => ({ status: 200, body: await benchmarkModel(body) })],
  ['/api/model-benchmark-run', body => ({ status: 200, body: updateModelBenchmarkRun(body) })],
  ['/api/channel-models-draft', async body => ({ status: 200, body: await pullDraftChannelModels(body) })],
  ['/api/translate-skill', async body => ({ status: 200, body: await translateSkillFile(body) })],
  ['/api/save-models', body => { saveModels(body); }],
  ['/api/save-channel', body => ({ status: 200, body: saveChannel(body) })],
  ['/api/activate-channel', async body => {
    await activateChannel(body.id);
    return { status: 200, body: await overview(null) };
  }],
  ['/api/generate-card', async body => ({ status: 200, body: await generateCard(body) })],
  ['/api/generate-cards-batch', async body => ({ status: 200, body: await generateCardsBatch(body) })],
  ['/api/analyze-errors', async () => ({ status: 200, body: await analyzeErrors() })],
]);
