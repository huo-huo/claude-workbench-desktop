import fs from 'node:fs';

/** 读取文件末尾若干行；用于会话日志等大文件的轻量扫描 */
export function tailLines(file, maxBytes = 2 * 1024 * 1024, maxLines = 1200) {
  const stat = fs.statSync(file);
  const size = Math.min(stat.size, maxBytes);
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, stat.size - size);
    return buffer.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } finally { fs.closeSync(fd); }
}
