/**
 * 终端写入队列：同一渲染帧内的多个输出块合并为一次写入，保持原始顺序。
 * schedule/cancel 可注入，便于测试。
 */
export function createWriteQueue({
  write,
  schedule = handler => requestAnimationFrame(handler),
  cancel = id => cancelAnimationFrame(id),
}) {
  let pending = [];
  let frame = null;
  const flush = () => {
    frame = null;
    if (!pending.length) return;
    const chunk = pending.join('');
    pending = [];
    write(chunk);
  };
  return {
    push(data) {
      if (!data) return;
      pending.push(String(data));
      if (frame === null) frame = schedule(flush);
    },
    flush,
    clear() {
      if (frame !== null) cancel(frame);
      frame = null;
      pending = [];
    },
    get size() {
      return pending.length;
    },
  };
}

/** 防抖调度器：短时间多次触发只执行最后一次；setTimer/clearTimer 可注入以便测试 */
export function createDebouncer({
  delay,
  run,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null;
  const trigger = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      run();
    }, delay);
  };
  trigger.cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  return trigger;
}
