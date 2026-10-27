/**
 * 工具栏溢出的纯计算：candidates 按「最先收起」顺序排列，
 * 从低优先级开始收起，直到剩余操作宽度不超过预算。
 */
export function selectOverflowActions(candidates, budget) {
  const items = Array.isArray(candidates) ? candidates : [];
  const total = items.reduce((sum, item) => sum + item.width, 0);
  const overflow = [];
  let remaining = total;
  for (const item of items) {
    if (remaining <= budget) break;
    overflow.push(item.id);
    remaining -= item.width;
  }
  return overflow;
}

/** 把弹出菜单中的启用项与禁用项分开，供焦点移动时跳过禁用按钮 */
export function enabledMenuItems(items) {
  return (items || []).filter(item => item && !item.disabled);
}
