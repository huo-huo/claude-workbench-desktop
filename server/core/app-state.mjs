import { STATE_FILE } from './paths.mjs';
import { safeReadJson } from './storage.mjs';

/** 通用应用状态：读取 workbench-state.json 并补齐默认字段 */
export function state() {
  const s = safeReadJson(STATE_FILE, {});
  return { disabledHooks: {}, channels: null, activeChannelId: '', generatedCards: {}, modelBenchmarks: [], modelBenchmarkRun: null, promptLibrary: [], ...s };
}
