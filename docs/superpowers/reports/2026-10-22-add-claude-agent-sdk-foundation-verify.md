# 验证报告：add-claude-agent-sdk-foundation

- 日期：2026-10-22
- 验证模式：full
- 基线：`39eed2e`（本地 main）
- 最终提交：`f4e99c6`

## 摘要

| 维度 | 状态 |
| --- | --- |
| 完整性 | 20/20 任务完成；6 个 Requirement、13 条 Scenario 均有实现或测试覆盖 |
| 正确性 | SDK 会话生命周期、事件流、中断/关闭、路径校验、渠道注入、记录文件、打包策略均通过验证 |
| 一致性 | 实现遵循 design 的 7 项决策；delta spec 与 design 同步（interrupt 措辞已统一）；README 与迁移文档一致 |
| 安全 | 路径限制、Origin/Host 校验、只读工具白名单、凭证不落盘、关闭后订阅拒绝均通过 |

## 检查项

| # | 检查 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | tasks.md 全部完成 | PASS | 20/20，`comet state check` 通过 |
| 2 | 改动文件与任务一致 | PASS | `git diff --stat 39eed2e..HEAD`：sdk-runtime、server、tests、scripts、README、docs 与计划一致 |
| 3 | 编译通过 | PASS | `npm run build` 成功（Runtime 证据，`comet check run`） |
| 4 | 相关测试通过 | PASS | `npm test` 56/56 通过 |
| 5 | 无明显安全问题 | PASS | 无硬编码密钥；凭证仅会话级 env；路径 realpath + 已登记校验；WS 拒绝未知/关闭会话 |
| 6 | 最终集成审查 | PASS | 独立审查（opus）覆盖全量 diff，1 项 IMPORTANT（npm 安装探测）已修复并复查 PASS |
| 7 | 核心与边界场景 | PASS | 见下表 |

## 场景覆盖

| Requirement | Scenario | 覆盖方式 |
| --- | --- | --- |
| 运行时可用性探测 | 运行时可用 / 不可用 | `health()` 单测（bundled/env/installed 分支）；HTTP 200/503 实测 |
| 结构化会话生命周期 | 创建成功 / 拒绝无效路径 | 会话生命周期单测；`POST /api/sdk/sessions` 201/400 实测 |
| 会话事件流 | 订阅接收 / 断开重连 / 启动后订阅 | 事件缓冲与回放单测；冒烟 WS 收到 ready 与 result |
| 会话中断与关闭 | 中断运行中 / 关闭已结束 | interrupt 状态机与竞态单测；冒烟 interrupt 返回 true、close 200 |
| 本地配置与渠道注入 | 使用当前渠道 / 无自定义渠道 | `buildChannelEnvFrom` 单测；`settingSources`/`systemPrompt` options 断言；冒烟真实 result.success |
| 双模式隔离与兼容 | 终端不受影响 / 记录隔离 | 终端创建/WS 输入/停止回归；独立 `workbench-sdk-sessions.json` 单测 |

## 集成审查与修复

- 审查结论：无 CRITICAL；1 项 IMPORTANT（npm 全局安装的 `claude.exe` 未被识别，打包环境误报不可用）。
- 修复 `f4e99c6`：
  - 新增 `findClaudeExeFromWhere` 纯函数与 `resolveExecutable` 的 npm 探测（不影响 `claudeInstallInfo` 与终端）。
  - 打包产物目录实测 `GET /api/sdk/health` → 200，`runtimeSource: installed`，`runtimePath` 指向 npm 包内 `claude.exe`。
  - 同步 README、迁移文档、spec 的 interrupt 措辞与 design。
- 复查：5 项全部 ADDRESSED，未引入新的 Critical/Important。

## 接受的偏差（WARNING / SUGGESTION）

| 项 | 级别 | 接受理由与影响 |
| --- | --- | --- |
| 已关闭会话 Map 与 WS 资源不主动回收 | WARNING | 单机工作台会话量有限；已在迁移文档批次 2 规划资源治理。影响：长时间运行内存随会话数增长。 |
| 渠道 env 与终端 settings 取值来源未完全统一 | WARNING | 激活渠道时 `modelSlots` 与 `settings.env` 同步写入；旧数据只有 `fallback` 字符串时 SDK 会话可能缺少 fallback 标志。影响范围小，批次 3 统一。 |
| settings.json 哈希证据 | WARNING | 组 D 已手工验证创建会话前后 SHA256 一致（`5E4CB061…29EC11`），未固化为自动化断言。影响：后续改动缺少回归保护。 |
| 只读工具路径未限制在项目内 | SUGGESTION | 当前白名单仅 Read/Glob/Grep；路径限制列入批次 2。影响：SDK 会话可读取项目外文件。 |
| 其余 SUGGESTION（WS 令牌、打包瘦身、许可文件保留等） | SUGGESTION | 不影响正确性与验收，列入后续批次。 |

## 性能与体积

- 桌面资源产物：65 files / 7.9 MB（不含 283.6 MB 原生 CLI）。
- 运行时解析：env → 已安装 `claude.exe` → npm 全局包内 `claude.exe`（缓存）→ 开发树 bundled。

## 最终结论

完整验证 7 项检查全部 PASS，无 CRITICAL / IMPORTANT 遗留问题，允许进入归档。
