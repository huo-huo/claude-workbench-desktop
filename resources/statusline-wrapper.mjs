#!/usr/bin/env node
// statusLine 包装器（接管模式）：Claude Code 每次刷新状态栏时调用本脚本。
// 职责：把 stdin 的原始 JSON 转发给 Claude Workbench 服务端后直接结束——
// 终端内不再渲染原 statusLine（由软件状态栏替代显示，避免内容重复）。
// 任何异常都静默降级，绝不阻塞 Claude Code 本身。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * 读取包装器配置：优先环境变量（测试注入），缺省为用户目录下的
 * workbench-statusline-wrapper.json——该文件由软件在启用时写入，
 * 不依赖软件安装位置（安装目录通常不可写）。
 */
function readConfig() {
  const configPath = process.env.STATUSLINE_WRAPPER_CONFIG
    || path.join(os.homedir(), '.claude', 'workbench-statusline-wrapper.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/** 收集 stdin 全部内容 */
function readStdin() {
  return new Promise(resolve => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', () => resolve(Buffer.alloc(0)));
  });
}

/** 把原始 JSON 转发给软件服务端；fire-and-forget，300ms 超时，失败静默 */
function forward(payload, port) {
  // Node < 18 没有全局 fetch：跳过转发，绝不因此报错
  if (typeof fetch !== 'function') return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  return fetch(`http://127.0.0.1:${port}/api/statusline/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    signal: controller.signal,
  }).catch(() => {}).finally(() => clearTimeout(timer));
}

async function main() {
  const payload = await readStdin();
  const config = readConfig();
  // 接管模式下没有配置也是正常状态：无转发目标则无输出、静默成功
  if (config?.port) forward(payload.toString('utf8'), config.port);
}

main().catch(() => process.exit(0));
