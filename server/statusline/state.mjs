import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CLAUDE, USER_SETTINGS } from '../core/paths.mjs';
import { readSettings } from '../core/settings.mjs';
import { workspaceState } from '../workspace/state.mjs';
import { workspaceTerminals } from '../terminal/sessions.mjs';
import { getStatusline, statuslineByCwd } from './store.mjs';
import { enrichStatusline } from './enrich.mjs';
import { collectConfigStats } from './config-stats.mjs';
import { isWrapperCommand } from './toggle.mjs';

/** 默认启用态自检所需的文件路径（与 toggle.mjs 的用户目录约定一致） */
const DEFAULT_STATE_PATHS = () => ({
  settingsFile: USER_SETTINGS,
  backupFile: path.join(CLAUDE, 'workbench-statusline.json'),
  wrapperCopy: path.join(CLAUDE, 'workbench-statusline-wrapper.mjs'),
});

/** 构造带 HTTP 状态码的错误，供路由层直接透传 */
function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/** 读取项目目录的当前 git 分支与工作区脏标记；detached HEAD 回退短 SHA；非 git 目录或超时时省略 */
export function gitBranch(projectPath) {
  let branch = '';
  try {
    branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectPath, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8',
    }).trim();
  } catch {
    return undefined;
  }
  if (!branch) {
    // detached HEAD：与 claude-hud 一致回退到短 SHA
    try {
      branch = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: projectPath, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8',
      }).trim();
    } catch {
      return undefined;
    }
  }
  if (!branch) return undefined;
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: projectPath, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8',
    }).trim();
    return dirty ? `${branch}*` : branch;
  } catch {
    return branch;
  }
}

/**
 * 启用态自检：备份记录为启用中、包装器副本文件存在、且 settings 的
 * statusLine.command 确实指向包装器副本，三者齐备才视为启用。
 * 用户手动删除或改写 settings 中的 statusLine 后，软件不会继续显示"已启用"的假象。
 */
export function collectEnabled(paths) {
  const resolved = { ...DEFAULT_STATE_PATHS(), ...paths };
  const backup = readSettings(resolved.backupFile);
  if (!backup?.enabled) return false;
  if (!fs.existsSync(resolved.wrapperCopy)) return false;
  const settings = readSettings(resolved.settingsFile);
  return isWrapperCommand(settings?.statusLine?.command);
}

/**
 * 为一个工作台会话解析状态栏数据：先按 CLI sessionId 精确匹配，
 * 再按项目目录兜底匹配最近转发（continue/picker 会话）。
 * @returns {{ status: object|null, matchedBy: 'session'|'cwd'|null }}
 */
export function resolveStatuslineForSession(session, deps = {}) {
  const get = deps.getStatusline || getStatusline;
  const byCwd = deps.statuslineByCwd || statuslineByCwd;
  const enrich = deps.enrich || enrichStatusline;

  let entry = session.sessionId ? get(session.sessionId) : undefined;
  let matchedBy = entry ? 'session' : null;
  if (!entry) {
    entry = byCwd(session.projectPath);
    matchedBy = entry ? 'cwd' : null;
  }
  if (!entry) return { status: null, matchedBy: null };

  const extra = enrich(entry.data);
  // git 分支以 CLI 会话的真实工作目录为准（与 claude-hud 相同的数据源），回退到工作台项目目录
  const gitCwd = String(entry.data?.workspace?.current_dir || entry.data?.cwd || '') || session.projectPath;
  return {
    status: {
      ...entry.data,
      ...extra,
      // 原始 cost 对象（含时长/行数统计）单独保留，供前端展示；cost 数字由 enrich 提供
      cost_detail: entry.data?.cost && typeof entry.data.cost === 'object' ? entry.data.cost : undefined,
      gitBranch: gitBranch(gitCwd),
      receivedAt: entry.receivedAt,
    },
    matchedBy,
  };
}

/** GET /api/statusline/state?id=<workbench-session-id>：返回合并状态与启用标志；无 id 时仅返回启用标志 */
export function handleStatuslineState(url) {
  const id = String(url.searchParams.get('id') || '');
  if (!id) {
    return { status: 200, body: { enabled: collectEnabled(), matchedBy: null, status: null, configStats: collectConfigStats(''), modelOptions: readModelOptions() } };
  }
  const session = workspaceState().sessions.find(item => item.id === id);
  if (!session) throw httpError(404, '会话不存在');
  const { status, matchedBy } = resolveStatuslineForSession(session);
  // 配置统计按会话所属项目计算（全局 + 项目级）
  return {
    status: 200,
    body: { enabled: collectEnabled(), matchedBy, status, configStats: collectConfigStats(session.projectPath || ''), modelOptions: readModelOptions() },
  };
}

/** 读取用户 settings.json 中 modelPicker.options 作为状态栏的模型候选清单；同时返回 effort 是否被环境变量锁定 */
export function readModelOptions() {
  const settings = readSettings(path.join(CLAUDE, 'settings.json'));
  const picker = settings?.modelPicker;
  const options = Array.isArray(picker?.options) ? picker.options : [];
  return {
    options: options
      .filter(item => item && typeof item.model === 'string' && item.model)
      .map(item => ({ model: item.model, label: typeof item.label === 'string' ? item.label : item.model })),
    // CLAUDE_CODE_EFFORT_LEVEL 环境变量的优先级高于 /effort 命令，存在时思考等级切换不生效
    effortLockedByEnv: Boolean(settings?.env?.CLAUDE_CODE_EFFORT_LEVEL),
    effortLockedValue: settings?.env?.CLAUDE_CODE_EFFORT_LEVEL || '',
  };
}

/** EFFORT 的合法档位（含 Claude Code 新版的 max 档） */
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/**
 * 向激活会话的 pty 注入 CLI slash 命令切换模型或思考等级。
 * 命令会出现在终端输入行并执行——这是 CLI 接受运行时控制的标准方式。
 */
export function handleStatuslineSwitch(body) {
  const workbenchId = String(body?.id || '');
  const model = String(body?.model || '').trim();
  const effort = String(body?.effort || '').trim().toLowerCase();
  if (!model && !effort) throw httpError(400, '请提供 model 或 effort');
  if (model && !/^[\w.\-[\]]+$/.test(model)) throw httpError(400, '模型名包含非法字符');
  if (effort && !EFFORT_LEVELS.has(effort)) throw httpError(400, `思考等级仅支持 ${[...EFFORT_LEVELS].join('/')}`);

  const terminal = workspaceTerminals.get(workbenchId);
  if (!terminal || terminal.status !== 'running') throw httpError(404, '该会话没有运行中的终端');
  const command = model ? `/model ${model}` : `/effort ${effort}`;
  terminal.proc.write(`${command}\r`);
  return { status: 200, body: { sent: command } };
}
