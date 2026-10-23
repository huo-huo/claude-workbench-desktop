// 管理页共享状态：页面状态对象 + window._* 临时状态的读写函数（实际存储仍在 window，保持全局键名不变）
export const state = {
  data: null,
  currentPage: 'dashboard',
  query: '',
  statusFilter: 'all',
  editingChannelId: '',
  channelFormVisible: false,
  manualError: '',
  skillSource: 'all',
  skillSort: 'name',
  skillFilter: 'all',
  listPage: 0,
};

// —— window._* 临时状态（键名与原内联脚本一致，不得改动）——
export const getFlowOpen = () => window._flowOpen;
export const setFlowOpen = (id, open) => { window._flowOpen||={}; window._flowOpen[id]=open; };
export const getBenchmarkChannel = () => window._benchmarkChannel;
export const setBenchmarkChannel = value => { window._benchmarkChannel=value; };
export const getBenchmarkErrors = () => window._benchmarkErrors;
export const setBenchmarkErrors = value => { window._benchmarkErrors=value; };
export const getManualError = () => window._manualError;
export const setManualError = value => { window._manualError=value; };
export const getSelectedErrorId = () => window._selectedErrorId;
export const setSelectedErrorId = value => { window._selectedErrorId=value; };
export const getOpenDetailId = () => window._openDetailId;
export const setOpenDetailId = value => { window._openDetailId=value; };
export const getToastTimer = () => window._toast;
export const setToastTimer = value => { window._toast=value; };
