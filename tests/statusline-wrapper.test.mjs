import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WRAPPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'statusline-wrapper.mjs');

/** 以子进程运行包装器；返回 stdout、stderr、退出码与耗时 */
function runWrapper(env, input, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise(resolve => {
    const child = execFile(process.execPath, [WRAPPER], {
      env: { ...process.env, ...env },
      timeout: timeoutMs,
      encoding: 'utf8',
    }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0), elapsed: Date.now() - started });
    });
    child.stdin.end(input);
  });
}

/** 在临时目录写包装器配置（缺省读取 ~/.claude/workbench-statusline-wrapper.json，测试通过环境变量注入）并返回清理句柄 */
async function wrapperEnv(config) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'statusline-wrapper-'));
  const configPath = path.join(home, 'statusline-wrapper.json');
  if (config) fs.writeFileSync(configPath, JSON.stringify(config));
  return { STATUSLINE_WRAPPER_CONFIG: configPath, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('接管模式：配置齐全时转发后立即静默退出', async () => {
  const env = await wrapperEnv({ command: 'echo should-not-run', port: 59999 });
  try {
    const result = await runWrapper(env, '{"session_id":"t1"}', 10000);
    // 接管模式不执行原命令——即使配置里带了 command 也不运行
    assert.equal(result.stdout.trim(), '');
    assert.equal(result.code, 0);
    assert.ok(result.elapsed < 9000, `退出耗时过长：${result.elapsed}ms`);
  } finally {
    env.cleanup();
  }
});

test('接管模式：配置缺失时静默成功退出', async () => {
  const env = await wrapperEnv(null);
  try {
    const result = await runWrapper(env, '{}');
    assert.equal(result.stdout.trim(), '');
    assert.equal(result.code, 0);
  } finally {
    env.cleanup();
  }
});

test('接管模式：配置损坏时静默成功退出', async () => {
  const env = await wrapperEnv(null);
  try {
    fs.writeFileSync(env.STATUSLINE_WRAPPER_CONFIG, '{broken');
    const result = await runWrapper(env, '{}');
    assert.equal(result.stdout.trim(), '');
    assert.equal(result.code, 0);
  } finally {
    env.cleanup();
  }
});

test('服务端不可达时不阻塞、静默退出', async () => {
  // 指向一个几乎必然未监听的端口；转发必须在短超时内静默放弃
  const env = await wrapperEnv({ command: '', port: 59999 });
  try {
    const result = await runWrapper(env, '{}', 10000);
    assert.equal(result.stdout.trim(), '');
    assert.equal(result.code, 0);
    assert.ok(result.elapsed < 9000, `转发降级耗时过长：${result.elapsed}ms`);
  } finally {
    env.cleanup();
  }
});

test('大 payload 不产生未捕获异常或 stderr 泄漏', async () => {
  // 接管模式不 spawn 子进程，大 stdin 只被读入内存后转发（fire-and-forget）
  const env = await wrapperEnv({ command: '', port: 59999 });
  try {
    const bigPayload = JSON.stringify({ session_id: 'big', pad: 'x'.repeat(200 * 1024) });
    const result = await runWrapper(env, bigPayload, 20000);
    assert.equal(result.code, 0);
    assert.ok(!/EPIPE|Error/i.test(result.stderr), `stderr 不应泄漏错误：${result.stderr}`);
  } finally {
    env.cleanup();
  }
});
