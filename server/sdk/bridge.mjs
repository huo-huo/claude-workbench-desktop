import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildChannelEnvFrom, createSdkRuntime, findClaudeExeFromWhere } from '../../sdk-runtime.mjs';
import { CLAUDE, SECRETS_FILE, USER_SETTINGS } from '../core/paths.mjs';
import { fileMtimeMs, safeReadJson } from '../core/storage.mjs';
import { claudeInstallInfo } from '../platform/claude.mjs';
import { recordWorkspaceProject, safeWorkspaceRoot, workspaceState } from '../workspace/state.mjs';
import { channelApiKey, channelState } from '../channels/store.mjs';

// npm 全局安装的 claude.exe 探测缓存：仅在成功找到时缓存，避免每次 health 都 spawnSync
let sdkNpmClaudeExeCache = '';
// SDK 渠道密钥缓存：只保留最近一条，避免每次创建会话都同步 DPAPI 解密阻塞事件循环
let sdkChannelEnvCache = null;

// SDK 运行时单例：复用工作台已有的路径校验、CLI 定位与配置目录
export const sdkRuntime = createSdkRuntime({
  /**
   * 校验并返回项目真实路径。
   * 目录合法但未在工作台登记时按 400 处理，避免 SDK 会话脱离工作台的项目列表。
   */
  resolveProject(value) {
    const real = safeWorkspaceRoot(value);
    const saved = workspaceState();
    const key = path.resolve(real).toLowerCase();
    const registered = saved.projects.some(x => path.resolve(x.path).toLowerCase() === key)
      || saved.sessions.some(x => x.projectPath && path.resolve(x.projectPath).toLowerCase() === key);
    if (!registered) {
      const error = new Error('该项目未在工作台中登记，请先从工作台打开项目');
      error.statusCode = 400;
      throw error;
    }
    return recordWorkspaceProject(real);
  },
  /** 运行时解析：环境变量显式覆盖 → 已安装 CLI → npm 全局安装包内 exe → SDK 自带运行时 */
  resolveExecutable() {
    const override = String(process.env.CLAUDE_WORKBENCH_SDK_EXECUTABLE || '').trim();
    if (override) return { path: override, source: 'env' };
    const installed = claudeInstallInfo().executable;
    if (installed) return { path: installed, source: 'installed' };
    // 不改动 claudeInstallInfo（终端仍只认 claude.exe）：npm 全局安装只有 claude.cmd，
    // 这里合并两次 where.exe 输出，从 npm 前缀推导包内真实的 claude.exe
    if (!sdkNpmClaudeExeCache) {
      const whereOutput = ['claude', 'claude.cmd'].map(name => {
        try {
          return String(spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout || '');
        } catch {
          return '';
        }
      }).join('\n');
      sdkNpmClaudeExeCache = findClaudeExeFromWhere(whereOutput, candidate => fs.existsSync(candidate));
    }
    if (sdkNpmClaudeExeCache) return { path: sdkNpmClaudeExeCache, source: 'installed' };
    return { path: '', source: 'bundled' };
  },
  /**
   * 渠道环境注入：只作用于当次 SDK 会话，不写回全局 settings.json。
   * 激活渠道不存在或未配置密钥时返回空对象。
   */
  buildChannelEnv() {
    const channelStatus = channelState();
    const channel = channelStatus.channels.find(item => item.id === channelStatus.activeChannelId);
    if (!channel) return {};
    // 渠道声明了专属密文但密文缺失时返回空对象，绝不回退到全局 token 以免与当前 baseUrl 不匹配
    if (channel.secretRef && !safeReadJson(SECRETS_FILE, {})[channel.secretRef]) return {};
    // 缓存键由渠道标识与两个配置文件的修改时间组成；命中时复用密钥，避免重复同步解密
    const cacheKey = [channel.id, channel.secretRef || '', fileMtimeMs(SECRETS_FILE), fileMtimeMs(USER_SETTINGS)].join('|');
    let secret;
    if (sdkChannelEnvCache?.key === cacheKey) {
      secret = sdkChannelEnvCache.secret;
    } else {
      secret = channelApiKey(channel);
      sdkChannelEnvCache = { key: cacheKey, secret };
    }
    return buildChannelEnvFrom(channelStatus, () => secret);
  },
  sessionFile: path.join(CLAUDE, 'workbench-sdk-sessions.json'),
  loadSdk: () => import('@anthropic-ai/claude-agent-sdk'),
});
