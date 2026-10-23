import { defineConfig } from '@playwright/test';

// 冒烟测试：启动本地服务（随机范围内的固定端口），只访问只读端点与纯前端交互
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
    env: { CLAUDE_WORKBENCH_PORT: '4199' },
    url: 'http://127.0.0.1:4199/api/workspace/projects',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
