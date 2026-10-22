import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(root, 'resources', 'workbench');
const relative = path.relative(root, destination);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('Refusing to prepare desktop resources outside the workspace');
}

const dist = path.join(root, 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build the frontend before staging desktop resources');

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(path.join(root, 'server.mjs'), path.join(destination, 'server.mjs'));
fs.mkdirSync(path.join(destination, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'recycle-workspace-item.ps1'), path.join(destination, 'scripts', 'recycle-workspace-item.ps1'));
fs.cpSync(dist, path.join(destination, 'dist'), {
  recursive: true,
  filter: source => !source.endsWith('.map'),
});

function copyPackageFiles(source, target, predicate, base = source) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyPackageFiles(from, to, predicate, base);
      if (fs.existsSync(to) && fs.readdirSync(to).length === 0) fs.rmdirSync(to);
    } else if (predicate(path.relative(base, from), entry.name)) {
      fs.copyFileSync(from, to);
      copiedFiles++;
    }
  }
}

let copiedFiles = 0;
const modules = path.join(root, 'node_modules');
const stagedModules = path.join(destination, 'node_modules');

for (const file of ['package.json', 'index.js', 'wrapper.mjs', 'browser.js']) {
  const from = path.join(modules, 'ws', file);
  if (fs.existsSync(from)) { fs.mkdirSync(path.join(stagedModules, 'ws'), { recursive: true }); fs.copyFileSync(from, path.join(stagedModules, 'ws', file)); copiedFiles++; }
}
copyPackageFiles(path.join(modules, 'ws', 'lib'), path.join(stagedModules, 'ws', 'lib'), (_rel, name) => name.endsWith('.js') && !name.endsWith('.test.js'));

for (const file of ['package.json']) {
  const from = path.join(modules, 'node-pty', file);
  fs.mkdirSync(path.join(stagedModules, 'node-pty'), { recursive: true });
  fs.copyFileSync(from, path.join(stagedModules, 'node-pty', file));
  copiedFiles++;
}
copyPackageFiles(path.join(modules, 'node-pty', 'lib'), path.join(stagedModules, 'node-pty', 'lib'), (_rel, name) => name.endsWith('.js') && !name.endsWith('.test.js'));

const ptyPrebuild = path.join(modules, 'node-pty', 'prebuilds', 'win32-x64');
const stagedPrebuild = path.join(stagedModules, 'node-pty', 'prebuilds', 'win32-x64');
const runtimeFiles = new Set(['conpty.node', 'conpty_console_list.node', 'pty.node', 'winpty-agent.exe', 'winpty.dll']);
copyPackageFiles(ptyPrebuild, stagedPrebuild, (rel, name) => runtimeFiles.has(name) || (rel.startsWith('conpty' + path.sep) && ['OpenConsole.exe', 'conpty.dll'].includes(name)));

// SDK 运行时模块与服务端同目录，server.mjs 通过相对路径导入
fs.copyFileSync(path.join(root, 'sdk-runtime.mjs'), path.join(destination, 'sdk-runtime.mjs'));
copiedFiles++;

// Claude Agent SDK 主包：入口 sdk.mjs 已内联 zod 与 @modelcontextprotocol/sdk（见官方 README），
// 因此无需复制 peer 依赖；仅排除体积较大且运行时不用的 sourcemap 与文档
copyPackageFiles(
  path.join(modules, '@anthropic-ai', 'claude-agent-sdk'),
  path.join(stagedModules, '@anthropic-ai', 'claude-agent-sdk'),
  (_rel, name) => !name.endsWith('.map') && !name.endsWith('.md'),
);

// SDK 通过 require.resolve('@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude.exe') 定位原生 CLI，
// 缺少该平台包时创建会话会报 "Native CLI binary ... not found"，故一并复制 Windows x64 运行时
const sdkPlatformFiles = ['package.json', 'claude.exe'];
for (const file of sdkPlatformFiles) {
  const from = path.join(modules, '@anthropic-ai', 'claude-agent-sdk-win32-x64', file);
  const to = path.join(stagedModules, '@anthropic-ai', 'claude-agent-sdk-win32-x64', file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copiedFiles++;
}

const sizes = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else sizes.push(fs.statSync(target).size);
  }
}
walk(destination);
const total = sizes.reduce((sum, size) => sum + size, 0);
process.stdout.write(`Staged ${sizes.length} files (${(total / 1024 / 1024).toFixed(1)} MB) for the Windows desktop app.\n`);
