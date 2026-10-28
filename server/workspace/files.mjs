import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAX_IMAGE_UPLOAD } from '../core/paths.mjs';
import { readRawBody } from '../core/http.mjs';
import { safeWorkspaceRoot } from './state.mjs';

// 文件树遍历时跳过的重型目录
const WORKSPACE_SKIP = new Set(['.git', 'node_modules', '.next', '.turbo', 'dist', 'build', 'target', '.venv', 'vendor']);

export function workspacePath(root, requested) {
  const project = safeWorkspaceRoot(root);
  const target = path.resolve(project, String(requested || '.'));
  const relative = path.relative(project, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('不能读取项目文件夹以外的路径');
  let real;
  try { real = fs.realpathSync(target); } catch { throw new Error('文件不存在或无法读取'); }
  const realRelative = path.relative(project, real);
  if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) throw new Error('不能读取项目文件夹以外的路径');
  return { project, real };
}

export function workspaceTree(root, requested = '.', depth = 0, budget = { count: 0 }) {
  const { project, real } = workspacePath(root, requested);
  const stat = fs.statSync(real);
  if (!stat.isDirectory()) return { name: path.basename(real), path: path.relative(project, real), type: 'file', size: stat.size };
  if (depth > 5 || budget.count > 1200) return { name: path.basename(real) || real, path: path.relative(project, real), type: 'folder', children: [] };
  const entries = fs.readdirSync(real, { withFileTypes: true });
  const folders = [], files = [];
  for (const entry of entries) {
    // 只跳过 Office 临时文件；隐藏文件与隐藏文件夹照常展示
    if (entry.isFile() && entry.name.startsWith('~$')) continue;
    if (WORKSPACE_SKIP.has(entry.name.toLowerCase())) continue;
    // 预算耗尽立即停止：避免对超大目录（如 Temp）的剩余条目继续同步 lstat，拖垮单线程服务
    if (budget.count > 1200) break;
    const fullPath = path.join(real, entry.name);
    let childStat;
    try { childStat = fs.lstatSync(fullPath); } catch { continue; }
    if (childStat.isSymbolicLink()) continue;
    const item = { name: entry.name, path: path.relative(project, fullPath), type: childStat.isDirectory() ? 'folder' : 'file' };
    budget.count++;
    if (childStat.isDirectory()) {
      item.children = depth < 3 ? workspaceTree(project, fullPath, depth + 1, budget).children : undefined;
      folders.push(item);
    } else {
      item.size = childStat.size;
      item.extension = path.extname(entry.name).toLowerCase();
      files.push(item);
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { name: path.basename(real) || real, path: path.relative(project, real), type: 'folder', children: [...folders, ...files] };
}

export function workspaceFileInfo(root, requested) {
  const { project, real } = workspacePath(root, requested);
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw new Error('请选择一个文件');
  return { project, real, stat };
}

export function workspaceFileText(root, requested) {
  const { real, stat } = workspaceFileInfo(root, requested);
  if (stat.size > 1024 * 1024) throw new Error('文件超过 1 MB，暂不在工作台内预览');
  const buffer = fs.readFileSync(real);
  if (buffer.includes(0)) throw new Error('这是二进制文件，请用系统应用打开');
  return { name: path.basename(real), path: requested, content: buffer.toString('utf8'), size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export async function saveWorkspaceImageUpload(req) {
  const mime = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  const extension = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' })[mime];
  if (!extension) throw new Error('只支持 PNG、JPG、GIF 和 WebP 图片');
  const data = await readRawBody(req, MAX_IMAGE_UPLOAD);
  if (!data.length) throw new Error('图片内容为空');
  const directory = path.join(os.tmpdir(), 'ClaudeWorkbenchClipboard');
  fs.mkdirSync(directory, { recursive: true });
  const imagePath = path.join(directory, `attachment-${crypto.randomUUID()}${extension}`);
  fs.writeFileSync(imagePath, data, { flag: 'wx' });
  return { imagePath, name: path.basename(imagePath), mime, size: data.length };
}

export function workspaceAsset(root, requested) {
  const { real, stat } = workspaceFileInfo(root, requested);
  if (stat.size > 8 * 1024 * 1024) throw new Error('图片超过 8 MB，暂不预览');
  const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[path.extname(real).toLowerCase()];
  if (!mime) throw new Error('不支持预览此文件类型');
  return { body: fs.readFileSync(real), mime };
}
