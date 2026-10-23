import { test, expect } from '@playwright/test';

// 工作区冒烟：只验证页面加载与纯前端交互，不创建终端会话、不添加项目
test('管理页加载并切换到工作区', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#page')).not.toBeHidden();
  await expect(page.locator('[data-view="workspace"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-view="workspace"]').click();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#projectList')).toBeVisible();
});

test('主题切换写入深色类', async ({ page }) => {
  await page.goto('/');
  const body = page.locator('body');
  const before = await body.getAttribute('class');
  await page.locator('#toggleWorkspaceTheme').click();
  await expect(body).toHaveClass(/theme-dark/);
  if (before?.includes('theme-dark')) {
    await page.locator('#toggleWorkspaceTheme').click();
    await expect(body).not.toHaveClass(/theme-dark/);
  }
});

test('终端字号可调整', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-view="workspace"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-view="workspace"]').click();
  const level = page.locator('#terminalZoomLevel');
  await expect(level).toHaveText('12px');
  await page.locator('#terminalZoomIn').click();
  await expect(level).toHaveText('13px');
  await page.locator('#terminalZoomLevel').click();
  await expect(level).toHaveText('12px');
});

test('提示词库可打开与关闭', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-view="workspace"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-view="workspace"]').click();
  await page.locator('#toggleComposer').click();
  await page.locator('#openPromptManager').click();
  await expect(page.locator('#promptManagerBackdrop')).toBeVisible();
  await page.locator('#closePromptManager').click();
  await expect(page.locator('#promptManagerBackdrop')).toBeHidden();
});

test('文件树区域渲染内容', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-view="workspace"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-view="workspace"]').click();
  await expect(page.locator('#fileTree')).toBeVisible();
  // 空状态或已加载的文件树都算通过；关键是区域已渲染且没有脚本错误
  await expect(page.locator('#fileTree > *').first()).toBeVisible();
});

test('项目列表与输入区可用', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-view="workspace"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-view="workspace"]').click();
  await expect(page.locator('#projectList')).toBeVisible();
  await page.locator('#toggleComposer').click();
  const input = page.locator('#composerInput');
  await input.fill('冒烟测试输入');
  await page.locator('#clearComposer').click();
  await expect(input).toHaveValue('');
});

test('进入工作区后没有未捕获的页面脚本错误', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('[data-view="workspace"]')).toBeVisible({ timeout: 20000 });
  await page.locator('[data-view="workspace"]').click();
  await expect(page.locator('#projectList')).toBeVisible();
  // 等待项目/会话渲染与首次轮询完成
  await page.waitForTimeout(4000);
  // 被 .catch() 吞掉的错误不会触发 pageerror，用 toast 与渲染结果补充验证
  await expect(page.locator('#toast')).not.toContainText(/is not defined|Cannot read|请求失败/);
  await expect(page.locator('#projectList').locator('.project-item, .empty').first()).toBeVisible();
  await expect(page.locator('#sessionList').locator('.session-item, .empty').first()).toBeVisible();
  expect(errors).toEqual([]);
});
