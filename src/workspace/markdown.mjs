// 转义优先的迷你 Markdown 渲染器：
// 先对整篇文本做 HTML 转义，再做语法转换，任何输入都不会产生原生 HTML 注入。
// 支持：标题、围栏代码块、行内代码、粗体/斜体/删除线、链接（仅 http/https）、
// 无序/有序列表（含任务框）、引用块、表格、分割线；图片语法降级为文字。
// 不依赖 DOM，可在 node --test 中直接验证。

/** HTML 转义：渲染器的安全根基，所有语法转换都建立在已转义文本之上 */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const HR_RE = /^ {0,3}((?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
// 引用块的 > 在输入转义阶段已变成 &gt;，这里按转义后的形态匹配
const QUOTE_RE = /^ {0,3}&gt;\s?(.*)$/;
const UL_ITEM_RE = /^ {0,3}[-*+]\s+(.*)$/;
const OL_ITEM_RE = /^ {0,3}\d{1,9}[.)]\s+(.*)$/;
const PLACEHOLDER_RE = /^\u0000(\d+)\u0001\s*$/;
const CODE_SPAN_RE = /`([^`\n]+)`/g;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const BOLD_ITALIC_RE = /\*\*\*([^*\n]+)\*\*\*/g;
const BOLD_RE = /\*\*([^*\n]+)\*\*/g;
const BOLD_UNDERLINE_RE = /(?<![\w\\])__([^_\n]+)__(?![\w])/g;
const ITALIC_RE = /\*([^*\n]+)\*/g;
const ITALIC_UNDERLINE_RE = /(?<![\w\\])_([^_\n]+)_(?![\w])/g;
const STRIKE_RE = /~~([^~\n]+)~~/g;

/** 提取围栏代码块：整块转成占位符行，块内内容只保留输入时已完成的转义 */
function extractFences(lines, ctx) {
  const result = [];
  for (let i = 0; i < lines.length; i += 1) {
    const opener = lines[i].match(FENCE_RE);
    if (!opener) { result.push(lines[i]); continue; }
    const marker = opener[1];
    const closeRe = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`);
    const body = [];
    i += 1;
    while (i < lines.length && !closeRe.test(lines[i])) { body.push(lines[i]); i += 1; }
    // 未闭合的围栏：剩余内容整体视为代码块
    const token = `\u0000${ctx.codes.length}\u0001`;
    ctx.codes.push(`<pre><code>${body.join('\n')}</code></pre>`);
    result.push(token);
  }
  return result;
}

/** 行内格式转换：先摘出行内代码，再处理链接与强调，最后还原占位符 */
function renderInline(text, ctx) {
  let out = text.replace(CODE_SPAN_RE, (_m, code) => {
    const token = `\u0000${ctx.codes.length}\u0001`;
    ctx.codes.push(`<code>${code}</code>`);
    return token;
  });
  // 图片降级为文字：查看器不加载远程资源，保留可读信息
  out = out.replace(IMAGE_RE, (_m, alt, url) => `${alt}（${url}）`);
  out = out.replace(LINK_RE, (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  out = out.replace(BOLD_ITALIC_RE, '<strong><em>$1</em></strong>');
  out = out.replace(BOLD_RE, '<strong>$1</strong>');
  out = out.replace(BOLD_UNDERLINE_RE, '<strong>$1</strong>');
  out = out.replace(STRIKE_RE, '<del>$1</del>');
  out = out.replace(ITALIC_RE, '<em>$1</em>');
  out = out.replace(ITALIC_UNDERLINE_RE, '<em>$1</em>');
  return out.replace(/\u0000(\d+)\u0001/g, (_m, index) => ctx.codes[Number(index)]);
}

/** 表格对齐方式：分隔行里的冒号映射为 text-align */
function tableAlign(separatorCells) {
  return separatorCells.map(cell => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });
}

/** 按空行切分单元格：去掉首尾管道产生的空串，保留中间的空单元格 */
function splitCells(line) {
  const cells = line.split('|');
  if (cells.length > 1 && cells[0].trim() === '') cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(cell => cell.trim());
}

/** 判断一行是否是 GFM 表格分隔行（如 | --- | :---: |） */
function isTableSeparator(line) {
  if (!line.includes('-') || !line.includes('|')) return false;
  return /^ {0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line);
}

/** 块级解析：把已转义的行数组转换成块级 HTML 数组 */
function renderBlocks(lines, ctx) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    // 围栏代码块占位符：整块输出
    const placeholder = line.match(PLACEHOLDER_RE);
    if (placeholder) { blocks.push(ctx.codes[Number(placeholder[1])]); i += 1; continue; }
    const heading = line.match(HEADING_RE);
    if (heading) { blocks.push(`<h${heading[1].length}>${renderInline(heading[2], ctx)}</h${heading[1].length}>`); i += 1; continue; }
    if (HR_RE.test(line)) { blocks.push('<hr>'); i += 1; continue; }
    if (QUOTE_RE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) { quoted.push(lines[i].replace(QUOTE_RE, '$1')); i += 1; }
      blocks.push(`<blockquote>${renderBlocks(quoted, ctx).join('\n')}</blockquote>`);
      continue;
    }
    if (UL_ITEM_RE.test(line) || OL_ITEM_RE.test(line)) {
      const ordered = OL_ITEM_RE.test(line) && !UL_ITEM_RE.test(line);
      const items = [];
      while (i < lines.length) {
        const ul = lines[i].match(UL_ITEM_RE);
        const ol = lines[i].match(OL_ITEM_RE);
        if (ul || ol) {
          // 任务框语法：- [ ] 未完成 / - [x] 已完成
          const raw = (ul ? ul[1] : ol[1]).replace(/^\[([ xX])\]\s+/, (mark, flag) => (flag === ' ' ? '☐ ' : '☑ '));
          items.push(renderInline(raw, ctx));
          i += 1;
        } else if (items.length && /^\s{2,}\S/.test(lines[i])) {
          // 缩进续行并入上一条列表项
          items[items.length - 1] += ` ${renderInline(lines[i].trim(), ctx)}`;
          i += 1;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.map(item => `<li>${item}</li>`).join('')}</${tag}>`);
      continue;
    }
    // 表格：当前行含 | 且下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headerCells = splitCells(line);
      const aligns = tableAlign(splitCells(lines[i + 1]));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitCells(lines[i])); i += 1; }
      const cell = (value, tag, index) => {
        const align = aligns[index % aligns.length];
        const style = align === 'left' ? '' : ` style="text-align:${align}"`;
        return `<${tag}${style}>${renderInline(value, ctx)}</${tag}>`;
      };
      const thead = `<thead><tr>${headerCells.map((value, index) => cell(value, 'th', index)).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows.map(row => `<tr>${row.map((value, index) => cell(value, 'td', index)).join('')}</tr>`).join('')}</tbody>`;
      blocks.push(`<table>${thead}${tbody}</table>`);
      continue;
    }
    // 段落：连续普通行合并；换行在 HTML 中折叠为空格
    const paragraph = [];
    while (i < lines.length && lines[i].trim()
      && !PLACEHOLDER_RE.test(lines[i]) && !HEADING_RE.test(lines[i]) && !HR_RE.test(lines[i])
      && !QUOTE_RE.test(lines[i]) && !UL_ITEM_RE.test(lines[i]) && !OL_ITEM_RE.test(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (paragraph.length) blocks.push(`<p>${renderInline(paragraph.join('\n'), ctx)}</p>`);
  }
  return blocks;
}

/** 渲染 Markdown 文本为 HTML 字符串；输入先整体转义，输出可安全写入 innerHTML */
export function renderMarkdown(md) {
  const source = String(md ?? '');
  if (!source.trim()) return '';
  const ctx = { codes: [] };
  // 安全根基：先对整篇输入做 HTML 转义，后续语法转换只引入我们自己的标签
  const prepared = extractFences(escapeHtml(source).replace(/\r\n?/g, '\n').split('\n'), ctx);
  return renderBlocks(prepared, ctx).join('\n');
}
