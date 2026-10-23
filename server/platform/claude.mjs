import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { CLAUDE_WINGET_ID } from '../core/paths.mjs';
import { redacted } from '../core/redact.mjs';

// 安装信息与更新检查缓存；updateCheckCache 通过 ESM live binding 供 overview 读取
export let updateCheckCache = null;
let claudeInfoCache = null;

export function claudeInstallInfo() {
  const where = spawnSync('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const candidates = String(where.stdout || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  // node-pty 只能直接启动可执行文件；npm 安装的 claude.cmd 只是转调包内的 bin\claude.exe
  const executable = candidates.find(x => /claude\.exe$/i.test(x))
    || candidates.filter(x => /claude\.(cmd|bat)$/i.test(x))
      .map(x => path.join(path.dirname(x), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'))
      .find(x => fs.existsSync(x))
    || '';
  if (claudeInfoCache?.executable === executable && executable) return claudeInfoCache;
  let version = '';
  if (executable) {
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    version = `${result.stdout || ''}\n${result.stderr || ''}`.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b/)?.[1] || '';
  }
  const wingetInstall = /\\WinGet\\Packages\\Anthropic\.ClaudeCode_/i.test(executable);
  claudeInfoCache = { executable, version, installMethod: wingetInstall ? 'WinGet' : executable ? '其他/未知' : '未找到 claude.exe', canUpdate: wingetInstall };
  return claudeInfoCache;
}

export function compareVersions(a, b) {
  const left = String(a || '').match(/\d+/g)?.map(Number) || [];
  const right = String(b || '').match(/\d+/g)?.map(Number) || [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const delta = (left[i] || 0) - (right[i] || 0);
    if (delta) return Math.sign(delta);
  }
  return 0;
}

export function runProcess(command, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', finished = false;
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { if (!finished) child.kill(); }, timeoutMs);
    child.stdout.on('data', chunk => { if (stdout.length < 256_000) stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { if (stderr.length < 256_000) stderr += chunk.toString(); });
    child.on('error', error => { finished = true; clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      finished = true; clearTimeout(timer);
      if (signal === 'SIGTERM' && code === null) reject(new Error('命令执行超时'));
      else resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function checkClaudeUpdate() {
  const installed = claudeInstallInfo();
  if (!installed.canUpdate) {
    updateCheckCache = { installedVersion: installed.version, latestVersion: '', updateAvailable: false, installMethod: installed.installMethod, checkedAt: new Date().toISOString(), message: '当前安装方式暂不支持工作台自动检查；请通过原安装渠道检查更新。' };
    return updateCheckCache;
  }
  const result = await runProcess('winget.exe', ['show', '--id', CLAUDE_WINGET_ID, '--exact', '--source', 'winget', '--accept-source-agreements'], 90000);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) throw new Error('WinGet 检查更新失败：' + redacted(output.trim().slice(-700)));
  const latestVersion = output.match(/^\s*Version:\s*([^\s]+)/mi)?.[1] || '';
  if (!latestVersion) throw new Error('WinGet 没有返回可识别的最新版本号');
  updateCheckCache = { installedVersion: installed.version, latestVersion, updateAvailable: compareVersions(latestVersion, installed.version) > 0, installMethod: installed.installMethod, checkedAt: new Date().toISOString(), message: '' };
  return updateCheckCache;
}

export async function upgradeClaudeCode() {
  const installed = claudeInstallInfo();
  if (!installed.canUpdate) throw new Error('当前安装方式不是 WinGet；为避免覆盖其他安装方式，请从原渠道升级。');
  const checkedAt = Date.parse(updateCheckCache?.checkedAt || '');
  if (!Number.isFinite(checkedAt) || Date.now() - checkedAt > 30 * 60 * 1000 || updateCheckCache.installedVersion !== installed.version) await checkClaudeUpdate();
  if (!updateCheckCache.updateAvailable) throw new Error('当前没有可用的新版本。');
  const result = await runProcess('winget.exe', ['upgrade', '--id', CLAUDE_WINGET_ID, '--exact', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements', '--silent'], 15 * 60 * 1000);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) throw new Error('WinGet 升级失败：' + redacted(output.trim().slice(-900)));
  claudeInfoCache = null;
  const after = claudeInstallInfo();
  updateCheckCache = { ...updateCheckCache, installedVersion: after.version, updateAvailable: compareVersions(updateCheckCache.latestVersion, after.version) > 0, upgradedAt: new Date().toISOString(), message: '升级命令已完成；重启 Claude Code 后加载新版本。' };
  return { ...updateCheckCache, output: redacted(output.trim().slice(-1800)) };
}
