import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeInheritedEnv } from '../server/terminal/sessions.mjs';

test('剥离 Claude Code 会话标记，保留业务环境变量', () => {
  const clean = sanitizeInheritedEnv({
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDECODE: '1',
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CODE_SSE_PORT: '12345',
    PATH: 'C:\\bin',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721',
  });
  assert.equal(clean.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(clean.CLAUDECODE, undefined);
  assert.equal(clean.CLAUDE_CODE_ENTRYPOINT, undefined);
  assert.equal(clean.CLAUDE_CODE_SSE_PORT, undefined);
  assert.equal(clean.PATH, 'C:\\bin');
  assert.equal(clean.ANTHROPIC_BASE_URL, 'http://127.0.0.1:15721');
});

test('不修改传入的环境对象本身', () => {
  const original = { CLAUDECODE: '1', PATH: 'x' };
  sanitizeInheritedEnv(original);
  assert.equal(original.CLAUDECODE, '1');
});
