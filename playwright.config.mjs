// Playwright 冒烟测试配置：工作区 + 管理页 E2E（固定端口 4199，本地启动 server.mjs）
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import process from 'node:process';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4199',
    channel: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.mjs',
    env: {
      CLAUDE_WORKBENCH_PORT: '4199',
      // 显式覆盖用户级 CLAUDE_WORKBENCH_WEB_ROOT（可能指向已安装桌面应用的旧 dist），确保服务本仓库构建产物
      CLAUDE_WORKBENCH_WEB_ROOT: path.resolve(process.cwd(), 'dist'),
      // E2E 使用独立工作区文件，避免首屏设置与真实用户配置互相污染
      CLAUDE_WORKBENCH_WORKSPACE_FILE: path.resolve(process.cwd(), 'test-results', 'e2e-workspace.json'),
    },
    url: 'http://127.0.0.1:4199/api/workspace/projects',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
