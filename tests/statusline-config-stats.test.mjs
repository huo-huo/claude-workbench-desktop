import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectConfigStats } from '../server/statusline/config-stats.mjs';

/** 构造临时目录树；返回根目录 */
function scaffold(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-stats-'));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

test('统计全局与项目的 CLAUDE.md、规则、钩子与 MCP', () => {
  const home = scaffold({
    '.claude/CLAUDE.md': '# 全局',
    '.claude/settings.json': { hooks: { SessionStart: [{}], PreToolUse: [{}] }, mcpServers: { codegraph: {}, dbx: {} } },
    '.claude/rules/a.md': 'r1',
    '.claude/rules/sub/b.md': 'r2',
    '.claude/skills/comet-classic/SKILL.md': '---\nname: comet-classic\n---',
  });
  const project = scaffold({
    'CLAUDE.md': '# 项目',
    '.mcp.json': { mcpServers: { dbx: {}, extra: {} } },
  });
  const stats = collectConfigStats(project, {
    claudeDir: path.join(home, '.claude'),
    claudeJson: path.join(home, '.claude.json'),
  });
  // 全局 1 + 项目 1
  assert.equal(stats.claudeMd.count, 2);
  // 递归两条规则
  assert.equal(stats.rules.count, 2);
  // 全局 2 个事件类型 + 项目无
  assert.equal(stats.hooks.count, 2);
  assert.deepEqual(stats.hooks.names, ['PreToolUse', 'SessionStart']);
  // MCP 去重：codegraph、dbx（全局与项目重复）、extra
  assert.equal(stats.mcp.count, 3);
  assert.deepEqual([...stats.mcp.names].sort(), ['codegraph', 'dbx', 'extra']);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

test('配置缺失时各项为零', () => {
  const home = scaffold({});
  const project = scaffold({});
  const stats = collectConfigStats(project, {
    claudeDir: path.join(home, '.claude'),
    claudeJson: path.join(home, '.claude.json'),
  });
  assert.equal(stats.claudeMd.count, 0);
  assert.equal(stats.rules.count, 0);
  assert.equal(stats.hooks.count, 0);
  assert.equal(stats.mcp.count, 0);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

test('损坏的 JSON 配置不抛错按缺失处理', () => {
  const home = scaffold({ '.claude/settings.json': '{broken' });
  const project = scaffold({ '.mcp.json': '{broken' });
  const stats = collectConfigStats(project, {
    claudeDir: path.join(home, '.claude'),
    claudeJson: path.join(home, '.claude.json'),
  });
  assert.equal(stats.hooks.count, 0);
  assert.equal(stats.mcp.count, 0);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});
