import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { statuslineStore, recordStatusline, statuslineByCwd } from '../server/statusline/store.mjs';
import { resolveStatuslineForSession, gitBranch, collectEnabled } from '../server/statusline/state.mjs';

/** 计算相对当前树的绝对路径，便于在不同机器构造 git 仓库 */
function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('resolveStatuslineForSession 按 CLI sessionId 精确匹配', () => {
  statuslineStore.clear();
  recordStatusline({ session_id: 'cli-1', model: { display_name: 'glm-5.3-flash' } });
  const result = resolveStatuslineForSession({ id: 'wb-1', sessionId: 'cli-1', projectPath: 'E:\\proj' });
  assert.equal(result.matchedBy, 'session');
  assert.equal(result.status.model.display_name, 'glm-5.3-flash');
});

test('resolveStatuslineForSession 无 sessionId 时按项目目录兜底', () => {
  statuslineStore.clear();
  recordStatusline({ session_id: 'cli-2', workspace: { current_dir: 'E:\\proj-a' } });
  const result = resolveStatuslineForSession({ id: 'wb-2', sessionId: '', projectPath: 'e:\\PROJ-a' });
  assert.equal(result.matchedBy, 'cwd');
  assert.equal(result.status.session_id, 'cli-2');
});

test('resolveStatuslineForSession 两级都无匹配时返回占位', () => {
  statuslineStore.clear();
  const result = resolveStatuslineForSession({ id: 'wb-3', sessionId: '', projectPath: 'E:\\nothing' });
  assert.equal(result.matchedBy, null);
  assert.equal(result.status, null);
});

test('resolveStatuslineForSession 合并 enrich 与 git 分支', () => {
  statuslineStore.clear();
  const project = tmpDir('statusline-git-');
  execFileSync('git', ['init', '-b', 'main'], { cwd: project });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: project });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: project });
  recordStatusline({
    session_id: 'cli-3',
    model: { display_name: 'm' },
    context_window: { used_percentage: 30 },
    cost: { total_cost_usd: 0.25 },
  });
  const result = resolveStatuslineForSession({ id: 'wb-4', sessionId: 'cli-3', projectPath: project });
  assert.equal(result.status.context.usedPercentage, 30);
  assert.equal(result.status.cost, 0.25);
  assert.equal(result.status.gitBranch, 'main');
  fs.rmSync(project, { recursive: true, force: true });
});

test('git 分支以转发数据中的 CLI 工作目录为准，而非工作台项目目录', () => {
  statuslineStore.clear();
  const cliDir = tmpDir('statusline-cli-git-');
  execFileSync('git', ['init', '-b', 'worktree-branch'], { cwd: cliDir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: cliDir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: cliDir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: cliDir });
  // 工作台项目目录是另一个普通目录（无 git）
  const workbenchProject = tmpDir('statusline-workbench-');
  recordStatusline({
    session_id: 'cli-4',
    workspace: { current_dir: cliDir },
  });
  const result = resolveStatuslineForSession({ id: 'wb-5', sessionId: 'cli-4', projectPath: workbenchProject });
  assert.equal(result.status.gitBranch, 'worktree-branch');
  fs.rmSync(cliDir, { recursive: true, force: true });
  fs.rmSync(workbenchProject, { recursive: true, force: true });
});

test('gitBranch 非 git 目录返回 undefined', () => {
  const plain = tmpDir('statusline-plain-');
  assert.equal(gitBranch(plain), undefined);
  fs.rmSync(plain, { recursive: true, force: true });
});

test('gitBranch detached HEAD 回退短 SHA', () => {
  const repo = tmpDir('statusline-detached-');
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repo });
  execFileSync('git', ['checkout', '--detach'], { cwd: repo });
  const branch = gitBranch(repo);
  assert.match(branch, /^[0-9a-f]{7,}$/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('collectEnabled 依据备份、wrapper 副本与 settings 指向三重自检', () => {
  const home = tmpDir('statusline-enabled-');
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const paths = {
    settingsFile: path.join(claudeDir, 'settings.json'),
    backupFile: path.join(claudeDir, 'workbench-statusline.json'),
    wrapperCopy: path.join(claudeDir, 'workbench-statusline-wrapper.mjs'),
  };
  // 无备份：未启用
  assert.equal(collectEnabled(paths), false);
  // 备份启用但 wrapper 缺失：自检失败视为未启用
  fs.writeFileSync(paths.backupFile, JSON.stringify({ enabled: true, originalCommand: 'x' }));
  assert.equal(collectEnabled(paths), false);
  // wrapper 副本存在但 settings 未指向包装器（用户手动删了 statusLine）：未启用
  fs.writeFileSync(paths.wrapperCopy, '// wrapper');
  fs.writeFileSync(paths.settingsFile, JSON.stringify({}));
  assert.equal(collectEnabled(paths), false);
  // settings 指向包装器：启用
  fs.writeFileSync(paths.settingsFile, JSON.stringify({ statusLine: { command: 'node "C:\\x\\workbench-statusline-wrapper.mjs"' } }));
  assert.equal(collectEnabled(paths), true);
  fs.rmSync(home, { recursive: true, force: true });
});
