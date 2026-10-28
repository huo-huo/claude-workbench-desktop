/**
 * 输入区快捷键的纯判定函数，便于在没有 DOM 的测试环境中验证。
 * 返回 send / focus-terminal / toggle-composer / null。
 */
export function matchComposerShortcut(event, { inTerminal = false } = {}) {
  const key = String(event?.key || '').toLowerCase();
  const plain = !event?.altKey && !event?.shiftKey && !event?.metaKey;
  if (event?.ctrlKey && plain && key === 'enter') return 'send';
  if (!event?.ctrlKey && plain && key === 'escape') return 'focus-terminal';
  // 终端拥有焦点时把 Ctrl+` 留给 xterm，避免吞掉终端输入
  if (event?.ctrlKey && plain && key === '`' && !inTerminal) return 'toggle-composer';
  return null;
}
