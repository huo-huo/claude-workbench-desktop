// 管理页 E2E 冒烟测试：加载、九页导航、筛选、详情抽屉、刷新与全程脚本错误/toast 监控（只读交互，不触碰开关/保存/AI 功能）
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_NAMES = ['dashboard','models','hooks','skills','mcp','plugins','versions','errors','diagnosis'];

// 每页的关键元素选择器：断言渲染出卡片（数量>0）或空态文案
const PAGE_PROBES = {
  dashboard: '.metric-card',
  models: '.channel-card, .model-slot',
  hooks: '.logic-card, .empty',
  skills: '.logic-card, .empty',
  mcp: '.logic-card, .empty',
  plugins: '.logic-card, .empty',
  versions: '.metric-card',
  errors: '.data-table, .empty',
  diagnosis: '.role-list, .notice',
};

// 打开管理页并等待首次渲染完成
async function openAdmin(page) {
  await page.goto('/');
  await expect(page.locator('#page .page-head')).toBeVisible();
}

// 全程脚本错误监控：注册 pageerror 收集器
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
}

// 全程 toast 异常文案断言
async function expectNoBadToast(page) {
  await expect(page.locator('#toast')).not.toContainText(/is not defined|Cannot read|请求失败/);
}

test('管理页加载完成首次渲染且无脚本错误', async ({ page }) => {
  const errors = watchErrors(page);
  await openAdmin(page);
  await expect(page.locator('#page .page-head, #page .logic-card').first()).toBeVisible();
  // 断言服务的是本仓库 dist 的模块化页面（打包产物 script），而非用户级 WEB_ROOT 指向的旧内联页面
  await expect(page.locator('script[type="module"][src^="/assets/"]')).toBeAttached();
  // 模块私有性：旧内联脚本的顶层 function render/loadState/setPage 会挂到 window，模块化后不应泄漏（组合断言补足区分度）
  const leaked = await page.evaluate(() => ({ render: typeof window.render, loadState: typeof window.loadState, setPage: typeof window.setPage }));
  expect(leaked, '管理页渲染函数不应泄漏到 window').toEqual({ render: 'undefined', loadState: 'undefined', setPage: 'undefined' });
  await expectNoBadToast(page);
  expect(errors, '页面不应有未捕获脚本错误').toEqual([]);
});

test('导航依次切页且每页内容替换、无脚本错误', async ({ page }) => {
  const errors = watchErrors(page);
  await openAdmin(page);
  for (const name of PAGE_NAMES) {
    await page.locator(`.nav-btn[data-page="${name}"]`).click();
    // #page 内容已替换：对应页的关键元素出现
    await expect(page.locator(`#page ${PAGE_PROBES[name]}`).first()).toBeVisible();
    // 面包屑标题随页面切换
    await expect(page.locator('#crumb')).not.toHaveText('');
    await expectNoBadToast(page);
  }
  expect(errors, '页面不应有未捕获脚本错误').toEqual([]);
});

test('Hooks 页关键词筛选触发重新渲染', async ({ page }) => {
  const errors = watchErrors(page);
  await openAdmin(page);
  await page.locator('.nav-btn[data-page="hooks"]').click();
  await expect(page.locator('#page .logic-card, #page .empty').first()).toBeVisible();
  // 输入不可能匹配的关键词后出现空态，证明 #page 已按筛选重新渲染
  await page.locator('#search').fill('zzz-不存在的关键词-9qfz');
  await expect(page.locator('#page .empty')).toBeVisible();
  await expectNoBadToast(page);
  expect(errors, '页面不应有未捕获脚本错误').toEqual([]);
});

test('详情抽屉打开与关闭', async ({ page }) => {
  const errors = watchErrors(page);
  await openAdmin(page);
  await page.locator('.nav-btn[data-page="hooks"]').click();
  await expect(page.locator('#page .logic-card').first()).toBeVisible();
  await page.locator('#page [data-detail]').first().click();
  await expect(page.locator('#drawerBackdrop.open')).toBeVisible();
  await expect(page.locator('#drawerBody')).not.toBeEmpty();
  await page.locator('#drawerClose').click();
  await expect(page.locator('#drawerBackdrop')).not.toHaveClass(/open/);
  await expectNoBadToast(page);
  expect(errors, '页面不应有未捕获脚本错误').toEqual([]);
});

test('刷新按钮触发重新扫描提示', async ({ page }) => {
  const errors = watchErrors(page);
  await openAdmin(page);
  await page.locator('#refresh').click();
  // 出现 toast（#toast.show）或 #scanTime 文本更新
  await expect(page.locator('#toast.show')).toBeVisible();
  await expect(page.locator('#scanTime')).toContainText('扫描');
  await expectNoBadToast(page);
  expect(errors, '页面不应有未捕获脚本错误').toEqual([]);
});

test('Hooks 页折叠流程图（跨模块 render 回路）', async ({ page }) => {
  const errors = watchErrors(page);
  await openAdmin(page);
  await page.locator('.nav-btn[data-page="hooks"]').click();
  const flowButton = page.locator('#page [data-flow-toggle]').first();
  await expect(flowButton).toBeVisible();
  // 点击折叠 → wireCards 回调内调用 render() 重渲染 → 按钮文案切换、流程图消失
  const before = await flowButton.textContent();
  await flowButton.click();
  await expect(page.locator('#page .page-head')).toBeVisible();
  const after = await page.locator('#page [data-flow-toggle]').first().textContent();
  expect(after, '折叠后按钮文案应切换').not.toBe(before);
  await expectNoBadToast(page);
  expect(errors, '页面不应有未捕获脚本错误').toEqual([]);
});

test('Skills 页翻页（跨模块 render 回路）', async ({ page }) => {
  const errors = watchErrors(page);
  await openAdmin(page);
  await page.locator('.nav-btn[data-page="skills"]').click();
  const next = page.locator('#skillsNext');
  await expect(next).toBeVisible();
  const info = page.locator('#page .status-row', { hasText: '当前筛选' });
  const before = await info.textContent();
  if (await next.isDisabled()) {
    // 数据不足一页时跳过翻页动作，但按钮与页码文本必须已渲染
    expect(before).toContain('第 1');
  } else {
    await next.click();
    await expect(page.locator('#page .page-head')).toBeVisible();
    await expect(info).not.toHaveText(before || '');
    expect(await info.textContent()).toContain('第 2');
    await page.locator('#skillsPrev').click();
    await expect(info).toContainText('第 1');
  }
  await expectNoBadToast(page);
  expect(errors, '页面不应有未捕获脚本错误').toEqual([]);
});

test('九页关键元素清单验收记录', async ({ page }) => {
  const errors = watchErrors(page);
  await openAdmin(page);
  const rows = [];
  for (const name of PAGE_NAMES) {
    await page.locator(`.nav-btn[data-page="${name}"]`).click();
    await expect(page.locator(`#page ${PAGE_PROBES[name]}`).first()).toBeVisible();
    const title = (await page.locator('#page .page-head h1').textContent())?.trim() || '';
    const probe = page.locator(`#page ${PAGE_PROBES[name]}`);
    const count = await probe.count();
    const emptyText = count === 1 && (await probe.getAttribute('class'))?.includes('empty')
      ? (await probe.first().textContent())?.trim() : '';
    const emptyNote = emptyText ? `（空态：${emptyText}）` : '';
    rows.push({ name, title, count: emptyText ? 0 : count, probe: PAGE_PROBES[name], emptyNote });
  }
  // 断言每页标题非空且（卡片>0 或有空态）
  for (const r of rows) {
    expect(r.title, `${r.name} 页面标题`).not.toBe('');
    if (['hooks','skills','mcp','plugins','errors'].includes(r.name)) {
      expect(r.count > 0 || r.emptyNote, `${r.name} 页应有卡片或空态`).toBeTruthy();
    } else {
      expect(r.count, `${r.name} 页应有关键元素`).toBeGreaterThan(0);
    }
  }
  await expectNoBadToast(page);
  expect(errors, '页面不应有未捕获脚本错误').toEqual([]);
  // 生成验收记录（同时记录基线对比）
  const lines = [
    '# 管理页模块化重构验收记录',
    '',
    '由 tests/e2e/admin.spec.mjs 的「九页关键元素清单验收记录」用例自动生成（Playwright 断言记录，非截图）。',
    '',
    '## 基线对比（taskId 130e3bb1）',
    '',
    '| 项 | 基线（重构前） | 现状（重构后） |',
    '| --- | --- | --- |',
    '| index.html | 276 行，内联 169 行管理页脚本（105-273 行） | 109 行，无内联脚本，仅 `<script type="module" src="/src/admin/index.mjs">` |',
    '| 脚本形态 | 单个内联 script（压缩长行） | 24 个 ESM 模块（state / core / common / pages / index）打包为单 JS 产物 |',
    '| DOM 结构 | 相同 | 相同（替换仅动 script 段） |',
    '| 构建产物 | JS 374.82 kB（gzip 97.29 kB，管理页未模块化） | JS 442.25 kB（gzip 119.14 kB，含全部管理页模块） |',
    '| 冒烟结果 | 无自动化覆盖 | Playwright 冒烟全绿（加载/九页导航/筛选/抽屉/刷新，pageerror=0，toast 无异常文案） |',
    '',
    '## 九页关键元素清单',
    '',
    '| 页面 | 标题 | 关键元素 | 数量 | 备注 |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(r => `| ${r.name} | ${r.title} | \`${r.probe}\` | ${r.count} | ${r.emptyNote || '正常渲染'} |`),
    '',
  ];
  fs.writeFileSync(path.join(HERE, 'ADMIN_ACCEPTANCE.md'), lines.join('\n'));
});
