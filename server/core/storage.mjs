import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 读取文件修改时间；文件不存在时返回 0，用于判断渠道密钥缓存是否失效 */
export function fileMtimeMs(file) {
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

/** 读取 JSON 文件；文件缺失或内容损坏时返回 fallback，不抛异常 */
export function safeReadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** 原子写入 JSON：先写临时文件再重命名，避免进程中断留下半截文件 */
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

/** 生成短哈希，用于缓存签名 */
export function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
}
