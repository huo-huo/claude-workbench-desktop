import '@xterm/xterm/css/xterm.css';
// 样式按原文件顺序导入，保持层叠顺序不变
import './styles/theme.css';
import './styles/layout.css';
import './styles/projects.css';
import './styles/sessions.css';
import './styles/terminal.css';
import './styles/composer.css';
import './styles/prompts.css';
import './styles/files.css';
import { setupWorkspace } from './workspace/init.mjs';
import { loadWorkspaceSettings } from './workspace/settings.mjs';

// 先加载服务端设置再渲染，避免主题与布局闪变；加载失败时管理器内部回退本地缓存
loadWorkspaceSettings()
  .catch(() => {})
  .then(() => setupWorkspace());
