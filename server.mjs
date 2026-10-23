import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PORT } from './server/core/paths.mjs';
import { createRequestHandler, createUpgradeHandler } from './server/routes/index.mjs';
import { workspaceTerminals } from './server/terminal/sessions.mjs';
import { sdkRuntime } from './server/sdk/bridge.mjs';

/** 创建 HTTP 服务与 WebSocket 升级处理；测试可自行监听随机端口 */
export function createServer() {
  const server = http.createServer(createRequestHandler());
  server.on('upgrade', createUpgradeHandler());
  return server;
}

/** 以本机地址监听指定端口 */
export function startServer(port = PORT) {
  const server = createServer();
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    process.stdout.write(`Claude Workbench: http://127.0.0.1:${address.port}\n`);
  });
  return server;
}

// 作为入口直接运行时才监听端口，测试导入本模块不会产生副作用
function isDirectEntry() {
  if (!process.argv[1]) return false;
  try {
    // Node 对入口取 realpath，argv[1] 保留传入路径；两侧归一后再比较，兼容 junction 与符号链接
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const isEntry = isDirectEntry();

if (isEntry) {
  const server = startServer();

  /** 是否已开始优雅退出；重复信号直接退出进程 */
  let sdkShuttingDown = false;

  /**
   * 优雅退出：先关闭全部 SDK 会话，再关闭 HTTP 服务。
   * 2 秒兜底强制退出，避免挂起的长连接阻塞进程。
   */
  async function gracefulShutdown() {
    if (sdkShuttingDown) {
      process.exit(0);
      return;
    }
    sdkShuttingDown = true;
    try {
      await sdkRuntime.shutdown();
    } catch {
      // shutdown 内部已吞掉单会话异常，这里仅做兜底
    }
    setTimeout(() => process.exit(0), 2000).unref();
    server.close(() => process.exit(0));
  }

  // 首次收到中断或终止信号时优雅关闭；重复信号立即退出
  process.on('SIGINT', () => { void gracefulShutdown(); });
  process.on('SIGTERM', () => { void gracefulShutdown(); });

  process.on('exit', () => {
    // 进程退出回调无法 await，使用同步清理：关闭输入队列并 abort 运行时，避免残留子进程
    try { sdkRuntime.shutdownSync(); } catch {}
    for (const terminal of workspaceTerminals.values()) {
      try { terminal.proc.kill(); } catch {}
    }
  });
}
