import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// 本模块位于 server/core/，向上两级回到项目根，保持与原 server.mjs 相同的 ROOT 语义
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

// 优先使用已构建的 dist；未构建时回退到项目根（与拆分前一致）
const DEFAULT_WEB_ROOT = fs.existsSync(path.join(ROOT, 'dist', 'index.html')) ? path.join(ROOT, 'dist') : ROOT;
export const WEB_ROOT = path.resolve(process.env.CLAUDE_WORKBENCH_WEB_ROOT || DEFAULT_WEB_ROOT);

export const HOME = os.homedir();
export const CLAUDE = path.join(HOME, '.claude');
export const USER_SETTINGS = path.join(CLAUDE, 'settings.json');
export const STATE_FILE = path.join(CLAUDE, 'workbench-state.json');
export const SKILL_TRANSLATIONS_FILE = path.join(CLAUDE, 'workbench-skill-translations.json');
// 允许测试覆盖工作区数据文件，避免 E2E 读写用户真实的 ~/.claude/workbench-workspace.json
export const WORKSPACE_FILE = path.resolve(process.env.CLAUDE_WORKBENCH_WORKSPACE_FILE || path.join(CLAUDE, 'workbench-workspace.json'));
export const SECRETS_FILE = path.join(CLAUDE, 'workbench-secrets.dpapi.json');
export const PORT = Number(process.env.CLAUDE_WORKBENCH_PORT || 4173);
export const MAX_BODY = 1024 * 1024;
export const MAX_IMAGE_UPLOAD = 20 * 1024 * 1024;
export const CLAUDE_WINGET_ID = 'Anthropic.ClaudeCode';
