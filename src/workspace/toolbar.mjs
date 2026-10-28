import { $ } from './core/dom.mjs';
import { selectOverflowActions } from './toolbar-layout.mjs';

/**
 * 低频操作的收起顺序：越靠前越先收进「更多」菜单。
 * 重绘、收起视图、中断保持直接可见。
 */
const OVERFLOW_TARGETS = [
  { id: 'toggleFiles', selector: '#toggleFiles' },
  { id: 'openStatuslineSettings', selector: '#openStatuslineSettings' },
  { id: 'zoom', selector: '#terminalZoomGroup' },
  { id: 'toggleComposer', selector: '#toggleComposer' },
];

let applied = false;

/** 初始化工具栏溢出：按实际宽度把低频按钮移入「更多」菜单 */
export function setupToolbarOverflow() {
  if (applied) return;
  const toolbar = $('.terminal-toolbar');
  const actions = $('.terminal-actions');
  const more = $('#terminalMore');
  const moreButton = $('#toggleMoreActions');
  const menu = $('#terminalMoreMenu');
  if (!toolbar || !actions || !more || !moreButton || !menu) return;
  applied = true;

  // 记录原始顺序，恢复时整体插回，保证按钮顺序与 HTML 一致
  const originalOrder = [...actions.children];
  const targets = OVERFLOW_TARGETS
    .map(target => ({ ...target, element: $(target.selector) }))
    .filter(target => target.element);
  let scheduled = false;

  const isOpen = () => !menu.hidden;

  const closeMenu = () => {
    if (!isOpen()) return;
    menu.hidden = true;
    moreButton.setAttribute('aria-expanded', 'false');
  };

  const menuButtons = () => [...menu.querySelectorAll('button:not([disabled])')]
    .filter(button => button.offsetParent !== null);

  const openMenu = () => {
    if (!menu.children.length) return;
    menu.hidden = false;
    moreButton.setAttribute('aria-expanded', 'true');
    menuButtons()[0]?.focus();
  };

  const restore = () => {
    // append 会按给定顺序移动节点，等于还原原始顺序
    actions.append(...originalOrder);
  };

  const apply = () => {
    if (toolbar.clientWidth === 0) return;
    closeMenu();
    restore();
    more.hidden = false;

    const style = getComputedStyle(toolbar);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const gapBetweenGroups = parseFloat(style.columnGap) || 0;
    const actionsStyle = getComputedStyle(actions);
    const gap = parseFloat(actionsStyle.columnGap) || 0;
    const caption = toolbar.querySelector('.terminal-caption');
    const captionWidth = caption ? caption.scrollWidth : 0;

    const visibleChildren = [...actions.children].filter(child => child !== more);
    const fixedWidth = visibleChildren
      .filter(child => !targets.some(target => target.element === child))
      .reduce((sum, child) => sum + child.getBoundingClientRect().width + gap, 0);

    const moreWidth = moreButton.getBoundingClientRect().width;
    const totalSlots = visibleChildren.length + 1;
    const gapWidth = gap * totalSlots;
    const available = toolbar.clientWidth - padding;
    // 标题最多占 45% 宽度，剩余空间交给操作按钮
    const captionBudget = Math.min(captionWidth, available * 0.45);
    const budget = available - captionBudget - gapBetweenGroups - fixedWidth - moreWidth - gapWidth;

    const candidates = targets.map(target => ({
      id: target.id,
      width: target.element.getBoundingClientRect().width + gap,
    }));
    const overflow = selectOverflowActions(candidates, budget);
    for (const target of targets) {
      if (overflow.includes(target.id)) menu.append(target.element);
    }

    more.hidden = overflow.length === 0;
    if (overflow.length === 0) closeMenu();
  };

  const scheduleApply = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      apply();
    });
  };

  moreButton.addEventListener('click', () => {
    if (isOpen()) closeMenu();
    else openMenu();
  });

  menu.addEventListener('keydown', event => {
    const buttons = menuButtons();
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
      moreButton.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (index + step + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  });

  document.addEventListener('click', event => {
    if (!more.contains(event.target)) closeMenu();
  });

  new ResizeObserver(scheduleApply).observe(toolbar);
  window.addEventListener('resize', scheduleApply);
  apply();
}
