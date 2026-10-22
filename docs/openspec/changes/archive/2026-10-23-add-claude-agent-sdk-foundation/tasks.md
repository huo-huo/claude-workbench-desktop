## 1. 依赖与模块骨架

- [x] 1.1 在 `package.json` 添加固定版本的 `@anthropic-ai/claude-agent-sdk` 并完成安装；验证 `node -e "import('@anthropic-ai/claude-agent-sdk').then(m => console.log(typeof m.query))"` 输出 `function` <!-- comet-task:d2aab11c-2011-4b0a-a01e-e32119453153 -->
- [x] 1.2 新建 `sdk-runtime.mjs`：动态加载 SDK、维护会话表、事件订阅与资源清理；验证模块可被 `import()` 加载，且导出的健康检查函数在无会话时返回结构完整的对象 <!-- comet-task:022e990f-440b-473c-848b-4d4669819d68 -->

## 2. 健康检查与路径安全

- [x] 2.1 实现运行时健康检查（SDK 可用性、SDK 版本、实际运行时路径、Node 版本）；验证 `GET /api/sdk/health` 返回 200 且字段齐全 <!-- comet-task:da6d5870-3e0c-4b58-bcd6-5c243eb69137 -->
- [x] 2.2 实现不可用降级：当 SDK 加载失败或运行时路径无效时，健康检查返回不可用状态与原因；验证将 `CLAUDE_WORKBENCH_SDK_EXECUTABLE` 指向不存在路径后检查返回不可用，且 `/api/state` 仍正常响应 <!-- comet-task:a0915327-a5ce-47a1-b679-7230022dc338 -->
- [x] 2.3 会话创建复用 `safeWorkspaceRoot()` 校验项目路径；验证提交未登记或越界路径时返回 400 且没有启动运行时进程 <!-- comet-task:1b2e10be-679f-47f6-b218-848d83fcfca4 -->

## 3. 会话生命周期与事件流

- [x] 3.1 实现创建会话接口（项目路径、可选初始提示词、可选模型与权限模式）；验证返回会话标识与事件流地址 <!-- comet-task:b24df261-801d-48fa-bbf8-d400c9420437 -->
- [x] 3.2 实现发送提示词接口（流式输入）；验证同一会话可连续发送两条提示词并各自产生事件 <!-- comet-task:6e50a1aa-36ae-4858-a8f3-3b7966372b47 -->
- [x] 3.3 实现 WebSocket 事件流（`ready`、`event`、`error`、`exit`，携带会话标识）；验证订阅后可收到 system、assistant、result 事件 <!-- comet-task:37fced0a-5940-42fe-a422-8959cb430045 -->
- [x] 3.4 实现重连续接：客户端断开后重连同一会话仍可继续接收后续事件，原会话不中断 <!-- comet-task:c93e182e-267a-4cde-b27f-7433cd425f08 -->
- [x] 3.5 实现中断与关闭接口；验证中断后订阅端收到中断事件，关闭后该会话的事件订阅被拒绝 <!-- comet-task:434b29ef-186a-47af-b2b4-eb449a8867ee -->
- [x] 3.6 新增独立的 SDK 会话记录文件 `~/.claude/workbench-sdk-sessions.json`；验证 SDK 会话与 `workbench-workspace.json` 中的终端会话互不覆盖 <!-- comet-task:fb848e5b-a7b0-44c3-a153-88aaa73b54c1 -->

## 4. 配置与渠道注入

- [x] 4.1 SDK 会话显式使用 `settingSources: ['user', 'project', 'local']`；验证项目级 `CLAUDE.md` 与用户级 skill 在会话中可见 <!-- comet-task:fcc5887a-b967-413d-87a4-39e8ae81582d -->
- [x] 4.2 从当前激活渠道构造会话级 `env`（`ANTHROPIC_BASE_URL`、解密后的 `ANTHROPIC_AUTH_TOKEN`、模型槽位变量）；验证有渠道时会话进程环境包含这些变量 <!-- comet-task:63ba470d-1a33-4740-93d3-818a759b4470 -->
- [x] 4.3 验证渠道注入不改写全局设置：创建 SDK 会话前后比较 `~/.claude/settings.json` 内容哈希，结果一致 <!-- comet-task:85b610ec-d666-486b-b1f9-e9c7974adac7 -->

## 5. 打包与兼容

- [x] 5.1 更新 `scripts/prepare-desktop-resources.mjs`，把 SDK 运行时文件复制进 `resources/workbench/node_modules`；验证运行准备脚本后产物包含 `@anthropic-ai/claude-agent-sdk` 且服务可从产物目录加载 SDK <!-- comet-task:3675b2dc-fc4d-4e28-824a-17a13980aab6 -->
- [x] 5.2 终端会话回归：启动服务后创建终端会话并通过 WebSocket 收发数据；验证终端创建、输入、中断接口行为与改动前一致 <!-- comet-task:f4c64048-deda-4679-9511-587f38ce93d1 -->

## 6. 验证与交付文档

- [x] 6.1 新增 `scripts/sdk-smoke.mjs` 冒烟脚本，覆盖健康检查、创建会话、发送提示词、接收 result、中断；验证脚本在本地服务运行时退出码为 0 <!-- comet-task:d3afbf7a-46d5-494d-9cfe-cda4b41d68cb -->
- [x] 6.2 输出迁移评估文档 `docs/claude-agent-sdk-migration.md`，包含功能矩阵、批次划分与保留项；验证内容与 `design.md` 评估章节一致 <!-- comet-task:71aa4bd6-4f57-48d3-8123-eed36cacdd0a -->
- [x] 6.3 更新 `README.md` 中 SDK 能力与安装说明；验证描述与实际接口、依赖要求一致 <!-- comet-task:47f06fd8-2091-482d-bad9-98042a8240d5 -->
- [x] 6.4 集成验证：执行 `npm run build`、启动本地服务并运行 `scripts/sdk-smoke.mjs`，全部通过后记录验证结果 <!-- comet-task:fd7539df-4a6d-4959-ac18-f81583265862 -->
