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

setupWorkspace();
