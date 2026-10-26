import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { enableStatusline, disableStatusline } from '../server/statusline/toggle.mjs';

/** 在临时目录组装 settings/备份/包装器路径；返回 paths 对象与读取工具 */
function createEnv(settings) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-toggle-'));
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsFile = path.join(claudeDir, 'settings.json');
  if (settings !== null) fs.writeFileSync(settingsFile, JSON.stringify(settings));
  const wrapperSource = path.join(home, 'resources', 'statusline-wrapper.mjs');
  fs.mkdirSync(path.dirname(wrapperSource), { recursive: true });
  fs.writeFileSync(wrapperSource, '// fake wrapper');
  return {
    home,
    paths: {
      settingsFile,
      backupFile: path.join(claudeDir, 'workbench-statusline.json'),
      wrapperSource,
      wrapperCopy: path.join(claudeDir, 'workbench-statusline-wrapper.mjs'),
      wrapperConfig: path.join(claudeDir, 'workbench-statusline-wrapper.json'),
    },
    readSettings: () => JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

const ORIGINAL = 'node /c/Users/huo/.claude/plugins/cache/claude-hud/0.8.0/dist/index.js';

test('启用：备份原命令并替换 statusLine.command 为包装器', () => {
  const env = createEnv({ statusLine: { type: 'command', command: ORIGINAL } });
  const result = enableStatusline({ port: 4173, paths: env.paths });
  assert.equal(result.enabled, true);
  const settings = env.readSettings();
  assert.match(settings.statusLine.command, /workbench-statusline-wrapper\.mjs/);
  assert.ok(fs.existsSync(env.paths.wrapperCopy), 'wrapper 副本应复制到用户目录');
  const backup = JSON.parse(fs.readFileSync(env.paths.backupFile, 'utf8'));
  assert.equal(backup.originalCommand, ORIGINAL);
  assert.equal(backup.enabled, true);
  assert.equal(backup.port, 4173);
  const config = JSON.parse(fs.readFileSync(env.paths.wrapperConfig, 'utf8'));
  assert.equal(config.command, ORIGINAL);
  env.cleanup();
});

test('重复启用不覆盖已有备份且保持幂等', () => {
  const env = createEnv({ statusLine: { type: 'command', command: ORIGINAL } });
  enableStatusline({ port: 4173, paths: env.paths });
  // 第二次启用走"已启用"幂等分支
  const again = enableStatusline({ port: 4173, paths: env.paths });
  assert.equal(again.enabled, true);
  const backup = JSON.parse(fs.readFileSync(env.paths.backupFile, 'utf8'));
  assert.equal(backup.originalCommand, ORIGINAL);
  env.cleanup();
});

test('禁用：按备份恢复原命令并标记未启用', () => {
  const env = createEnv({ statusLine: { type: 'command', command: ORIGINAL } });
  enableStatusline({ port: 4173, paths: env.paths });
  const result = disableStatusline({ paths: env.paths });
  assert.equal(result.enabled, false);
  assert.equal(env.readSettings().statusLine.command, ORIGINAL);
  const backup = JSON.parse(fs.readFileSync(env.paths.backupFile, 'utf8'));
  assert.equal(backup.enabled, false);
  env.cleanup();
});

test('原本没有 statusLine 时启用会附带提示', () => {
  const env = createEnv({ model: 'x' });
  const result = enableStatusline({ port: 4173, paths: env.paths });
  assert.equal(result.enabled, true);
  assert.match(result.warning, /原本没有 statusLine/);
  env.cleanup();
});

test('备份写入失败时 settings 保持不变', () => {
  const env = createEnv({ statusLine: { type: 'command', command: ORIGINAL } });
  // atomicJson 会自动创建父目录，因此用"已存在的同名目录"制造写入失败（EISDIR）
  const blocker = path.join(env.home, 'backup-blocker');
  fs.mkdirSync(blocker, { recursive: true });
  const brokenPaths = { ...env.paths, backupFile: blocker };
  assert.throws(() => enableStatusline({ port: 4173, paths: brokenPaths }), /备份/);
  assert.equal(env.readSettings().statusLine.command, ORIGINAL);
  env.cleanup();
});

test('settings.json 损坏时启用报错且不写任何文件', () => {
  const env = createEnv(null);
  fs.writeFileSync(env.paths.settingsFile, '{broken json');
  assert.throws(() => enableStatusline({ port: 4173, paths: env.paths }), /解析失败/);
  assert.equal(fs.readFileSync(env.paths.settingsFile, 'utf8'), '{broken json');
  assert.equal(fs.existsSync(env.paths.backupFile), false);
  env.cleanup();
});

test('settings.json 损坏时禁用报错且保持文件原样', () => {
  const env = createEnv(null);
  fs.writeFileSync(env.paths.settingsFile, '{"model":"x",{broken');
  fs.writeFileSync(env.paths.backupFile, JSON.stringify({ originalCommand: ORIGINAL, enabled: true }));
  assert.throws(() => disableStatusline({ paths: env.paths }), /解析失败/);
  assert.equal(fs.readFileSync(env.paths.settingsFile, 'utf8'), '{"model":"x",{broken');
  env.cleanup();
});

test('重复启用刷新端口与 wrapper 副本', () => {
  const env = createEnv({ statusLine: { type: 'command', command: ORIGINAL } });
  enableStatusline({ port: 4173, paths: env.paths });
  // 模拟升级后 wrapper 源更新 + 用户删除副本 + 端口变化
  fs.writeFileSync(env.paths.wrapperSource, '// updated wrapper v2');
  fs.rmSync(env.paths.wrapperCopy, { force: true });
  const again = enableStatusline({ port: 5000, paths: env.paths });
  assert.equal(again.enabled, true);
  const config = JSON.parse(fs.readFileSync(env.paths.wrapperConfig, 'utf8'));
  assert.equal(config.port, 5000, 'wrapperConfig 的端口应刷新为最新值');
  assert.equal(config.command, ORIGINAL, '备份的原命令不被覆盖');
  assert.ok(fs.existsSync(env.paths.wrapperCopy), '被删除的 wrapper 副本应重新复制');
  assert.equal(fs.readFileSync(env.paths.wrapperCopy, 'utf8'), '// updated wrapper v2', '副本内容应与最新源一致');
  assert.match(env.readSettings().statusLine.command, /workbench-statusline-wrapper\.mjs/);
  env.cleanup();
});

test('settings 已指向包装器但备份丢失时报 409 引导手动处理', () => {
  const env = createEnv({ statusLine: { type: 'command', command: 'node "C:\\x\\workbench-statusline-wrapper.mjs"' } });
  assert.throws(() => enableStatusline({ port: 4173, paths: env.paths }), /缺少备份记录/);
  env.cleanup();
});

test('用户手动改写 statusLine 后禁用恢复为备份原命令', () => {
  const env = createEnv({ statusLine: { type: 'command', command: ORIGINAL } });
  enableStatusline({ port: 4173, paths: env.paths });
  // 用户手动把 statusLine 改成别的命令
  fs.writeFileSync(env.paths.settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'echo custom' } }));
  const result = disableStatusline({ paths: env.paths });
  assert.equal(result.enabled, false);
  assert.equal(env.readSettings().statusLine.command, ORIGINAL);
  env.cleanup();
});

test('原本没有 statusLine 时也可启用（无需先配置状态栏）', () => {
  const env = createEnv({ model: 'x' });
  const result = enableStatusline({ port: 4173, paths: env.paths });
  assert.equal(result.enabled, true);
  assert.match(env.readSettings().statusLine.command, /workbench-statusline-wrapper\.mjs/);
  const backup = JSON.parse(fs.readFileSync(env.paths.backupFile, 'utf8'));
  assert.equal(backup.originalCommand, '');
  // 禁用后 statusLine 键被移除，恢复"原本没有"的状态
  const disabled = disableStatusline({ paths: env.paths });
  assert.equal(disabled.enabled, false);
  const settings = env.readSettings();
  assert.equal(settings.statusLine, undefined);
  assert.equal(settings.model, 'x');
  env.cleanup();
});
