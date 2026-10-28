import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE, ROOT, USER_SETTINGS } from '../core/paths.mjs';
import { writeSettings } from '../core/settings.mjs';

/** statusLine 包装器文件位置：源随软件分发，副本与配置放用户目录（不依赖安装位置） */
const DEFAULT_PATHS = () => ({
  settingsFile: USER_SETTINGS,
  backupFile: path.join(CLAUDE, 'workbench-statusline.json'),
  wrapperSource: path.join(ROOT, 'resources', 'statusline-wrapper.mjs'),
  wrapperCopy: path.join(CLAUDE, 'workbench-statusline-wrapper.mjs'),
  wrapperConfig: path.join(CLAUDE, 'workbench-statusline-wrapper.json'),
});

/** 构造带 HTTP 状态码的错误，供路由层直接透传 */
function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/**
 * 严格读取 JSON 文件：与 safeReadJson 不同，文件存在且非空但解析失败时抛错——
 * settings.json 是用户全局配置，损坏时盲目写回会清空用户全部配置。
 */
function readJsonStrict(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(500, `${file} 解析失败，为避免覆盖你的配置已中止操作；请先修复或备份该文件`);
  }
}

/** 判断当前 settings 里的 command 是否已指向本包装器副本 */
export function isWrapperCommand(command) {
  return Boolean(command) && command.includes('workbench-statusline-wrapper.mjs');
}

/**
 * 启用 statusLine 包装：备份原命令 → 写包装器配置 → 替换 settings。
 * 写入顺序保证任何一步失败时 settings 保持不变。
 * 原本没有 statusLine 配置时也允许启用（originalCommand 记为空，禁用时直接移除包装配置），
 * 转件状态栏只依赖转发数据，不依赖终端内原 statusLine 的存在。
 * @param {{ port: number, paths?: object }} options
 */
export function enableStatusline(options = {}) {
  const paths = { ...DEFAULT_PATHS(), ...options.paths };
  const settings = readJsonStrict(paths.settingsFile);
  const current = settings?.statusLine?.command;

  // 源脚本缺失时绝不写 settings，避免把配置指向死路径
  if (!fs.existsSync(paths.wrapperSource)) throw httpError(500, `包装器脚本缺失：${paths.wrapperSource}`);

  // 已指向包装器但备份丢失：没有可信的原命令可恢复，拒绝启用引导用户手动处理。
  // originalCommand 允许为空串（启用前本无 statusLine），因此用类型判断而非 falsy 判断
  const existingBackup = readJsonStrict(paths.backupFile);
  if (isWrapperCommand(current) && (typeof existingBackup?.originalCommand !== 'string')) {
    throw httpError(409, 'statusLine 已指向包装器但缺少备份记录，请手动恢复原命令后再启用');
  }

  // 已有备份不覆盖 originalCommand，防止把包装器自己当成原命令（空串也是合法的原命令状态）；
  // 已指向包装器的重复启用同样重写副本/配置/settings，刷新端口与脚本版本
  const existing = readJsonStrict(paths.backupFile);
  const backup = typeof existing?.originalCommand === 'string'
    ? { ...existing, enabled: true, port: options.port }
    : { originalCommand: current || '', enabled: true, port: options.port };
  // 先写备份、包装器副本与配置，最后才替换 settings；前面的写入失败时 settings 未被触碰
  try {
    writeSettings(paths.backupFile, backup);
    fs.copyFileSync(paths.wrapperSource, paths.wrapperCopy);
    writeSettings(paths.wrapperConfig, { command: backup.originalCommand, port: options.port });
  } catch (error) {
    throw httpError(500, `启用准备写入失败（备份/副本/配置），statusLine 配置未改动：${error.message}`);
  }
  try {
    writeSettings(paths.settingsFile, {
      ...settings,
      statusLine: { type: 'command', command: `node "${paths.wrapperCopy}"` },
    });
  } catch (error) {
    throw httpError(500, `statusLine 配置写入失败：${error.message}`);
  }
  return { enabled: true, warning: current ? undefined : '终端内原本没有 statusLine，禁用时会移除包装配置' };
}

/**
 * 禁用 statusLine 包装：按备份把原命令原样写回 settings；
 * 备份的 originalCommand 为空（启用前本没有 statusLine）时直接移除 statusLine 键。
 */
export function disableStatusline(options = {}) {
  const paths = { ...DEFAULT_PATHS(), ...options.paths };
  const backup = readJsonStrict(paths.backupFile);
  if (!backup || typeof backup.originalCommand !== 'string') {
    // settings 解析失败时禁止写回，否则会把仅含 statusLine 的对象覆盖用户全部配置
    const settings = readJsonStrict(paths.settingsFile);
    if (!isWrapperCommand(settings?.statusLine?.command)) return { enabled: false, warning: '未处于启用状态' };
    throw httpError(409, '缺少备份记录，无法安全恢复原命令；请手动检查 settings.json');
  }
  const settings = readJsonStrict(paths.settingsFile);
  try {
    if (backup.originalCommand) {
      writeSettings(paths.settingsFile, {
        ...settings,
        statusLine: { ...settings.statusLine, type: 'command', command: backup.originalCommand },
      });
    } else {
      // 启用前没有 statusLine：恢复原状 = 移除包装写入的配置
      const { statusLine, ...rest } = settings;
      writeSettings(paths.settingsFile, rest);
    }
  } catch (error) {
    throw httpError(500, `statusLine 配置恢复失败：${error.message}`);
  }
  writeSettings(paths.backupFile, { ...backup, enabled: false });
  return { enabled: false };
}

/** 供测试与查询 API 使用：默认备份文件路径 */
export function defaultBackupFile() {
  return path.join(os.homedir(), '.claude', 'workbench-statusline.json');
}

/**
 * 启动时同步包装器转发端口：桌面端每次启动端口随机，包装器配置里若仍是旧端口，
 * 状态栏会一直收不到转发数据。仅在已启用且端口变化时更新配置与备份，失败静默。
 */
export function syncStatuslinePort(port, options = {}) {
  const paths = { ...DEFAULT_PATHS(), ...options.paths };
  try {
    const backup = readJsonStrict(paths.backupFile);
    if (backup?.enabled !== true) return { synced: false };
    if (Number(backup.port) === Number(port)) return { synced: false };
    if (!fs.existsSync(paths.wrapperCopy)) return { synced: false };
    writeSettings(paths.wrapperConfig, {
      command: typeof backup.originalCommand === 'string' ? backup.originalCommand : '',
      port: Number(port),
    });
    writeSettings(paths.backupFile, { ...backup, port: Number(port) });
    return { synced: true, port: Number(port) };
  } catch {
    // 启动阶段不能因状态栏配置失败而影响主服务
    return { synced: false };
  }
}
