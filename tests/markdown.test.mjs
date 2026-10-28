import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/workspace/markdown.mjs';

test('标题渲染为对应层级', () => {
  const html = renderMarkdown('# 一级\n## 二级\n### 三级');
  assert.ok(html.includes('<h1>一级</h1>'));
  assert.ok(html.includes('<h2>二级</h2>'));
  assert.ok(html.includes('<h3>三级</h3>'));
});

test('段落内行内格式：粗体、斜体、删除线、行内代码', () => {
  const html = renderMarkdown('普通 **粗体** *斜体* ~~删除~~ `code`');
  assert.ok(html.includes('<strong>粗体</strong>'));
  assert.ok(html.includes('<em>斜体</em>'));
  assert.ok(html.includes('<del>删除</del>'));
  assert.ok(html.includes('<code>code</code>'));
});

test('行内代码内容不参与其他格式', () => {
  const html = renderMarkdown('`**不是粗体**`');
  assert.ok(html.includes('<code>**不是粗体**</code>'));
  assert.ok(!html.includes('<strong>'));
});

test('围栏代码块整体转义且不做行内格式', () => {
  const html = renderMarkdown('```\n<script>alert(1)</script>\n**bold**\n```');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<strong>'));
  assert.ok(html.includes('<pre><code>'));
});

test('HTML 注入被转义', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
});

test('仅 http/https 链接生成锚点，javascript: 被拒绝', () => {
  const ok = renderMarkdown('[官网](https://example.com)');
  assert.ok(ok.includes('<a href="https://example.com"'));
  assert.ok(ok.includes('rel="noopener noreferrer"'));
  const bad = renderMarkdown('[点我](javascript:alert(1))');
  assert.ok(!bad.includes('<a '));
  assert.ok(bad.includes('javascript:alert(1)'));
});

test('无序列表与有序列表', () => {
  const ul = renderMarkdown('- 甲\n- 乙');
  assert.ok(ul.includes('<ul>'));
  assert.ok(ul.includes('<li>甲</li>'));
  const ol = renderMarkdown('1. one\n2. two');
  assert.ok(ol.includes('<ol>'));
  assert.ok(ol.includes('<li>two</li>'));
});

test('引用块递归渲染内部内容', () => {
  const html = renderMarkdown('> 引用 **粗体**\n> 第二行');
  assert.ok(html.includes('<blockquote>'));
  assert.ok(html.includes('<strong>粗体</strong>'));
});

test('表格渲染表头与单元格', () => {
  const html = renderMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |');
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<th>A</th>'));
  assert.ok(html.includes('<td>2</td>'));
});

test('分割线渲染为 hr', () => {
  assert.ok(renderMarkdown('---').includes('<hr>'));
  assert.ok(renderMarkdown('***').includes('<hr>'));
});

test('下划线斜体不误伤 snake_case 标识符', () => {
  const html = renderMarkdown('变量 file_name_demo 保持原样');
  assert.ok(!html.includes('<em>'));
  assert.ok(html.includes('file_name_demo'));
});

test('空输入与非字符串输入返回空串或安全输出', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(undefined), '');
});

test('图片语法降级为文字链接形式', () => {
  const html = renderMarkdown('![截图](https://example.com/a.png)');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('截图'));
});
